package com.medscan.backend.controller;

import com.medscan.backend.service.AdherenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * SyncController handles batch processing of offline-queued actions.
 * When mobile clients come back online, they send all queued adherence logs
 * in a single batch request for efficient syncing.
 * Uses timestamp-based conflict resolution (last-write-wins).
 */
@RestController
@RequestMapping("/api/sync")
public class SyncController {

    @Autowired
    private AdherenceService adherenceService;

    private static final DateTimeFormatter ISO_FORMATTER = DateTimeFormatter.ISO_DATE_TIME;

    /**
     * Process a batch of adherence logs that were queued offline.
     * Each item: { scheduleId, userId, status, timestamp (ISO string) }
     */
    @PostMapping("/batch")
    public ResponseEntity<?> processBatch(@RequestBody List<Map<String, Object>> batchItems) {
        int success = 0;
        int failed = 0;
        List<String> errors = new ArrayList<>();

        for (Map<String, Object> item : batchItems) {
            try {
                Long scheduleId = item.get("scheduleId") != null 
                    ? Long.valueOf(item.get("scheduleId").toString()) : null;
                Long userId = item.get("userId") != null 
                    ? Long.valueOf(item.get("userId").toString()) : null;
                String status = (String) item.get("status");
                String timestampStr = (String) item.get("timestamp");

                if (userId == null || status == null) {
                    failed++;
                    errors.add("Missing required fields: userId or status");
                    continue;
                }

                // Parse client timestamp for conflict resolution
                LocalDateTime clientTimestamp = null;
                if (timestampStr != null && !timestampStr.isEmpty()) {
                    try {
                        clientTimestamp = LocalDateTime.parse(timestampStr, ISO_FORMATTER);
                    } catch (Exception e) {
                        try {
                            String cleaned = timestampStr.replaceAll("Z$", "").replaceAll("\\+.*$", "");
                            clientTimestamp = LocalDateTime.parse(cleaned);
                        } catch (Exception e2) {
                            clientTimestamp = LocalDateTime.now();
                        }
                    }
                }

                adherenceService.logAdherenceWithTimestamp(userId, scheduleId, status, null, clientTimestamp);
                success++;
            } catch (Exception e) {
                failed++;
                errors.add("Error processing item: " + e.getMessage());
            }
        }

        Map<String, Object> result = new HashMap<>();
        result.put("total", batchItems.size());
        result.put("success", success);
        result.put("failed", failed);
        if (!errors.isEmpty()) {
            result.put("errors", errors);
        }

        return ResponseEntity.ok(result);
    }
}
