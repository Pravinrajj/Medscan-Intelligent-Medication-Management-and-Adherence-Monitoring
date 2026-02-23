package com.medscan.backend.controller;

import com.medscan.backend.model.Medicine;
import com.medscan.backend.model.Prescription;
import com.medscan.backend.model.User;
import com.medscan.backend.repository.mysql.PrescriptionRepository;
import com.medscan.backend.repository.mysql.UserRepository;
import com.medscan.backend.service.MedicineService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/prescriptions")
public class PrescriptionController {

    @Autowired
    private PrescriptionRepository prescriptionRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private MedicineService medicineService;

    @GetMapping("/user/{userId}")
    public ResponseEntity<List<Prescription>> getUserPrescriptions(@PathVariable Long userId) {
        return ResponseEntity.ok(prescriptionRepository.findByUserId(userId));
    }

    /**
     * OCR Stub - Now Returns VERIFIED Medicines from DB.
     * Simulates scanning logic:
     * 1. Extract text (Simulated)
     * 2. Search DB for matches
     * 3. Return verified objects
     */
    @PostMapping("/scan")
    public ResponseEntity<?> scanPrescription(
            @RequestParam("image") MultipartFile file) {

        // In production: calling a Python ML Service here -> returns "Para", "Amox"
        // For Stub: We simulate extracted text and then FIND them in our DB.
        
        List<Map<String, Object>> verifiedMedicines = new ArrayList<>();
        
        // 1. Simulate "Paracetamol" detection
        List<Medicine> paraMatches = medicineService.searchMedicines("Paracetamol");
        if (!paraMatches.isEmpty()) {
            Medicine m = paraMatches.get(0);
            Map<String, Object> entry = new HashMap<>();
            entry.put("id", m.getId());
            entry.put("name", m.getName());
            entry.put("type", m.getType() != null ? m.getType() : "TABLET");
            entry.put("dosage", m.getDosageStrength() != null ? m.getDosageStrength() : "");
            entry.put("description", m.getDescription() != null ? m.getDescription() : "");
            entry.put("frequency", "Twice daily");
            entry.put("duration", "5 days");
            verifiedMedicines.add(entry);
        }

        // 2. Simulate "Amoxicillin" detection
        List<Medicine> amoxMatches = medicineService.searchMedicines("Amoxicillin");
        if (!amoxMatches.isEmpty()) {
            Medicine m = amoxMatches.get(0);
            Map<String, Object> entry = new HashMap<>();
            entry.put("id", m.getId());
            entry.put("name", m.getName());
            entry.put("type", m.getType() != null ? m.getType() : "TABLET");
            entry.put("dosage", m.getDosageStrength() != null ? m.getDosageStrength() : "");
            entry.put("description", m.getDescription() != null ? m.getDescription() : "");
            entry.put("frequency", "Three times daily");
            entry.put("duration", "7 days");
            verifiedMedicines.add(entry);
        }

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("medicines", verifiedMedicines);
        response.put("rawText", "Rx\nParacetamol 500mg BD x 5 days\nAmoxicillin 250mg TDS x 7 days");
        
        return ResponseEntity.ok(response);
    }

    // ... uploadPrescription and verifyPrescription methods remain same ...
    @PostMapping("/user/{userId}")
    public ResponseEntity<Prescription> uploadPrescription(
            @PathVariable Long userId,
            @RequestParam("image") MultipartFile file,
            @RequestParam(value = "doctorName", required = false) String doctorName,
            @RequestParam(value = "extractedText", required = false) String extractedText) {
        
        String simulatedUrl = "uploads/" + file.getOriginalFilename();

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        Prescription prescription = new Prescription();
        prescription.setUser(user);
        prescription.setImageUrl(simulatedUrl);
        prescription.setDoctorName(doctorName);
        prescription.setExtractedText(extractedText != null ? extractedText : "Pending OCR processing...");

        return ResponseEntity.ok(prescriptionRepository.save(prescription));
    }

    @PutMapping("/verify/{prescriptionId}")
    public ResponseEntity<Prescription> verifyPrescription(
            @PathVariable Long prescriptionId,
            @RequestBody VerificationRequest request) {
        
        Prescription prescription = prescriptionRepository.findById(prescriptionId)
                .orElseThrow(() -> new RuntimeException("Prescription not found"));
        
        prescription.setVerifiedText(request.getVerifiedText());
        prescription.setVerifiedByUser(true);
        
        return ResponseEntity.ok(prescriptionRepository.save(prescription));
    }

    public static class VerificationRequest {
        private String verifiedText;
        public String getVerifiedText() { return verifiedText; }
        public void setVerifiedText(String verifiedText) { this.verifiedText = verifiedText; }
    }
}
