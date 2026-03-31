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

const MEDICATION_CATEGORY = 'MEDICATION_REMINDER';

/**
 * Register the MEDICATION_REMINDER category with Take + Snooze buttons.
 */
export async function setupNotificationActions() {
  try {
    await Notifications.setNotificationCategoryAsync(MEDICATION_CATEGORY, [
      {
        identifier: 'TAKE',
        buttonTitle: 'Take',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'SNOOZE',
        buttonTitle: 'Snooze (15m)',
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
        if (notificationId) {
          await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
        }
        const snoozeId = await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Snoozed Reminder',
            body: `Time to take your ${data.medicineName || 'medication'}`,
            sound: 'default',
            categoryIdentifier: MEDICATION_CATEGORY,
            ...(Platform.OS === 'android' ? { channelId: 'medication-reminders' } : {}),
            data: { ...data, notificationId: undefined },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 900,
          },
        });
        console.log(`[Notifications] Snoozed for 15min, new id: ${snoozeId}`);
      } catch (e) {
        console.error('[Notifications] Snooze failed:', e.message);
      }
    }
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

  // Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('medication-reminders', {
      name: 'Medication Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0891B2',
      sound: 'default',
    });
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: '567e7bb9-3f2a-4b8a-b9a1-777eac1ae7ff',
    })).data;
    console.log('[Notifications] Push token:', token);

    if (userId && token) {
      await api.post('/notifications/token', { userId, token });
    }
    return token;
  } catch (error) {
    console.log('[Notifications] Push registration skipped:', error.message);
    return null;
  }
}

/**
 * Schedule a daily medication reminder with Take/Snooze action buttons.
 * Uses dateComponents format required by Expo SDK 54.
 */
export async function scheduleMedicationReminder(name, hours, minutes, scheduleId, userId) {
  try {
    const globalPref = await AsyncStorage.getItem('global_notifications');
    if (globalPref === 'false') {
      console.log(`[Notifications] Global notifications off, skipping ${name}`);
      return null;
    }

    if (scheduleId) {
      const schedulePref = await AsyncStorage.getItem(`schedule_notif_${scheduleId}`);
      if (schedulePref === 'false') {
        console.log(`[Notifications] Notifications off for schedule ${scheduleId}`);
        return null;
      }
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Medication Reminder',
        body: `Time to take your ${name}`,
        sound: 'default',
        categoryIdentifier: MEDICATION_CATEGORY,
        ...(Platform.OS === 'android' ? { channelId: 'medication-reminders' } : {}),
        data: {
          medicineName: name,
          scheduleId,
          userId,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeating: true,
        dateComponents: {
          hour: hours,
          minute: minutes,
        },
      },
    });

    console.log(`[Notifications] Scheduled reminder for ${name} at ${hours}:${String(minutes).padStart(2, '0')}, id: ${id}`);
    return id;
  } catch (error) {
    console.log('[Notifications] Failed to schedule:', error.message);
    return null;
  }
}

/**
 * Re-schedule all notifications for a user's schedules.
 * Call on app startup / login to ensure reminders are active.
 */
export async function rescheduleAllReminders(userId, schedules) {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();

    let count = 0;
    for (const schedule of schedules) {
      if (!schedule.scheduleTimes || schedule.frequencyType === 'AS_NEEDED') continue;

      for (const st of schedule.scheduleTimes) {
        const timeStr = st.scheduledTime || '';
        const parts = timeStr.split(':');
        if (parts.length < 2) continue;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m)) continue;

        const medName = schedule.medicine?.name || 'Medication';
        const result = await scheduleMedicationReminder(medName, h, m, schedule.id, userId);
        if (result) count++;
      }
    }
    console.log(`[Notifications] Re-scheduled ${count} reminders for ${schedules.length} medicines`);
  } catch (e) {
    console.log('[Notifications] Bulk reschedule failed:', e.message);
  }
}

export async function cancelAllReminders() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
