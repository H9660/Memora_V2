/**
 * Optional auto camera: takes a photo every N seconds/minutes in a foreground
 * service (keeps going with the screen off). Off by default; the user starts it
 * while Memora is open and can stop it from the app or the notification.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';

import { AutoCameraNative, AutoCameraNativeStatus, CameraLens } from '../../modules/auto-camera';
import { autoCaptureRepository, parseCaptureFileName } from '@/repositories/auto-capture-repository';
import { settingsRepository } from '@/repositories/settings-repository';

export type { CameraLens } from '../../modules/auto-camera';

export const AUTO_CAPTURE_DIRECTORY = 'auto-captures';
export const MIN_INTERVAL_SECONDS = 10;
export const MAX_INTERVAL_SECONDS = 24 * 60 * 60;
export const INTERVAL_PRESETS_SECONDS = [30, 60, 120, 300, 600, 900, 1800, 3600] as const;
/** null = keep forever. */
export const RETENTION_OPTIONS_DAYS = [7, 30, 90, null] as const;

export interface AutoCameraSettings {
  intervalSeconds: number;
  lens: CameraLens;
  retentionDays: number | null;
}

const SETTINGS_KEY = 'autoCamera';
const DEFAULT_SETTINGS: AutoCameraSettings = { intervalSeconds: 300, lens: 'back', retentionDays: 30 };
const DAY_MS = 24 * 60 * 60 * 1000;

export const isAutoCameraAvailable = AutoCameraNative !== null;

export function isValidIntervalSeconds(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= MIN_INTERVAL_SECONDS && seconds <= MAX_INTERVAL_SECONDS;
}

export function formatIntervalSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds % 3600 === 0) return seconds === 3600 ? '1 hour' : `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}

export function getAutoCameraSettings(): Promise<AutoCameraSettings> {
  return settingsRepository.get(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export function saveAutoCameraSettings(settings: AutoCameraSettings): Promise<void> {
  return settingsRepository.set(SETTINGS_KEY, settings);
}

export function getNativeStatus(): AutoCameraNativeStatus | null {
  try {
    return AutoCameraNative?.getStatus() ?? null;
  } catch {
    return null;
  }
}

export type StartResult =
  | { status: 'started' }
  | { status: 'unavailable' }
  | { status: 'camera-denied'; canAskAgain: boolean }
  | { status: 'invalid-interval' }
  | { status: 'error'; message: string };

/** Asks for camera (and notification) permission now, because the user pressed Start. */
export async function startAutoCamera(settings: AutoCameraSettings): Promise<StartResult> {
  if (!AutoCameraNative) return { status: 'unavailable' };
  if (!isValidIntervalSeconds(settings.intervalSeconds)) return { status: 'invalid-interval' };

  const camera = await ImagePicker.requestCameraPermissionsAsync();
  if (!camera.granted) return { status: 'camera-denied', canAskAgain: camera.canAskAgain };

  // So the "auto camera is on" notification (with its Stop button) is visible. Capture works either way.
  const notifications = await Notifications.getPermissionsAsync();
  if (!notifications.granted && notifications.canAskAgain) {
    await Notifications.requestPermissionsAsync();
  }

  await saveAutoCameraSettings(settings);
  try {
    await AutoCameraNative.start(settings.intervalSeconds, settings.lens);
    return { status: 'started' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function stopAutoCamera(): Promise<void> {
  await AutoCameraNative?.stop();
}

function captureDirectory(): Directory {
  return new Directory(Paths.document, AUTO_CAPTURE_DIRECTORY);
}

/**
 * Brings the database in line with the photo files the service wrote, then
 * applies the retention period. Cheap enough to run whenever a screen opens.
 */
export async function syncAutoCaptures(): Promise<{ added: number; removed: number }> {
  const directory = captureDirectory();
  const files = directory.exists
    ? directory
        .list()
        .filter((entry): entry is File => entry instanceof File)
        .map((file) => parseCaptureFileName(file.name, file.uri))
        .filter((capture) => capture !== null)
    : [];
  const added = await autoCaptureRepository.syncWith(files);

  const { retentionDays } = await getAutoCameraSettings();
  let removed = 0;
  if (retentionDays !== null) {
    const expired = await autoCaptureRepository.listOlderThan(new Date(Date.now() - retentionDays * DAY_MS).toISOString());
    for (const capture of expired) {
      try {
        const file = new File(capture.uri);
        if (file.exists) file.delete();
      } catch {
        // Best-effort; the row is removed below and re-synced if the file survives.
      }
    }
    await autoCaptureRepository.delete(expired.map((capture) => capture.id));
    removed = expired.length;
  }
  return { added, removed };
}

/** Number of photos and bytes used on this device. */
export function autoCaptureStorage(): { count: number; bytes: number } {
  const directory = captureDirectory();
  if (!directory.exists) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const entry of directory.list()) {
    if (entry instanceof File && entry.name.endsWith('.jpg')) {
      count++;
      bytes += entry.size ?? 0;
    }
  }
  return { count, bytes };
}

export async function deleteAllAutoCaptures(): Promise<void> {
  const directory = captureDirectory();
  if (directory.exists) directory.delete();
  await autoCaptureRepository.deleteAll();
}

export function isIgnoringBatteryOptimizations(): boolean {
  try {
    return AutoCameraNative?.isIgnoringBatteryOptimizations() ?? false;
  } catch {
    return false;
  }
}

export function openBatteryOptimizationSettings(): void {
  AutoCameraNative?.openBatteryOptimizationSettings();
}
