/**
 * Optional daily reminders that prompt the user to capture a memory.
 * Local notifications only; nothing is sent to a server.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { settingsRepository } from '@/repositories/settings-repository';
import { MAX_REMINDERS, normalizeTimes, ReminderTime } from '@/utils/reminder-times';

export type { ReminderTime } from '@/utils/reminder-times';

export interface ReminderSettings {
  enabled: boolean;
  times: ReminderTime[];
}

const SETTINGS_KEY = 'reminders';
const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: false,
  times: [
    { hour: 12, minute: 30 },
    { hour: 18, minute: 0 },
  ],
};
const CHANNEL_ID = 'memora-reminders';
const REMINDER_KIND = 'memora-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function getReminderSettings(): Promise<ReminderSettings> {
  return settingsRepository.get(SETTINGS_KEY, DEFAULT_SETTINGS);
}

async function cancelReminderNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.content.data?.kind === REMINDER_KIND)
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

export type EnableResult = { status: 'enabled' } | { status: 'denied'; canAskAgain: boolean };

/** Asks for notification permission (only now, because the user turned reminders on) and schedules them. */
export async function enableReminders(requested: ReminderTime[]): Promise<EnableResult> {
  const times = normalizeTimes(requested).slice(0, MAX_REMINDERS);
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Memory reminders',
      description: 'Daily prompts to capture a memory',
      // Re-exported via `export *`, which eslint-plugin-import can't follow.
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await cancelReminderNotifications();
  for (const time of times) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Anything worth remembering?',
        body: 'Tap to capture what’s happening right now.',
        data: { kind: REMINDER_KIND },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: time.hour,
        minute: time.minute,
        channelId: CHANNEL_ID,
      },
    });
  }

  await settingsRepository.set<ReminderSettings>(SETTINGS_KEY, { enabled: true, times });
  return { status: 'enabled' };
}

export async function disableReminders(): Promise<void> {
  await cancelReminderNotifications();
  const current = await getReminderSettings();
  await settingsRepository.set<ReminderSettings>(SETTINGS_KEY, { ...current, enabled: false });
}

/** True if the user tapped one of Memora's reminders (which open Capture). */
export function isReminderResponse(response: Notifications.NotificationResponse | null): boolean {
  return response?.notification.request.content.data?.kind === REMINDER_KIND;
}

// ---- End-of-day review: one evening prompt to look through the day's photos before backing up.

export interface DayReviewReminderSettings {
  enabled: boolean;
  time: ReminderTime;
}

const DAY_REVIEW_KEY = 'dayReviewReminder';
const DAY_REVIEW_KIND = 'memora-day-review';
const DAY_REVIEW_DEFAULT: DayReviewReminderSettings = { enabled: false, time: { hour: 21, minute: 30 } };

export function getDayReviewReminder(): Promise<DayReviewReminderSettings> {
  return settingsRepository.get(DAY_REVIEW_KEY, DAY_REVIEW_DEFAULT);
}

async function cancelDayReviewNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.content.data?.kind === DAY_REVIEW_KIND)
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

export async function enableDayReviewReminder(time: ReminderTime): Promise<EnableResult> {
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Memory reminders',
      description: 'Daily prompts to capture a memory',
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await cancelDayReviewNotifications();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Review your day',
      body: 'Look through today’s photos and delete anything you don’t want kept or backed up.',
      data: { kind: DAY_REVIEW_KIND },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: time.hour,
      minute: time.minute,
      channelId: CHANNEL_ID,
    },
  });
  await settingsRepository.set<DayReviewReminderSettings>(DAY_REVIEW_KEY, { enabled: true, time });
  return { status: 'enabled' };
}

export async function disableDayReviewReminder(time?: ReminderTime): Promise<void> {
  await cancelDayReviewNotifications();
  const current = await getDayReviewReminder();
  await settingsRepository.set<DayReviewReminderSettings>(DAY_REVIEW_KEY, { enabled: false, time: time ?? current.time });
}

/** True if the user tapped the end-of-day review notification (which opens today's photos). */
export function isDayReviewResponse(response: Notifications.NotificationResponse | null): boolean {
  return response?.notification.request.content.data?.kind === DAY_REVIEW_KIND;
}

/** Saves chosen times without scheduling anything (used while reminders are off). */
export async function saveTimesWhileOff(times: ReminderTime[]): Promise<void> {
  await settingsRepository.set<ReminderSettings>(SETTINGS_KEY, {
    enabled: false,
    times: normalizeTimes(times).slice(0, MAX_REMINDERS),
  });
}
