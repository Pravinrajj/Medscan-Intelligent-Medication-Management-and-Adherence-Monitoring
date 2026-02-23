package com.medscan.backend.repository.mongo;

import com.medscan.backend.model.AdherenceLog;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface AdherenceRepository extends MongoRepository<AdherenceLog, String> {
    List<AdherenceLog> findByUserId(Long userId);
    List<AdherenceLog> findByScheduleId(Long scheduleId);
    List<AdherenceLog> findByUserIdIn(List<Long> userIds);
    List<AdherenceLog> findByUserIdAndTimestampAfter(Long userId, LocalDateTime timestamp);
    List<AdherenceLog> findByUserIdAndMedicineNameAndTimestampAfter(Long userId, String medicineName, LocalDateTime timestamp);
    long countByScheduleIdAndTimestampAfter(Long scheduleId, LocalDateTime timestamp);
    Optional<AdherenceLog> findFirstByScheduleIdAndTimestampBetween(Long scheduleId, LocalDateTime start, LocalDateTime end);
}
