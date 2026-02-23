package com.medscan.backend.service;

import com.medscan.backend.model.User;
import com.medscan.backend.repository.mysql.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;

/**
 * PushNotificationService sends push notifications via the Expo Push API.
 * 
 * Expo Push API endpoint: https://exp.host/--/api/v2/push/send
 * Token format: ExponentPushToken[xxxxx]
 */
@Service
public class PushNotificationService {

    private static final String EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

    @Autowired
    private UserRepository userRepository;

    /**
     * Send a push notification to a single user by userId.
     */
    public boolean sendToUser(Long userId, String title, String body) {
        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) return false;

        String token = userOpt.get().getExpoPushToken();
        if (token == null || token.isEmpty()) return false;

        return sendPush(token, title, body, null);
    }

    /**
     * Send a push notification to a single Expo push token.
     */
    public boolean sendPush(String token, String title, String body, String data) {
        try {
            String jsonPayload = String.format(
                "{\"to\":\"%s\",\"title\":\"%s\",\"body\":\"%s\",\"sound\":\"default\"%s}",
                escapeJson(token),
                escapeJson(title),
                escapeJson(body),
                data != null ? ",\"data\":" + data : ""
            );

            URL url = new URL(EXPO_PUSH_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setDoOutput(true);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonPayload.getBytes(StandardCharsets.UTF_8));
            }

            int responseCode = conn.getResponseCode();
            conn.disconnect();

            return responseCode == 200;
        } catch (Exception e) {
            System.err.println("[PushNotification] Failed to send: " + e.getMessage());
            return false;
        }
    }

    /**
     * Send notifications to all members of a care group (e.g., when someone misses a dose).
     */
    public void notifyGroupMembers(List<Long> memberUserIds, String title, String body) {
        for (Long memberId : memberUserIds) {
            sendToUser(memberId, title, body);
        }
    }

    /**
     * Notify caregivers when a patient misses a dose.
     */
    public void notifyMissedDose(Long patientUserId, String medicineName, List<Long> caregiverUserIds) {
        Optional<User> patientOpt = userRepository.findById(patientUserId);
        String patientName = patientOpt.map(User::getFullName).orElse("A patient");

        String title = "⚠️ Missed Dose Alert";
        String body = patientName + " missed their " + medicineName + " dose.";

        for (Long caregiverId : caregiverUserIds) {
            if (!caregiverId.equals(patientUserId)) {
                sendToUser(caregiverId, title, body);
            }
        }
    }

    /**
     * Send a medication reminder to a user.
     */
    public void sendMedicationReminder(Long userId, String medicineName) {
        String title = "💊 Medication Reminder";
        String body = "Time to take your " + medicineName;
        sendToUser(userId, title, body);
    }

    private String escapeJson(String str) {
        if (str == null) return "";
        return str.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n");
    }
}
