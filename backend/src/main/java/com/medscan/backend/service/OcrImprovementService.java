package com.medscan.backend.service;

import com.medscan.backend.model.Prescription;
import com.medscan.backend.repository.mysql.PrescriptionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class OcrImprovementService {

    private static final Logger logger = LoggerFactory.getLogger(OcrImprovementService.class);

    @Autowired
    private PrescriptionRepository prescriptionRepository;

    @Scheduled(fixedDelay = 60000 * 5) // Run every 5 minutes
    @Transactional
    public void processOcrCorrections() {

        List<Prescription> unprocessed = prescriptionRepository.findByVerifiedByUserTrueAndProcessedForTrainingFalse();
        
        if (unprocessed.isEmpty()) {
            logger.info("No new OCR corrections to process.");
            return;
        }

        logger.info("Found {} prescriptions with user corrections. Improving model...", unprocessed.size());

        for (Prescription p : unprocessed) {
            // In a real system, this would send the image and verified text to a training pipeline
            simulateModelTraining(p);
            
            p.setProcessedForTraining(true);
            prescriptionRepository.save(p);
        }
        
        logger.info("Batch processing completed.");
    }

    private void simulateModelTraining(Prescription p) {
        // Here we would append to a training dataset
        String original = p.getExtractedText();
        String corrected = p.getVerifiedText();
        
        // Calculate similarity for analytics (simple Levenshtein distance simulation)
        // ...
        
        logger.info("Processed Prescription ID {}: Original Length={}, Corrected Length={}", 
                p.getId(), 
                original != null ? original.length() : 0, 
                corrected != null ? corrected.length() : 0);
    }
}
