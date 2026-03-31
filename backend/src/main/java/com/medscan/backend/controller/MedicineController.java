package com.medscan.backend.controller;

import com.medscan.backend.model.DrugLookup;
import com.medscan.backend.model.Medicine;
import com.medscan.backend.repository.mysql.DrugLookupRepository;
import com.medscan.backend.service.MedicineService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/medicines")
public class MedicineController {

    @Autowired
    private MedicineService medicineService;

    @Autowired
    private DrugLookupRepository drugLookupRepository;

    @Value("${openfda.api.key:}")
    private String openFdaApiKey;

    /**
     * Autocomplete search — queries local Medicine table.
     */
    @GetMapping("/search")
    public ResponseEntity<?> searchMedicines(@RequestParam String query) {
        if (query == null || query.length() < 2) {
            return ResponseEntity.ok(List.of());
        }
        List<Medicine> medicines = medicineService.searchMedicines(query);
        return ResponseEntity.ok(medicines);
    }

    /**
     * Get detailed drug info by name from DrugLookup table.
     * Searches both brand name and salt name.
     */
    @GetMapping("/drug-info")
    public ResponseEntity<?> getDrugInfo(@RequestParam String name) {
        // Try exact brand name match first
        DrugLookup lookup = drugLookupRepository.findFirstByNameIgnoreCase(name);
        if (lookup == null) {
            // Try salt name
            lookup = drugLookupRepository.findFirstBySaltNameIgnoreCase(name);
        }
        if (lookup != null) {
            return ResponseEntity.ok(buildDrugInfoResponse(lookup));
        }
        return ResponseEntity.notFound().build();
    }

    /**
     * Search drug database — returns matches from both brand and salt names.
     * Used for drug lookup and interaction checking.
     */
    @GetMapping("/drug-search")
    public ResponseEntity<?> searchDrugDatabase(@RequestParam String query) {
        if (query == null || query.length() < 2) {
            return ResponseEntity.ok(List.of());
        }
        List<DrugLookup> results = drugLookupRepository
                .findTop20ByNameContainingIgnoreCaseOrSaltNameContainingIgnoreCase(query, query);

        // Sort: salt name matches first (generic names), then brand matches
        String q = query.toLowerCase();
        results.sort((a, b) -> {
            boolean aSalt = a.getSaltName() != null && a.getSaltName().toLowerCase().contains(q);
            boolean bSalt = b.getSaltName() != null && b.getSaltName().toLowerCase().contains(q);
            if (aSalt && !bSalt) return -1;
            if (!aSalt && bSalt) return 1;
            // Within salt matches, prefer shorter names (more generic)
            if (aSalt && bSalt) {
                return Integer.compare(
                    a.getSaltName().length(),
                    b.getSaltName().length()
                );
            }
            return 0;
        });

        List<Map<String, Object>> response = new ArrayList<>();
        for (DrugLookup dl : results) {
            response.add(buildDrugInfoResponse(dl));
        }
        return ResponseEntity.ok(response);
    }

    /**
     * Get drug interactions for a given medicine.
     * Returns parsed interaction data from the JSON drug_interactions field.
     */
    @GetMapping("/interactions")
    public ResponseEntity<?> getDrugInteractions(@RequestParam String name) {
        DrugLookup lookup = drugLookupRepository.findFirstByNameIgnoreCase(name);
        if (lookup == null) {
            lookup = drugLookupRepository.findFirstBySaltNameIgnoreCase(name);
        }
        if (lookup != null && lookup.getDrugInteractions() != null) {
            Map<String, Object> response = new HashMap<>();
            response.put("medicine", lookup.getName());
            response.put("saltName", lookup.getSaltName());
            response.put("interactions", lookup.getDrugInteractions()); // JSON string
            return ResponseEntity.ok(response);
        }
        return ResponseEntity.ok(Map.of("medicine", name, "interactions", "[]"));
    }

    /**
     * OpenFDA drug info lookup — secondary source for US drugs.
     */
    @GetMapping("/openfda-info")
    public ResponseEntity<?> getOpenFdaInfo(@RequestParam String name) {
        try {
            RestTemplate restTemplate = new RestTemplate();
            String url = "https://api.fda.gov/drug/label.json?search=openfda.brand_name:\"" + name + "\"&limit=1";
            if (openFdaApiKey != null && !openFdaApiKey.isEmpty()) {
                url += "&api_key=" + openFdaApiKey;
            }
            String response = restTemplate.getForObject(url, String.class);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("error", "No OpenFDA data found for: " + name));
        }
    }

    @PostMapping
    public ResponseEntity<Medicine> addMedicine(@RequestBody Medicine medicine) {
        return ResponseEntity.ok(medicineService.saveMedicine(medicine));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Medicine> getMedicineById(@PathVariable Long id) {
        Medicine medicine = medicineService.getMedicineById(id);
        if (medicine != null) {
            return ResponseEntity.ok(medicine);
        }
        return ResponseEntity.notFound().build();
    }

    // ─── Helper ──────────────────────────────────────────────────
    private Map<String, Object> buildDrugInfoResponse(DrugLookup dl) {
        Map<String, Object> info = new HashMap<>();
        info.put("id", dl.getId());
        info.put("name", dl.getName());
        info.put("saltName", dl.getSaltName());
        info.put("description", dl.getDescription());
        info.put("manufacturer", dl.getManufacturer());
        info.put("price", dl.getPrice());
        info.put("sideEffects", dl.getSideEffects());
        info.put("therapeuticClass", dl.getTherapeuticClass());
        info.put("drugInteractions", dl.getDrugInteractions());
        return info;
    }
}
