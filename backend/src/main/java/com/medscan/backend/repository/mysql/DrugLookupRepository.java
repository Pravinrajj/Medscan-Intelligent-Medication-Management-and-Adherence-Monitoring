package com.medscan.backend.repository.mysql;

import com.medscan.backend.model.DrugLookup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DrugLookupRepository extends JpaRepository<DrugLookup, Long> {

    // Search by brand name
    List<DrugLookup> findTop15ByNameContainingIgnoreCase(String name);
    DrugLookup findFirstByNameIgnoreCase(String name);

    // Search by salt/generic name
    List<DrugLookup> findTop15BySaltNameContainingIgnoreCase(String saltName);
    DrugLookup findFirstBySaltNameIgnoreCase(String saltName);

    // Search across both brand and salt name
    List<DrugLookup> findTop20ByNameContainingIgnoreCaseOrSaltNameContainingIgnoreCase(
            String name, String saltName);

    // By therapeutic class
    List<DrugLookup> findByTherapeuticClassIgnoreCase(String therapeuticClass);
}
