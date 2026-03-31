package com.medscan.backend.repository.mysql;

import com.medscan.backend.model.SharedSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SharedScheduleRepository extends JpaRepository<SharedSchedule, Long> {
    List<SharedSchedule> findByGroupId(Long groupId);
    List<SharedSchedule> findByGroupIdAndSharedByUserId(Long groupId, Long userId);
    Optional<SharedSchedule> findByGroupIdAndScheduleId(Long groupId, Long scheduleId);
    void deleteByGroupIdAndScheduleId(Long groupId, Long scheduleId);
}
