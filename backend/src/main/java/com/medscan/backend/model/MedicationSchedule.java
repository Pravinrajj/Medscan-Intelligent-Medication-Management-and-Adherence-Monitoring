package com.medscan.backend.model;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Entity
@Table(name = "medication_schedules")
public class MedicationSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "schedule_id")
    private Long id;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "medicine_id", nullable = false)
    private Medicine medicine;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "frequency_type")
    private FrequencyType frequencyType;

    @Column(name = "is_active")
    private Boolean isActive = true;

    // Dosage & Inventory
    @Column(name = "dose_amount")
    private Double doseAmount; // e.g., 1.0 or 5.0

    @Column(name = "dose_unit")
    private String doseUnit; // e.g., "Tablet", "ml", "mg"

    @Column(name = "current_stock")
    private Integer currentStock;

    @Column(name = "initial_stock")
    private Integer initialStock;

    @Column(name = "custom_days")
    private String customDays; // e.g., "MON,WED,FRI" for CUSTOM frequency

    @Column(name = "bundle_name")
    private String bundleName; // Optional: group medicines into a bundle (e.g., "Morning Meds")

    @OneToMany(mappedBy = "medicationSchedule", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @Fetch(FetchMode.SUBSELECT)
    private List<ScheduleTime> scheduleTimes = new ArrayList<>();

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    public void addScheduleTime(ScheduleTime time) {
        scheduleTimes.add(time);
        time.setMedicationSchedule(this);
    }
    
    public void removeScheduleTime(ScheduleTime time) {
        scheduleTimes.remove(time);
        time.setMedicationSchedule(null);
    }

    public enum FrequencyType {
        DAILY, WEEKLY, AS_NEEDED, CUSTOM
    }
}
