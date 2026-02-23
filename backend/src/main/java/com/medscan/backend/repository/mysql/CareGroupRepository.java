package com.medscan.backend.repository.mysql;

import com.medscan.backend.model.CareGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface CareGroupRepository extends JpaRepository<CareGroup, Long> {
    List<CareGroup> findByAdminId(Long adminId);
}

