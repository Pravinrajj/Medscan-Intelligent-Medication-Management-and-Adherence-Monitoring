package com.medscan.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "group_activity")
public class GroupActivity {

    @Id
    private String id;
    
    private Long groupId;
    private Long performedByUserId;
    private String activityType; // MEMBER_ADDED, SCHEDULE_CHANGED, MEDICATION_ADDED
    private String message;
    private LocalDateTime timestamp;

    public GroupActivity() {}

    public GroupActivity(Long groupId, Long performedByUserId, String activityType, String message) {
        this.groupId = groupId;
        this.performedByUserId = performedByUserId;
        this.activityType = activityType;
        this.message = message;
        this.timestamp = LocalDateTime.now();
    }

}
