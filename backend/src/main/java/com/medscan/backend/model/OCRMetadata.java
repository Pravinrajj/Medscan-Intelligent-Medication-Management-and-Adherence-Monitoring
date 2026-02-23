package com.medscan.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "ocr_metadata")
public class OCRMetadata {

    @Id
    private String id;
    
    private Long userId;
    private String imageHash;
    private String extractedTextRaw;
    private String userCorrections;
    private LocalDateTime timestamp;

    public OCRMetadata() {}

    public OCRMetadata(Long userId, String imageHash, String extractedTextRaw) {
        this.userId = userId;
        this.imageHash = imageHash;
        this.extractedTextRaw = extractedTextRaw;
        this.timestamp = LocalDateTime.now();
    }

}
