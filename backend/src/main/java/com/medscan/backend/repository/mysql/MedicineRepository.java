package com.medscan.backend.repository.mysql;

import com.medscan.backend.model.Medicine;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface MedicineRepository extends JpaRepository<Medicine, Long> {
    List<Medicine> findByNameContainingIgnoreCase(String name);
    Medicine findFirstByNameIgnoreCase(String name);
}
