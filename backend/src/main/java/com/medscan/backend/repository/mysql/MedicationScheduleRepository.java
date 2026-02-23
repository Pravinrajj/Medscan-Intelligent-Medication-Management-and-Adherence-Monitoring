package com.medscan.backend.repository.mysql;

import com.medscan.backend.model.MedicationSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface MedicationScheduleRepository extends JpaRepository<MedicationSchedule, Long> {
    List<MedicationSchedule> findByUserId(Long userId);
    List<MedicationSchedule> findByUserIdAndIsActiveTrue(Long userId);
}
