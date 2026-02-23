package com.medscan.backend.model;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "prescriptions")
public class Prescription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "prescription_id")
    private Long id;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "image_url")
    private String imageUrl; // Path or URL to stored image

    @Column(name = "extracted_text", columnDefinition = "TEXT")
    private String extractedText;

    @Column(name = "verified_text", columnDefinition = "TEXT")
    private String verifiedText;

    @Column(name = "verified_by_user")
    private Boolean verifiedByUser = false;

    @Column(name = "processed_for_training")
    private Boolean processedForTraining = false;

    @Column(name = "doctor_name")
    private String doctorName;

    @Column(name = "upload_date", updatable = false)
    private LocalDateTime uploadDate;

    @PrePersist
    protected void onCreate() {
        uploadDate = LocalDateTime.now();
    }

}
