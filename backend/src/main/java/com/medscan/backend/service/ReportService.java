package com.medscan.backend.service;

import com.medscan.backend.model.AdherenceLog;
import com.medscan.backend.repository.mongo.AdherenceRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ReportService {

    @Autowired
    private AdherenceRepository adherenceRepository;

    /**
     * Generate adherence report for a user over a given number of days.
     * Returns per-medicine breakdown + overall statistics.
     */
    public Map<String, Object> generateReport(Long userId, int days) {
        LocalDateTime since = LocalDateTime.now().minusDays(days);
        List<AdherenceLog> logs = adherenceRepository.findByUserIdAndTimestampAfter(userId, since);

        // Filter out ALREADY_LOGGED metadata entries
        logs = logs.stream()
                .filter(l -> !"ALREADY_LOGGED".equals(l.getMetadata()))
                .collect(Collectors.toList());

        // Overall counts
        long totalTaken = logs.stream().filter(l -> "TAKEN".equals(l.getStatus())).count();
        long totalMissed = logs.stream().filter(l -> "MISSED".equals(l.getStatus())).count();
        long totalSnoozed = logs.stream().filter(l -> "SNOOZED".equals(l.getStatus())).count();
        long total = logs.size();
        double overallRate = total > 0 ? Math.round((double) totalTaken / total * 100.0) : 0;

        // Per-medicine breakdown
        Map<String, List<AdherenceLog>> byMedicine = logs.stream()
                .filter(l -> l.getMedicineName() != null)
                .collect(Collectors.groupingBy(AdherenceLog::getMedicineName));

        List<Map<String, Object>> medicineReports = new ArrayList<>();
        for (Map.Entry<String, List<AdherenceLog>> entry : byMedicine.entrySet()) {
            List<AdherenceLog> medLogs = entry.getValue();
            long taken = medLogs.stream().filter(l -> "TAKEN".equals(l.getStatus())).count();
            long missed = medLogs.stream().filter(l -> "MISSED".equals(l.getStatus())).count();
            long snoozed = medLogs.stream().filter(l -> "SNOOZED".equals(l.getStatus())).count();
            long medTotal = medLogs.size();
            double rate = medTotal > 0 ? Math.round((double) taken / medTotal * 100.0) : 0;

            Map<String, Object> medReport = new LinkedHashMap<>();
            medReport.put("medicineName", entry.getKey());
            medReport.put("taken", taken);
            medReport.put("missed", missed);
            medReport.put("snoozed", snoozed);
            medReport.put("total", medTotal);
            medReport.put("adherenceRate", rate);
            medicineReports.add(medReport);
        }

        // Sort by adherence rate ascending (worst first)
        medicineReports.sort(Comparator.comparingDouble(m -> (double) m.get("adherenceRate")));

        // Daily breakdown
        Map<String, Map<String, Long>> dailyBreakdown = new LinkedHashMap<>();
        for (AdherenceLog log : logs) {
            String day = log.getTimestamp().toLocalDate().toString();
            dailyBreakdown.computeIfAbsent(day, k -> new LinkedHashMap<>());
            Map<String, Long> dayMap = dailyBreakdown.get(day);
            dayMap.merge(log.getStatus(), 1L, Long::sum);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("userId", userId);
        result.put("days", days);
        result.put("overallAdherenceRate", overallRate);
        result.put("totalTaken", totalTaken);
        result.put("totalMissed", totalMissed);
        result.put("totalSnoozed", totalSnoozed);
        result.put("totalLogs", total);
        result.put("medicineBreakdown", medicineReports);
        result.put("dailyBreakdown", dailyBreakdown);

        return result;
    }
}
