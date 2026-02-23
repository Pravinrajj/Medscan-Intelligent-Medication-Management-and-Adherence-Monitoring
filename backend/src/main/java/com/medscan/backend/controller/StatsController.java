package com.medscan.backend.controller;

import com.medscan.backend.service.StatsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/stats")
public class StatsController {

    @Autowired
    private StatsService statsService;

    @GetMapping("/user/{userId}")
    public ResponseEntity<Map<String, Object>> getUserStats(@PathVariable Long userId) {
        return ResponseEntity.ok(statsService.getUserStats(userId));
    }

    @GetMapping("/user/{userId}/medicine/{medicineName}")
    public ResponseEntity<Map<String, Object>> getMedicineStats(
            @PathVariable Long userId, 
            @PathVariable String medicineName) {
        return ResponseEntity.ok(statsService.getMedicineStats(userId, medicineName));
    }
}
