package com.medscan.backend.service;

import com.medscan.backend.model.AdherenceLog;
import com.medscan.backend.repository.mongo.AdherenceRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class StatsService {

    @Autowired
    private AdherenceRepository adherenceRepository;

    public Map<String, Object> getUserStats(Long userId) {
        LocalDateTime sevenDaysAgo = LocalDateTime.now().minusDays(7);
        List<AdherenceLog> logs = adherenceRepository.findByUserIdAndTimestampAfter(userId, sevenDaysAgo);

        int taken = 0;
        int missed = 0;
        int skipped = 0;

        for (AdherenceLog log : logs) {
            String status = log.getStatus();
            if (status != null) {
                if (status.equalsIgnoreCase("TAKEN")) taken++;
                else if (status.equalsIgnoreCase("MISSED")) missed++;
                else if (status.equalsIgnoreCase("SKIPPED")) skipped++;
            }
        }

        int total = taken + missed + skipped;
        double rate = total > 0 ? (double) taken / total * 100 : 0;

        Map<String, Object> stats = new HashMap<>();
        stats.put("adherenceRate", Math.round(rate));
        stats.put("takenCount", taken);
        stats.put("missedCount", missed);
        stats.put("skippedCount", skipped);
        stats.put("totalLogs", total);

        // Daily breakdown for chart (last 7 days)
        List<Map<String, Object>> dailyBreakdown = new java.util.ArrayList<>();
        String[] dayNames = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
        
        for (int i = 6; i >= 0; i--) {
            LocalDateTime dayStart = LocalDateTime.now().minusDays(i).withHour(0).withMinute(0).withSecond(0);
            LocalDateTime dayEnd = dayStart.plusDays(1);
            
            int dayTaken = 0, dayMissed = 0, daySnoozed = 0;
            for (AdherenceLog log : logs) {
                if (log.getTimestamp() != null && 
                    !log.getTimestamp().isBefore(dayStart) && 
                    log.getTimestamp().isBefore(dayEnd)) {
                    String s = log.getStatus();
                    if ("TAKEN".equalsIgnoreCase(s)) dayTaken++;
                    else if ("MISSED".equalsIgnoreCase(s)) dayMissed++;
                    else if ("SNOOZED".equalsIgnoreCase(s)) daySnoozed++;
                }
            }
            
            Map<String, Object> day = new HashMap<>();
            day.put("label", dayNames[dayStart.getDayOfWeek().getValue() % 7]);
            day.put("taken", dayTaken);
            day.put("missed", dayMissed);
            day.put("snoozed", daySnoozed);
            dailyBreakdown.add(day);
        }
        
        stats.put("dailyBreakdown", dailyBreakdown);
        
        return stats;
    }

    /**
     * Per-medicine adherence stats (7-day window).
     */
    public Map<String, Object> getMedicineStats(Long userId, String medicineName) {
        LocalDateTime sevenDaysAgo = LocalDateTime.now().minusDays(7);
        List<AdherenceLog> logs = adherenceRepository
                .findByUserIdAndMedicineNameAndTimestampAfter(userId, medicineName, sevenDaysAgo);

        int taken = 0, missed = 0, snoozed = 0;
        for (AdherenceLog log : logs) {
            String status = log.getStatus();
            if (status != null) {
                if (status.equalsIgnoreCase("TAKEN")) taken++;
                else if (status.equalsIgnoreCase("MISSED")) missed++;
                else if (status.equalsIgnoreCase("SNOOZED")) snoozed++;
            }
        }

        int total = taken + missed + snoozed;
        double rate = total > 0 ? (double) taken / total * 100 : 0;

        Map<String, Object> stats = new HashMap<>();
        stats.put("medicineName", medicineName);
        stats.put("adherenceRate", Math.round(rate));
        stats.put("takenCount", taken);
        stats.put("missedCount", missed);
        stats.put("snoozedCount", snoozed);
        stats.put("totalLogs", total);

        // Daily breakdown
        List<Map<String, Object>> dailyBreakdown = new java.util.ArrayList<>();
        String[] dayNames = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
        for (int i = 6; i >= 0; i--) {
            LocalDateTime dayStart = LocalDateTime.now().minusDays(i).withHour(0).withMinute(0).withSecond(0);
            LocalDateTime dayEnd = dayStart.plusDays(1);
            int dt = 0, dm = 0, ds = 0;
            for (AdherenceLog log : logs) {
                if (log.getTimestamp() != null &&
                    !log.getTimestamp().isBefore(dayStart) &&
                    log.getTimestamp().isBefore(dayEnd)) {
                    String s = log.getStatus();
                    if ("TAKEN".equalsIgnoreCase(s)) dt++;
                    else if ("MISSED".equalsIgnoreCase(s)) dm++;
                    else if ("SNOOZED".equalsIgnoreCase(s)) ds++;
                }
            }
            Map<String, Object> day = new HashMap<>();
            day.put("label", dayNames[dayStart.getDayOfWeek().getValue() % 7]);
            day.put("taken", dt);
            day.put("missed", dm);
            day.put("snoozed", ds);
            dailyBreakdown.add(day);
        }
        stats.put("dailyBreakdown", dailyBreakdown);

        return stats;
    }
}
