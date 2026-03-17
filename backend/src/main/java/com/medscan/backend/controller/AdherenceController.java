package com.medscan.backend.controller;

import com.medscan.backend.model.AdherenceLog;
import com.medscan.backend.service.AdherenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/adherence")
public class AdherenceController {

    @Autowired
    private AdherenceService adherenceService;

    @PostMapping("/log")
    public ResponseEntity<AdherenceLog> logAdherence(@RequestBody LogRequest request) {
        return ResponseEntity.ok(
            adherenceService.logAdherence(
                request.getUserId(), 
                request.getScheduleId(), 
                request.getStatus(), 
                request.getReason()
            )
        );
    }

    @GetMapping("/user/{userId}")
    public ResponseEntity<List<AdherenceLog>> getUserHistory(@PathVariable Long userId) {
        return ResponseEntity.ok(adherenceService.getUserHistory(userId));
    }

    @GetMapping("/group/{groupId}")
    public ResponseEntity<List<AdherenceLog>> getGroupAdherence(@PathVariable Long groupId) {
        return ResponseEntity.ok(adherenceService.getGroupAdherence(groupId));
    }

    @DeleteMapping("/undo")
    public ResponseEntity<?> undoTodayLog(
            @RequestParam Long userId,
            @RequestParam Long scheduleId) {
        boolean deleted = adherenceService.undoTodayLog(userId, scheduleId);
        if (deleted) {
            return ResponseEntity.ok(Map.of("message", "Status undone successfully."));
        }
        return ResponseEntity.badRequest().body(Map.of("message", "No log found for today to undo."));
    }

    @Autowired
    private com.medscan.backend.service.ReportService reportService;

    @GetMapping("/report")
    public ResponseEntity<?> getAdherenceReport(
            @RequestParam Long userId,
            @RequestParam(defaultValue = "30") int days) {
        return ResponseEntity.ok(reportService.generateReport(userId, days));
    }

    // DTO
    public static class LogRequest {
        private Long userId;
        private Long scheduleId;
        private String status;
        private String reason;

        public Long getUserId() { return userId; }
        public void setUserId(Long userId) { this.userId = userId; }
        public Long getScheduleId() { return scheduleId; }
        public void setScheduleId(Long scheduleId) { this.scheduleId = scheduleId; }
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
        public String getReason() { return reason; }
        public void setReason(String reason) { this.reason = reason; }
    }
}
