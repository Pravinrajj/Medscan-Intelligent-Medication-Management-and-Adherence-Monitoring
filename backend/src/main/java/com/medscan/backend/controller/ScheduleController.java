package com.medscan.backend.controller;

import com.medscan.backend.model.MedicationSchedule;
import com.medscan.backend.service.ScheduleService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalTime;
import java.util.List;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/schedules")
public class ScheduleController {

    @Autowired
    private ScheduleService scheduleService;

    @GetMapping("/user/{userId}")
    public ResponseEntity<List<MedicationSchedule>> getUserSchedules(@PathVariable Long userId) {
        return ResponseEntity.ok(scheduleService.getUserSchedules(userId));
    }

    @PostMapping("/user/{userId}/medicine/{medicineId}")
    public ResponseEntity<MedicationSchedule> createSchedule(
            @PathVariable Long userId,
            @PathVariable Long medicineId,
            @RequestBody ScheduleRequest scheduleRequest) {
        
        MedicationSchedule schedule = new MedicationSchedule();
        schedule.setStartDate(scheduleRequest.getStartDate());
        schedule.setEndDate(scheduleRequest.getEndDate());
        schedule.setFrequencyType(scheduleRequest.getFrequencyType());
        schedule.setCustomDays(scheduleRequest.getCustomDays());
        
        // Inventory
        schedule.setDoseAmount(scheduleRequest.getDoseAmount());
        schedule.setDoseUnit(scheduleRequest.getDoseUnit());
        schedule.setCurrentStock(scheduleRequest.getCurrentStock());
        schedule.setInitialStock(scheduleRequest.getCurrentStock());

        return ResponseEntity.ok(scheduleService.createSchedule(userId, medicineId, schedule, scheduleRequest.getTimes()));
    }

    @PutMapping("/{scheduleId}")
    public ResponseEntity<MedicationSchedule> updateSchedule(
            @PathVariable Long scheduleId,
            @RequestBody ScheduleRequest request) {
        
        MedicationSchedule updates = new MedicationSchedule();
        updates.setDoseAmount(request.getDoseAmount());
        updates.setDoseUnit(request.getDoseUnit());
        updates.setCurrentStock(request.getCurrentStock());
        updates.setFrequencyType(request.getFrequencyType());
        updates.setCustomDays(request.getCustomDays());
        updates.setEndDate(request.getEndDate());

        return ResponseEntity.ok(scheduleService.updateSchedule(scheduleId, updates, request.getTimes()));
    }

    @DeleteMapping("/{scheduleId}")
    public ResponseEntity<?> deleteSchedule(@PathVariable Long scheduleId) {
        scheduleService.deleteSchedule(scheduleId);
        return ResponseEntity.ok().build();
    }

    // Inner DTO for Request
    public static class ScheduleRequest {
        private java.time.LocalDate startDate;
        private java.time.LocalDate endDate;
        private MedicationSchedule.FrequencyType frequencyType;
        private List<LocalTime> times;
        
        // New Inventory Fields
        private Double doseAmount;
        private String doseUnit;
        private Integer currentStock;
        private String customDays;

        // Getters/Setters
        public java.time.LocalDate getStartDate() { return startDate; }
        public void setStartDate(java.time.LocalDate startDate) { this.startDate = startDate; }
        public java.time.LocalDate getEndDate() { return endDate; }
        public void setEndDate(java.time.LocalDate endDate) { this.endDate = endDate; }
        public MedicationSchedule.FrequencyType getFrequencyType() { return frequencyType; }
        public void setFrequencyType(MedicationSchedule.FrequencyType frequencyType) { this.frequencyType = frequencyType; }
        public List<LocalTime> getTimes() { return times; }
        public void setTimes(List<LocalTime> times) { this.times = times; }
        
        public Double getDoseAmount() { return doseAmount; }
        public void setDoseAmount(Double doseAmount) { this.doseAmount = doseAmount; }
        public String getDoseUnit() { return doseUnit; }
        public void setDoseUnit(String doseUnit) { this.doseUnit = doseUnit; }
        public Integer getCurrentStock() { return currentStock; }
        public void setCurrentStock(Integer currentStock) { this.currentStock = currentStock; }
        public String getCustomDays() { return customDays; }
        public void setCustomDays(String customDays) { this.customDays = customDays; }
    }
}
