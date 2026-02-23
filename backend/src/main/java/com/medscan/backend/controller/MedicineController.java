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

import java.util.List;
import java.util.Map;

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
     * Autocomplete search - queries DrugLookup table (CSV data) first,
     * falls back to local Medicine table.
     */
    @GetMapping("/search")
    public ResponseEntity<?> searchMedicines(@RequestParam String query) {
        if (query == null || query.length() < 2) {
            return ResponseEntity.ok(List.of());
        }

        // Search DrugLookup table (253K+ Indian medicines)
        List<DrugLookup> lookups = drugLookupRepository.findTop15ByNameContainingIgnoreCase(query);
        if (!lookups.isEmpty()) {
            return ResponseEntity.ok(lookups);
        }

        // Fallback to local Medicine table
        List<Medicine> medicines = medicineService.searchMedicines(query);
        return ResponseEntity.ok(medicines);
    }

    /**
     * Get detailed drug info by name from DrugLookup table.
     * Includes: description, side effects, drug interactions, composition, manufacturer.
     */
    @GetMapping("/drug-info")
    public ResponseEntity<?> getDrugInfo(@RequestParam String name) {
        DrugLookup lookup = drugLookupRepository.findFirstByNameIgnoreCase(name);
        if (lookup != null) {
            return ResponseEntity.ok(lookup);
        }
        return ResponseEntity.notFound().build();
    }

    /**
     * OpenFDA drug info lookup - for US drugs; secondary source.
     * Returns label information including warnings, indications, and dosage.
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
}
