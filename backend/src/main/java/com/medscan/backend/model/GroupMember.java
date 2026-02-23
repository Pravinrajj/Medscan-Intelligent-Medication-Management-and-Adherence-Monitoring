package com.medscan.backend.model;

import jakarta.persistence.*;
import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "group_members")
public class GroupMember {

    @EmbeddedId
    private GroupMemberId id;

    @ManyToOne(fetch = FetchType.EAGER)
    @MapsId("groupId")
    @JoinColumn(name = "group_id")
    private CareGroup group;

    @ManyToOne(fetch = FetchType.EAGER)
    @MapsId("userId")
    @JoinColumn(name = "user_id")
    private User user;

    @Column(name = "joined_at", updatable = false)
    private LocalDateTime joinedAt;

    @PrePersist
    protected void onCreate() {
        joinedAt = LocalDateTime.now();
    }

    public GroupMember() {}
    
    public GroupMember(CareGroup group, User user) {
        this.group = group;
        this.user = user;
        this.id = new GroupMemberId(group.getId(), user.getId());
    }


    @Embeddable
    public static class GroupMemberId implements Serializable {
        private Long groupId;
        private Long userId;

        public GroupMemberId() {}
        public GroupMemberId(Long groupId, Long userId) {
            this.groupId = groupId;
            this.userId = userId;
        }

        // Equals and HashCode (Required for Composite Keys)
        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            GroupMemberId that = (GroupMemberId) o;
            return groupId.equals(that.groupId) && userId.equals(that.userId);
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(groupId, userId);
        }
        
        public Long getGroupId() { return groupId; }
        public void setGroupId(Long groupId) { this.groupId = groupId; }
        public Long getUserId() { return userId; }
        public void setUserId(Long userId) { this.userId = userId; }
    }
}
