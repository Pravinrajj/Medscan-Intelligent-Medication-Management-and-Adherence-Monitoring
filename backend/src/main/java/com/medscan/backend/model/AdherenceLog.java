package com.medscan.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "adherence_logs")
public class AdherenceLog {

    @Id
    private String id;
    
    private Long scheduleId;
    private Long userId;
    private String medicineName;
    private LocalDateTime timestamp;
    private String status; // TAKEN, MISSED, SNOOZED
    private String reason;
    private String metadata;

    public AdherenceLog() {}

    public AdherenceLog(Long scheduleId, Long userId, String medicineName,
                        LocalDateTime timestamp, String status, String reason) {
        this.scheduleId = scheduleId;
        this.userId = userId;
        this.medicineName = medicineName;
        this.timestamp = timestamp;
        this.status = status;
        this.reason = reason;
    }
}
