package com.medscan.backend.repository.mysql;

import com.medscan.backend.model.DrugLookup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DrugLookupRepository extends JpaRepository<DrugLookup, Long> {
    List<DrugLookup> findTop15ByNameContainingIgnoreCase(String name);
    DrugLookup findFirstByNameIgnoreCase(String name);
}
