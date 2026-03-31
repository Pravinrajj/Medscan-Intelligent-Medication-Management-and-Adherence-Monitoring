package com.medscan.backend.controller;

import com.medscan.backend.model.Prescription;
import com.medscan.backend.model.User;
import com.medscan.backend.repository.mysql.PrescriptionRepository;
import com.medscan.backend.repository.mysql.UserRepository;
import com.medscan.backend.service.MedicineService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/prescriptions")
public class PrescriptionController {

    private static final Logger logger = LoggerFactory.getLogger(PrescriptionController.class);

    @Autowired
    private PrescriptionRepository prescriptionRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private MedicineService medicineService;

    @Value("${ocr.service.url:http://localhost:8000}")
    private String ocrServiceUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    @GetMapping("/user/{userId}")
    public ResponseEntity<List<Prescription>> getUserPrescriptions(@PathVariable Long userId) {
        return ResponseEntity.ok(prescriptionRepository.findByUserId(userId));
    }

    /**
     * Prescription Scan — calls ML service for real OCR + CNN analysis.
     * Pipeline: Image → ML Service (8-stage) → Structured medicine results
     */
    @PostMapping("/scan")
    public ResponseEntity<?> scanPrescription(
            @RequestParam("image") MultipartFile file) {

        logger.info("Scan request received: {}, size={}KB",
                file.getOriginalFilename(),
                file.getSize() / 1024);

        try {
            // Build multipart request to mediscan-ocr service
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("file", new ByteArrayResource(file.getBytes()) {
                @Override
                public String getFilename() {
                    return file.getOriginalFilename();
                }
            });

            HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);

            // Call mediscan-ocr service
            String scanUrl = ocrServiceUrl + "/extract-text/";
            logger.info("Calling OCR service: {}", scanUrl);

            ResponseEntity<Map> ocrResponse = restTemplate.exchange(
                    scanUrl,
                    HttpMethod.POST,
                    requestEntity,
                    Map.class);

            Map<String, Object> ocrResult = ocrResponse.getBody();
            List<Map<String, Object>> rawMedicines = ocrResult != null && ocrResult.get("medicines") != null
                    ? (List<Map<String, Object>>) ocrResult.get("medicines")
                    : List.of();

            logger.info("OCR service response: {} medicines found", rawMedicines.size());

            // Map mediscan-ocr response to mobile-app expected format
            List<Map<String, Object>> mappedMedicines = new java.util.ArrayList<>();
            for (Map<String, Object> med : rawMedicines) {
                Map<String, Object> mapped = new HashMap<>();
                mapped.put("name", med.getOrDefault("matched_name",
                        med.getOrDefault("extracted_text", "Unknown")));
                mapped.put("matchScore", med.get("match_score"));
                // Extract dosage/frequency from details if available
                Map<String, Object> details = med.get("details") instanceof Map
                        ? (Map<String, Object>) med.get("details") : null;
                if (details != null) {
                    mapped.put("manufacturer", details.get("manufacturer"));
                    mapped.put("composition", details.get("composition"));
                    mapped.put("sideEffects", details.get("side_effects"));
                }
                mappedMedicines.add(mapped);
            }

            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("medicines", mappedMedicines);
            response.put("rawText", ocrResult != null ? ocrResult.get("raw_text") : "");
            response.put("confidence", ocrResult != null ? ocrResult.get("confidence") : null);
            response.put("processingTimeMs", ocrResult != null ? ocrResult.get("processing_time_ms") : null);

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            logger.error("OCR service call failed: {}", e.getMessage());

            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("success", false);
            errorResponse.put("status", "error");
            errorResponse.put("message", "OCR service unavailable. Make sure mediscan-ocr is running on port 8000.");
            errorResponse.put("medicines", List.of());

            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(errorResponse);
        }
    }

    /**
     * Strip Scan — calls mediscan-ocr strip reader for medicine name extraction from tablet strips.
     */
    @PostMapping("/scan-strip")
    public ResponseEntity<?> scanStrip(
            @RequestParam("image") MultipartFile file) {

        logger.info("Strip scan request received: {}, size={}KB",
                file.getOriginalFilename(),
                file.getSize() / 1024);

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("file", new ByteArrayResource(file.getBytes()) {
                @Override
                public String getFilename() {
                    return file.getOriginalFilename();
                }
            });

            HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);

            String stripUrl = ocrServiceUrl + "/extract-medicine-name/";
            logger.info("Calling strip reader: {}", stripUrl);

            ResponseEntity<Map> ocrResponse = restTemplate.exchange(
                    stripUrl,
                    HttpMethod.POST,
                    requestEntity,
                    Map.class);

            Map<String, Object> ocrResult = ocrResponse.getBody();

            // Map strip response to mobile-app format
            String medicineName = ocrResult != null ? (String) ocrResult.get("medicine_name") : null;
            logger.info("Strip reader result: medicine_name={}", medicineName);

            Map<String, Object> response = new HashMap<>();
            response.put("success", medicineName != null && !medicineName.isEmpty());
            response.put("rawText", ocrResult != null ? ocrResult.get("raw_text") : "");
            response.put("processingTimeMs", ocrResult != null ? ocrResult.get("processing_time_ms") : null);

            // Build medicines list with the single detected medicine
            if (medicineName != null && !medicineName.isEmpty()) {
                Map<String, Object> med = new HashMap<>();
                med.put("name", medicineName);
                med.put("matchScore", ocrResult.get("confidence"));

                // Include DB match details if available
                Map<String, Object> dbMatch = ocrResult.get("db_match") instanceof Map
                        ? (Map<String, Object>) ocrResult.get("db_match") : null;
                if (dbMatch != null) {
                    med.put("name", dbMatch.getOrDefault("matched_name", medicineName));
                    med.put("matchScore", dbMatch.get("match_score"));
                    Map<String, Object> details = dbMatch.get("details") instanceof Map
                            ? (Map<String, Object>) dbMatch.get("details") : null;
                    if (details != null) {
                        med.put("manufacturer", details.get("manufacturer"));
                        med.put("composition", details.get("composition"));
                        med.put("sideEffects", details.get("side_effects"));
                    }
                }

                response.put("medicines", List.of(med));
            } else {
                response.put("medicines", List.of());
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            logger.error("Strip scan service call failed: {}", e.getMessage());

            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("success", false);
            errorResponse.put("status", "error");
            errorResponse.put("message", "OCR service unavailable. Make sure mediscan-ocr is running on port 8000.");
            errorResponse.put("medicines", List.of());

            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(errorResponse);
        }
    }

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

        public String getVerifiedText() {
            return verifiedText;
        }

        public void setVerifiedText(String verifiedText) {
            this.verifiedText = verifiedText;
        }
    }
}
