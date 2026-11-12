/**
 * Optional background location log. Off by default; the user turns it on,
 * picks an interval, and can turn it off or delete the history at any time.
 * Observations are stored separately from memories and kept for RETENTION_DAYS.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { LocationObservation, locationLogRepository } from '@/repositories/location-log-repository';
import { settingsRepository } from '@/repositories/settings-repository';
import { reverseGeocode } from '@/services/location';
import { distanceMeters } from '@/utils/geo';

export const LOCATION_LOG_TASK = 'memora-location-log';
export const RETENTION_DAYS = 30;
export const INTERVAL_OPTIONS_MINUTES = [1, 3, 5, 10, 15, 30, 60] as const;
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 720;
/** Below this, warn about battery use. */
export const LOW_INTERVAL_WARNING_MINUTES = 5;
/** Readings this close to an already-named one reuse its place name instead of geocoding again. */
const SAME_PLACE_RADIUS_M = 100;

export function isValidInterval(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= MIN_INTERVAL_MINUTES && minutes <= MAX_INTERVAL_MINUTES;
}

export interface LocationLogSettings {
  intervalMinutes: number;
}

const SETTINGS_KEY = 'locationLog';
const DEFAULT_SETTINGS: LocationLogSettings = { intervalMinutes: 15 };
const DAY_MS = 24 * 60 * 60 * 1000;

export type StartResult =
  | { status: 'started' }
  | { status: 'denied'; canAskAgain: boolean }
  /** Foreground allowed, but "Allow all the time" was not granted. */
  | { status: 'background-denied' }
  | { status: 'invalid-interval' }
  | { status: 'error'; reason: string };

/**
 * Gives each reading a place name. Nearby readings reuse the previous name, so a
 * phone sitting still doesn't trigger a geocoder call every interval.
 * Returns how many were named; unresolved ones stay null and are retried later.
 */
export async function resolvePlaceNames(observations: LocationObservation[]): Promise<number> {
  if (observations.length === 0) return 0;
  const sorted = [...observations].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  let previous = await locationLogRepository.latestWithPlaceBefore(sorted[0].capturedAt);
  let named = 0;

  for (const observation of sorted) {
    const placeName =
      previous?.placeName && distanceMeters(previous, observation) <= SAME_PLACE_RADIUS_M
        ? previous.placeName
        : await reverseGeocode(observation.latitude, observation.longitude);

    if (placeName) {
      await locationLogRepository.setPlaceName(observation.id, placeName);
      previous = { ...observation, placeName };
      named++;
    }
  }
  return named;
}

/** Names readings that couldn't be geocoded when recorded (e.g. no network). */
export async function fillMissingPlaceNames(limit = 30): Promise<number> {
  return resolvePlaceNames(await locationLogRepository.listWithoutPlace(limit));
}

async function intervalMs(): Promise<number> {
  const { intervalMinutes } = await getLocationLogSettings();
  return intervalMinutes * 60 * 1000;
}

// Must run at module load (imported from the root layout) so the OS can wake
// the JS runtime for this task even when the app UI isn't open.
if (!TaskManager.isTaskDefined(LOCATION_LOG_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    LOCATION_LOG_TASK,
    async ({ data, error }) => {
      if (error) {
        console.warn('Location log task error:', error.message);
        return;
      }
      if (!data?.locations?.length) return;

      try {
        const minGap = (await intervalMs()) * 0.8;
        const stored = await locationLogRepository.add(
          data.locations.map((location) => ({
            capturedAt: new Date(location.timestamp).toISOString(),
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracyMeters: location.coords.accuracy ?? null,
          })),
          minGap,
        );
        await resolvePlaceNames(stored);
        await locationLogRepository.deleteOlderThan(
          new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString(),
        );
      } catch (taskError) {
        console.warn(
          'Could not store a location observation:',
          taskError instanceof Error ? taskError.message : taskError,
        );
      }
    },
  );
}

export function getLocationLogSettings(): Promise<LocationLogSettings> {
  return settingsRepository.get(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export async function isLocationLogActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_LOG_TASK);
  } catch {
    return false;
  }
}

/** Asks for permissions (only now, because the user turned the log on) and starts recording. */
export async function startLocationLog(intervalMinutes: number): Promise<StartResult> {
  if (!isValidInterval(intervalMinutes)) return { status: 'invalid-interval' };
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      return { status: 'denied', canAskAgain: foreground.canAskAgain };
    }

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      return { status: 'background-denied' };
    }

    await settingsRepository.set<LocationLogSettings>(SETTINGS_KEY, { intervalMinutes });

    if (await isLocationLogActive()) {
      await Location.stopLocationUpdatesAsync(LOCATION_LOG_TASK);
    }

    const ms = intervalMinutes * 60 * 1000;
    await Location.startLocationUpdatesAsync(LOCATION_LOG_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: ms,
      distanceInterval: 0,
      deferredUpdatesInterval: ms,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Memora location log is on',
        notificationBody: `Noting where your phone is about every ${formatInterval(intervalMinutes)}. Turn it off in Memora.`,
        notificationColor: '#1B1D22',
      },
    });

    return { status: 'started' };
  } catch (error) {
    return { status: 'error', reason: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function stopLocationLog(): Promise<void> {
  if (await isLocationLogActive()) {
    await Location.stopLocationUpdatesAsync(LOCATION_LOG_TASK);
  }
}

export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${Math.floor(hours)} h ${minutes % 60} min`;
}

/** Saves the interval without starting anything (used while the log is off). */
export async function saveInterval(intervalMinutes: number): Promise<void> {
  if (!isValidInterval(intervalMinutes)) return;
  await settingsRepository.set<LocationLogSettings>(SETTINGS_KEY, { intervalMinutes });
}

export const isBackgroundLocationSupported = Platform.OS === 'android' || Platform.OS === 'ios';
