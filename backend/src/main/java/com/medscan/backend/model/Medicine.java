package com.medscan.backend.model;

import jakarta.persistence.*;
import lombok.Data;
import lombok.Getter;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "medicines")
public class Medicine {

    // Getters and Setters
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "medicine_id")
    private Long id;

    @Column(nullable = false)
    private String name;

    private String manufacturer;

    @Enumerated(EnumType.STRING)
    private MedicineType type;

    @Column(name = "dosage_strength")
    private String dosageStrength;

    private String description;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    public enum MedicineType {
        TABLET, SYRUP, INJECTION, DROPS, OTHER
    }

}
