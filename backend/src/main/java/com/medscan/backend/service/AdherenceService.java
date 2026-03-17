package com.medscan.backend.service;

import com.medscan.backend.model.AdherenceLog;
import com.medscan.backend.model.GroupMember;
import com.medscan.backend.model.MedicationSchedule;
import com.medscan.backend.repository.mongo.AdherenceRepository;
import com.medscan.backend.repository.mysql.CareGroupRepository;
import com.medscan.backend.repository.mysql.GroupMemberRepository;
import com.medscan.backend.repository.mysql.MedicationScheduleRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class AdherenceService {

    private static final int LOW_STOCK_THRESHOLD_DAYS = 3;

    @Autowired
    private AdherenceRepository adherenceRepository;

    @Autowired
    private MedicationScheduleRepository scheduleRepository;

    @Autowired
    private GroupMemberRepository groupMemberRepository;

    @Autowired
    private CareGroupRepository careGroupRepository;

    @Autowired
    private GroupService groupService;

    @Autowired
    private PushNotificationService pushNotificationService;

    @Transactional
    public AdherenceLog logAdherence(Long userId, Long scheduleId, String status, String reason) {
        // **Dedup check**: allow one log per schedule-time per day
        LocalDateTime todayStart = LocalDateTime.now().withHour(0).withMinute(0).withSecond(0).withNano(0);
        long todayLogCount = adherenceRepository.countByScheduleIdAndTimestampAfter(scheduleId, todayStart);
        
        // Get number of daily times for this schedule
        Optional<MedicationSchedule> scheduleOpt = scheduleRepository.findById(scheduleId);
        int maxDailyDoses = 1;
        if (scheduleOpt.isPresent()) {
            MedicationSchedule schedule = scheduleOpt.get();
            if (schedule.getScheduleTimes() != null && !schedule.getScheduleTimes().isEmpty()) {
                maxDailyDoses = schedule.getScheduleTimes().size();
            }
        }
        
        if (todayLogCount >= maxDailyDoses) {
            // All doses for today already logged
            AdherenceLog alreadyLogged = new AdherenceLog(scheduleId, userId, "—", LocalDateTime.now(), status, reason);
            alreadyLogged.setMetadata("ALREADY_LOGGED");
            return alreadyLogged;
        }
        String medicineName = "Unknown";
        if (scheduleOpt.isPresent()) {
            MedicationSchedule schedule = scheduleOpt.get();
            medicineName = schedule.getMedicine() != null ? schedule.getMedicine().getName() : "Unknown";
        }

        // 2. Create and Save Log to MongoDB
        AdherenceLog log = new AdherenceLog(
                scheduleId,
                userId,
                medicineName,
                LocalDateTime.now(),
                status,
                reason
        );
        AdherenceLog savedLog = adherenceRepository.save(log);

        // 3. Update Stock if TAKEN
        if ("TAKEN".equalsIgnoreCase(status) && scheduleOpt.isPresent()) {
            MedicationSchedule schedule = scheduleOpt.get();
            if (schedule.getCurrentStock() != null && schedule.getCurrentStock() > 0) {
                int amountToSubtract = 1;
                if (schedule.getDoseAmount() != null) {
                    amountToSubtract = (int) Math.ceil(schedule.getDoseAmount());
                }
                int newStock = Math.max(0, schedule.getCurrentStock() - amountToSubtract);
                schedule.setCurrentStock(newStock);
                scheduleRepository.save(schedule);
            }

            // 4. Log to Group Activity for all groups the user is a member of
            logToUserGroups(userId, medicineName, status);
        } else if ("MISSED".equalsIgnoreCase(status)) {
            // Log missed doses to groups
            logToUserGroups(userId, medicineName, status);
            // Send push notification to caregivers in user's groups
            notifyCaregivers(userId, medicineName);
        }
        // SNOOZED logs are tracked but not broadcast to groups

        return savedLog;
    }

    /**
     * Timestamp-aware adherence logging for offline conflict resolution.
     * Used by SyncController when processing batched offline adherence logs.
     *
     * Strategy: last-write-wins based on clientTimestamp.
     * - If no existing log for this schedule today → insert new
     * - If existing log is older than clientTimestamp → overwrite
     * - If existing log is newer → skip (server data wins)
     */
    @Transactional
    public AdherenceLog logAdherenceWithTimestamp(Long userId, Long scheduleId, String status,
                                                   String reason, LocalDateTime clientTimestamp) {
        if (clientTimestamp == null) {
            // Fallback to normal logging
            return logAdherence(userId, scheduleId, status, reason);
        }

        // Find existing log for this schedule on the same day
        LocalDateTime dayStart = clientTimestamp.withHour(0).withMinute(0).withSecond(0).withNano(0);
        LocalDateTime dayEnd = dayStart.plusDays(1);

        java.util.Optional<AdherenceLog> existingOpt = adherenceRepository
                .findFirstByScheduleIdAndTimestampBetween(scheduleId, dayStart, dayEnd);

        if (existingOpt.isPresent()) {
            AdherenceLog existing = existingOpt.get();
            if (existing.getTimestamp().isBefore(clientTimestamp)) {
                // Client timestamp is newer → overwrite
                existing.setStatus(status);
                existing.setTimestamp(clientTimestamp);
                existing.setReason(reason);
                existing.setMetadata("CONFLICT_RESOLVED_CLIENT_WINS");
                return adherenceRepository.save(existing);
            } else {
                // Server timestamp is newer or equal → skip
                AdherenceLog skipped = new AdherenceLog(scheduleId, userId, existing.getMedicineName(),
                        clientTimestamp, status, reason);
                skipped.setMetadata("CONFLICT_RESOLVED_SERVER_WINS");
                return skipped;
            }
        }

        // No existing log → normal insert
        return logAdherence(userId, scheduleId, status, reason);
    }

    private void logToUserGroups(Long userId, String medicineName, String status) {
        // Find all groups this user belongs to
        List<GroupMember> memberships = groupMemberRepository.findByIdUserId(userId);
        for (GroupMember gm : memberships) {
            String verb = "TAKEN".equalsIgnoreCase(status) ? "took" : "missed";
            String message = gm.getUser().getFullName() + " " + verb + " " + medicineName;
            groupService.logGroupActivity(
                    gm.getGroup().getId(), userId, "DOSE_" + status.toUpperCase(), message);
        }
    }

    /**
     * Notify all caregivers in the patient's care groups about a missed dose.
     */
    private void notifyCaregivers(Long patientUserId, String medicineName) {
        try {
            List<GroupMember> memberships = groupMemberRepository.findByIdUserId(patientUserId);
            for (GroupMember gm : memberships) {
                // Get all members of this group
                List<GroupMember> groupMembers = groupMemberRepository.findByGroup(gm.getGroup());
                List<Long> caregiverIds = groupMembers.stream()
                        .map(m -> m.getUser().getId())
                        .filter(id -> !id.equals(patientUserId))
                        .collect(Collectors.toList());

                if (!caregiverIds.isEmpty()) {
                    pushNotificationService.notifyMissedDose(patientUserId, medicineName, caregiverIds);
                }
            }
        } catch (Exception e) {
            // Push notification failures should not break adherence logging
            System.err.println("[AdherenceService] Failed to notify caregivers: " + e.getMessage());
        }
    }

    /**
     * Check if a schedule has low stock.
     * Low stock = remaining doses < (daily doses * LOW_STOCK_THRESHOLD_DAYS)
     */
    public boolean isLowStock(MedicationSchedule schedule) {
        if (schedule.getCurrentStock() == null) return false;
        int dailyDoses = schedule.getScheduleTimes() != null ? schedule.getScheduleTimes().size() : 1;
        int doseAmount = schedule.getDoseAmount() != null ? (int) Math.ceil(schedule.getDoseAmount()) : 1;
        int threshold = dailyDoses * doseAmount * LOW_STOCK_THRESHOLD_DAYS;
        return schedule.getCurrentStock() <= threshold;
    }

    /**
     * Undo today's adherence log for a schedule.
     * Restores stock if the undone log was TAKEN.
     */
    @Transactional
    public boolean undoTodayLog(Long userId, Long scheduleId) {
        LocalDateTime todayStart = LocalDateTime.now().withHour(0).withMinute(0).withSecond(0).withNano(0);
        LocalDateTime todayEnd = todayStart.plusDays(1);
        
        Optional<AdherenceLog> logOpt = adherenceRepository
                .findFirstByScheduleIdAndTimestampBetween(scheduleId, todayStart, todayEnd);
        
        if (logOpt.isEmpty()) return false;
        
        AdherenceLog log = logOpt.get();
        
        // Restore stock if it was TAKEN
        if ("TAKEN".equalsIgnoreCase(log.getStatus())) {
            Optional<MedicationSchedule> schedOpt = scheduleRepository.findById(scheduleId);
            if (schedOpt.isPresent()) {
                MedicationSchedule schedule = schedOpt.get();
                if (schedule.getCurrentStock() != null) {
                    int amountToRestore = schedule.getDoseAmount() != null
                            ? (int) Math.ceil(schedule.getDoseAmount()) : 1;
                    schedule.setCurrentStock(schedule.getCurrentStock() + amountToRestore);
                    scheduleRepository.save(schedule);
                }
            }
        }
        
        adherenceRepository.delete(log);
        return true;
    }

    public List<AdherenceLog> getUserHistory(Long userId) {
        return adherenceRepository.findByUserId(userId);
    }

    public List<AdherenceLog> getGroupAdherence(Long groupId) {
        com.medscan.backend.model.CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));
        
        List<GroupMember> members = groupMemberRepository.findByGroup(group);
        List<Long> userIds = members.stream()
                .map(member -> member.getUser().getId())
                .collect(Collectors.toList());
        
        if (userIds.isEmpty()) {
            return Collections.emptyList();
        }
        
        return adherenceRepository.findByUserIdIn(userIds);
    }
}
