package com.medscan.backend.controller;

import com.medscan.backend.model.User;
import com.medscan.backend.repository.mysql.UserRepository;
import com.medscan.backend.service.PushNotificationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Optional;

/**
 * NotificationController handles push token registration and test endpoints.
 */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PushNotificationService pushService;

    /**
     * Register or update a user's Expo push token.
     * Called by the mobile app after obtaining the push token.
     * POST /api/notifications/token
     * Body: { "userId": 1, "token": "ExponentPushToken[xxx]" }
     */
    @PostMapping("/token")
    public ResponseEntity<?> registerToken(@RequestBody Map<String, Object> body) {
        Long userId = body.get("userId") != null 
            ? Long.valueOf(body.get("userId").toString()) : null;
        String token = (String) body.get("token");

        if (userId == null || token == null || token.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("message", "userId and token are required"));
        }

        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("message", "User not found"));
        }

        User user = userOpt.get();
        user.setExpoPushToken(token);
        userRepository.save(user);

        return ResponseEntity.ok(Map.of(
            "message", "Push token registered",
            "userId", userId
        ));
    }

    /**
     * Send a test push notification to a user.
     * POST /api/notifications/test
     * Body: { "userId": 1, "title": "Test", "body": "Hello!" }
     */
    @PostMapping("/test")
    public ResponseEntity<?> sendTest(@RequestBody Map<String, String> body) {
        Long userId = body.get("userId") != null 
            ? Long.valueOf(body.get("userId")) : null;
        String title = body.getOrDefault("title", "Test Notification");
        String message = body.getOrDefault("body", "This is a test from MedScan");

        if (userId == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("message", "userId is required"));
        }

        boolean sent = pushService.sendToUser(userId, title, message);
        return ResponseEntity.ok(Map.of(
            "sent", sent,
            "message", sent ? "Notification sent" : "Failed - user may not have a push token"
        ));
    }
}
