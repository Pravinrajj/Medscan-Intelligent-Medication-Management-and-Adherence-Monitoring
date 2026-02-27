package com.medscan.backend.service;

import com.medscan.backend.model.*;
import com.medscan.backend.repository.mongo.GroupActivityRepository;
import com.medscan.backend.repository.mysql.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class GroupService {

    @Autowired
    private CareGroupRepository careGroupRepository;

    @Autowired
    private GroupMemberRepository groupMemberRepository;
    
    @Autowired
    private UserRepository userRepository;

    @Autowired
    private GroupActivityRepository groupActivityRepository;

    @Autowired
    private SharedScheduleRepository sharedScheduleRepository;

    @Autowired
    private MedicationScheduleRepository medicationScheduleRepository;

    @Autowired
    private PushNotificationService pushNotificationService;

    public CareGroup createGroup(Long adminId, String groupName, String description) {
        User admin = userRepository.findById(adminId)
                .orElseThrow(() -> new RuntimeException("Admin not found"));
        CareGroup group = new CareGroup();
        group.setAdmin(admin);
        group.setGroupName(groupName);
        if (description != null && !description.trim().isEmpty()) {
            group.setDescription(description.trim());
        }
        CareGroup saved = careGroupRepository.save(group);

        groupActivityRepository.save(new GroupActivity(
                saved.getId(), adminId, "GROUP_CREATED",
                admin.getFullName() + " created group \"" + groupName + "\""));

        return saved;
    }

    public void addMember(Long groupId, Long adminId, Long userId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));

        if (!group.getAdmin().getId().equals(adminId)) {
            throw new RuntimeException("Only the group admin can add members");
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        GroupMember member = new GroupMember(group, user);
        groupMemberRepository.save(member);

        User admin = group.getAdmin();
        groupActivityRepository.save(new GroupActivity(
                groupId, adminId, "MEMBER_ADDED",
                admin.getFullName() + " added " + user.getFullName() + " to the group"));
    }

    public List<User> checkContactsRegistered(List<String> phoneNumbers) {
        List<String> normalized = phoneNumbers.stream()
                .map(p -> p.replaceAll("[^0-9]", ""))
                .filter(p -> p.length() >= 10)
                .map(p -> p.substring(p.length() - 10))
                .distinct()
                .collect(Collectors.toList());
        
        if (normalized.isEmpty()) return List.of();
        
        List<String> allVariants = new ArrayList<>(normalized);
        for (String n : normalized) {
            allVariants.add("+91" + n);
            allVariants.add("91" + n);
        }
        
        return userRepository.findByPhoneNumberIn(allVariants.stream().distinct().collect(Collectors.toList()));
    }

    public List<Map<String, Object>> getUserGroups(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
        
        List<CareGroup> adminGroups = careGroupRepository.findByAdminId(userId);
        List<GroupMember> memberGroups = groupMemberRepository.findByUser(user);
        
        List<CareGroup> allGroups = new ArrayList<>(adminGroups);
        for (GroupMember gm : memberGroups) {
            if (!allGroups.contains(gm.getGroup())) {
                allGroups.add(gm.getGroup());
            }
        }
        
        // Enrich each group with member count
        List<Map<String, Object>> result = new ArrayList<>();
        for (CareGroup g : allGroups) {
            Map<String, Object> groupMap = new java.util.LinkedHashMap<>();
            groupMap.put("id", g.getId());
            groupMap.put("groupName", g.getGroupName());
            groupMap.put("description", g.getDescription());
            groupMap.put("admin", g.getAdmin());
            groupMap.put("allowMemberTriggers", g.getAllowMemberTriggers());
            groupMap.put("createdAt", g.getCreatedAt());
            // Count members: admin + group_members entries
            int memberCount = 1 + groupMemberRepository.findByGroup(g).size();
            groupMap.put("memberCount", memberCount);
            result.add(groupMap);
        }
        return result;
    }

    public List<User> getGroupMembers(Long groupId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));
        return groupMemberRepository.findByGroup(group).stream()
                .map(GroupMember::getUser)
                .collect(Collectors.toList());
    }

    public List<GroupActivity> getGroupActivity(Long groupId) {
        return groupActivityRepository.findByGroupIdOrderByTimestampDesc(groupId);
    }

    public void logGroupActivity(Long groupId, Long userId, String type, String message) {
        groupActivityRepository.save(new GroupActivity(groupId, userId, type, message));
    }

    public void removeMember(Long groupId, Long userId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
        
        GroupMember member = groupMemberRepository.findByGroupAndUser(group, user)
                .orElseThrow(() -> new RuntimeException("User is not a member of this group"));
        
        groupMemberRepository.delete(member);

        groupActivityRepository.save(new GroupActivity(
                groupId, userId, "MEMBER_LEFT",
                (user.getFullName() != null ? user.getFullName() : user.getUsername()) + " left the group"));
    }

    public void removeMemberByAdmin(Long groupId, Long adminId, Long userId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));

        if (!group.getAdmin().getId().equals(adminId)) {
            throw new RuntimeException("Only the group admin can remove members");
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        GroupMember member = groupMemberRepository.findByGroupAndUser(group, user)
                .orElseThrow(() -> new RuntimeException("User is not a member of this group"));

        groupMemberRepository.delete(member);

        User admin = group.getAdmin();
        groupActivityRepository.save(new GroupActivity(
                groupId, adminId, "MEMBER_REMOVED",
                admin.getFullName() + " removed " + (user.getFullName() != null ? user.getFullName() : user.getUsername()) + " from the group"));
    }

    public void deleteGroup(Long groupId, Long adminId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));

        if (!group.getAdmin().getId().equals(adminId)) {
            throw new RuntimeException("Only the group admin can delete the group");
        }

        List<GroupMember> members = groupMemberRepository.findByGroup(group);
        groupMemberRepository.deleteAll(members);

        User admin = group.getAdmin();
        groupActivityRepository.save(new GroupActivity(
                groupId, adminId, "GROUP_DELETED",
                admin.getFullName() + " deleted group \"" + group.getGroupName() + "\""));

        careGroupRepository.delete(group);
    }

    // ========================
    // Schedule Sharing
    // ========================

    @Transactional
    public void shareSchedules(Long groupId, Long userId, List<Long> scheduleIds) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        for (Long scheduleId : scheduleIds) {
            if (sharedScheduleRepository.findByGroupIdAndScheduleId(groupId, scheduleId).isEmpty()) {
                SharedSchedule ss = new SharedSchedule();
                ss.setGroupId(groupId);
                ss.setScheduleId(scheduleId);
                ss.setSharedByUserId(userId);
                sharedScheduleRepository.save(ss);
            }
        }

        groupActivityRepository.save(new GroupActivity(
                groupId, userId, "SCHEDULES_SHARED",
                (user.getFullName() != null ? user.getFullName() : user.getUsername())
                        + " shared " + scheduleIds.size() + " schedule(s) with the group"));
    }

    public List<Map<String, Object>> getSharedSchedulesForGroup(Long groupId) {
        List<SharedSchedule> shared = sharedScheduleRepository.findByGroupId(groupId);
        List<Map<String, Object>> result = new ArrayList<>();

        for (SharedSchedule ss : shared) {
            MedicationSchedule schedule = medicationScheduleRepository.findById(ss.getScheduleId()).orElse(null);
            if (schedule == null) continue;

            User sharedBy = userRepository.findById(ss.getSharedByUserId()).orElse(null);
            Map<String, Object> entry = new HashMap<>();
            entry.put("sharedScheduleId", ss.getId());
            entry.put("scheduleId", ss.getScheduleId());
            entry.put("sharedByUserId", ss.getSharedByUserId());
            entry.put("sharedByName", sharedBy != null ? (sharedBy.getFullName() != null ? sharedBy.getFullName() : sharedBy.getUsername()) : "Unknown");
            entry.put("medicineName", schedule.getMedicine() != null ? schedule.getMedicine().getName() : "Medication");
            entry.put("doseAmount", schedule.getDoseAmount());
            entry.put("doseUnit", schedule.getDoseUnit());
            entry.put("frequencyType", schedule.getFrequencyType());
            result.add(entry);
        }
        return result;
    }

    @Transactional
    public void unshareSchedule(Long groupId, Long scheduleId) {
        sharedScheduleRepository.deleteByGroupIdAndScheduleId(groupId, scheduleId);
    }

    // ========================
    // Group Settings
    // ========================

    public CareGroup updateGroupSettings(Long groupId, Long adminId, Map<String, Object> settings) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));

        if (!group.getAdmin().getId().equals(adminId)) {
            throw new RuntimeException("Only the group admin can update settings");
        }

        if (settings.containsKey("groupName")) {
            String newName = settings.get("groupName").toString().trim();
            if (!newName.isEmpty()) {
                group.setGroupName(newName);
            }
        }
        if (settings.containsKey("allowMemberTriggers")) {
            group.setAllowMemberTriggers(Boolean.valueOf(settings.get("allowMemberTriggers").toString()));
        }
        if (settings.containsKey("description")) {
            group.setDescription(settings.get("description").toString());
        }

        return careGroupRepository.save(group);
    }

    // ========================
    // Trigger Reminder
    // ========================

    public void triggerReminder(Long groupId, Long triggerUserId, Long targetUserId, Long scheduleId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));

        boolean isAdmin = group.getAdmin().getId().equals(triggerUserId);
        boolean membersCanTrigger = group.getAllowMemberTriggers() != null && group.getAllowMemberTriggers();

        if (!isAdmin && !membersCanTrigger) {
            throw new RuntimeException("Only the admin can send reminders in this group");
        }

        MedicationSchedule schedule = medicationScheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new RuntimeException("Schedule not found"));

        String medicineName = schedule.getMedicine() != null ? schedule.getMedicine().getName() : "medication";
        User triggerUser = userRepository.findById(triggerUserId).orElse(null);
        String triggerName = triggerUser != null
                ? (triggerUser.getFullName() != null ? triggerUser.getFullName() : triggerUser.getUsername())
                : "Someone";

        pushNotificationService.sendToUser(targetUserId,
                "💊 Reminder from " + triggerName,
                "Don't forget to take your " + medicineName + "!");

        groupActivityRepository.save(new GroupActivity(
                groupId, triggerUserId, "REMINDER_SENT",
                triggerName + " sent a reminder for " + medicineName));
    }
}
