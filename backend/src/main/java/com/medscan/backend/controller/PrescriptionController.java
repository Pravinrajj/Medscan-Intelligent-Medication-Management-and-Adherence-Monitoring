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

    @Value("${ml.service.url:http://localhost:8000}")
    private String mlServiceUrl;

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
            // Build multipart request to ML service
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

            // Call ML service
            String scanUrl = mlServiceUrl + "/ocr/scan";
            logger.info("Calling ML service: {}", scanUrl);

            ResponseEntity<Map> mlResponse = restTemplate.exchange(
                    scanUrl,
                    HttpMethod.POST,
                    requestEntity,
                    Map.class);

            Map<String, Object> mlResult = mlResponse.getBody();
            logger.info("ML service response: status={}, medicines={}",
                    mlResult != null ? mlResult.get("status") : "null",
                    mlResult != null && mlResult.get("medicines") != null
                            ? ((List<?>) mlResult.get("medicines")).size()
                            : 0);

            // Wrap ML response with success flag for mobile app compatibility
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.putAll(mlResult != null ? mlResult : new HashMap<>());

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            logger.error("ML service call failed: {}", e.getMessage());

            // Return error response
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("success", false);
            errorResponse.put("status", "error");
            errorResponse.put("message", "ML service unavailable — please try again later. (" + e.getMessage() + ")");
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
