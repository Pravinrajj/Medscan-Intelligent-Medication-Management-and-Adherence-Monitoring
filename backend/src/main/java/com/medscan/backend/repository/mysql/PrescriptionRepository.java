package com.medscan.backend.repository.mysql;

import com.medscan.backend.model.Prescription;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface PrescriptionRepository extends JpaRepository<Prescription, Long> {
    List<Prescription> findByUserId(Long userId);
    List<Prescription> findByVerifiedByUserTrueAndProcessedForTrainingFalse();
}
