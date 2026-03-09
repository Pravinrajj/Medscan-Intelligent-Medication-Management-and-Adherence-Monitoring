import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api/client';
import offlineSyncService from './OfflineSyncService';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Notification category with Take / Snooze action buttons
const MEDICATION_CATEGORY = 'MEDICATION_REMINDER';

/**
 * Register the MEDICATION_REMINDER category with Take + Snooze buttons.
 * Call once on app startup.
 */
export async function setupNotificationActions() {
  try {
    await Notifications.setNotificationCategoryAsync(MEDICATION_CATEGORY, [
      {
        identifier: 'TAKE',
        buttonTitle: '💊 Take',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'SNOOZE',
        buttonTitle: '⏰ Snooze (15m)',
        options: { opensAppToForeground: false },
      },
    ]);
    console.log('[Notifications] Category registered:', MEDICATION_CATEGORY);
  } catch (e) {
    console.log('[Notifications] Category registration failed:', e.message);
  }
}

/**
 * Handle notification action responses (Take / Snooze).
 * Returns a subscription you should clean up on unmount.
 */
export function addNotificationActionListener() {
  return Notifications.addNotificationResponseReceivedListener(async (response) => {
    const actionId = response.actionIdentifier;
    const data = response.notification.request.content.data || {};
    const { scheduleId, userId, notificationId } = data;

    console.log(`[Notifications] Action: ${actionId}, scheduleId: ${scheduleId}`);

    if (actionId === 'TAKE' && scheduleId && userId) {
      try {
        await offlineSyncService.safePost('/adherence/log', {
          scheduleId,
          userId,
          status: 'TAKEN',
          timestamp: new Date().toISOString(),
        });
        console.log('[Notifications] Dose logged as TAKEN from notification');
      } catch (e) {
        console.error('[Notifications] Failed to log TAKEN:', e.message);
      }
    } else if (actionId === 'SNOOZE' && scheduleId) {
      try {
        // Cancel the current notification to prevent duplicate snoozes
        if (notificationId) {
          await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
        }

        // Reschedule for +15 minutes
        const snoozeId = await Notifications.scheduleNotificationAsync({
          content: {
            title: '💊 Snoozed Reminder',
            body: `Time to take your ${data.medicineName || 'medication'}`,
            sound: 'default',
            categoryIdentifier: MEDICATION_CATEGORY,
            data: { ...data, notificationId: undefined }, // New notification will get its own ID
          },
          trigger: {
            seconds: 900, // 15 minutes
          },
        });
        console.log(`[Notifications] Snoozed for 15min, new id: ${snoozeId}`);
      } catch (e) {
        console.error('[Notifications] Snooze failed:', e.message);
      }
    }
    // Default tap (no specific action) — app opens normally, handled by navigation
  });
}

export async function registerForPushNotificationsAsync(userId) {
  if (!Device.isDevice) {
    console.log('[Notifications] Must use physical device for push notifications');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted');
    return null;
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: 'medscan-20d95', // Must match your Firebase project ID
    })).data;
    console.log('[Notifications] Push token:', token);

    // Register token with backend
    if (userId && token) {
      await api.post('/notifications/token', {
        userId,
        token: token,
      });
    }

    // Android notification channel
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('medication-reminders', {
        name: 'Medication Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3498db',
        sound: 'default',
      });
    }

    return token;
  } catch (error) {
    // If Firebase is not configured, fall back to local-only notifications
    console.log('[Notifications] Push registration skipped:', error.message);
    
    // Still set up Android channel for local notifications
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('medication-reminders', {
        name: 'Medication Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3498db',
        sound: 'default',
      });
    }
    return null;
  }
}

/**
 * Schedule a daily medication reminder with Take/Snooze action buttons.
 * Includes scheduleId and userId in data for action handling.
 */
export async function scheduleMedicationReminder(name, hours, minutes, scheduleId, userId) {
  try {
    // Check global notification preference
    const globalPref = await AsyncStorage.getItem('global_notifications');
    if (globalPref === 'false') {
      console.log(`[Notifications] Global notifications off, skipping ${name}`);
      return null;
    }

    // Check per-schedule notification preference
    if (scheduleId) {
      const schedulePref = await AsyncStorage.getItem(`schedule_notif_${scheduleId}`);
      if (schedulePref === 'false') {
        console.log(`[Notifications] Notifications off for schedule ${scheduleId}, skipping ${name}`);
        return null;
      }
    }

    const now = new Date();
    const trigger = new Date();
    trigger.setHours(hours, minutes, 0, 0);

    // If the time has already passed today, schedule for tomorrow
    if (trigger <= now) {
      trigger.setDate(trigger.getDate() + 1);
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '💊 Medication Reminder',
        body: `Time to take your ${name}`,
        sound: 'default',
        categoryIdentifier: MEDICATION_CATEGORY,
        data: {
          medicineName: name,
          scheduleId,
          userId,
        },
      },
      trigger: {
        type: 'daily',
        hour: hours,
        minute: minutes,
        repeats: true,
      },
    });

    console.log(`[Notifications] Scheduled reminder for ${name} at ${hours}:${minutes}, id: ${id}`);
    return id;
  } catch (error) {
    console.log('[Notifications] Failed to schedule:', error.message);
    return null;
  }
}

export async function cancelAllReminders() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
