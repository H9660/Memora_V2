import * as Location from 'expo-location';

/** A single foreground observation of where the device was. */
export type LocationData = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  placeName: string | null;
  /** ISO 8601 time of the GPS fix. */
  capturedAt: string;
};

export type LocationResult =
  | { status: 'success'; location: LocationData }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable'; reason: string };

export type LocationPermission = 'granted' | 'undetermined' | 'denied' | 'blocked';

const LOCATION_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a location fix')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function toPermission(response: Location.LocationPermissionResponse): LocationPermission {
  if (response.status === 'granted') return 'granted';
  if (response.status === 'undetermined') return 'undetermined';
  return response.canAskAgain ? 'denied' : 'blocked';
}

/** Reads the current permission without prompting the user. */
export async function getLocationPermission(): Promise<LocationPermission> {
  try {
    return toPermission(await Location.getForegroundPermissionsAsync());
  } catch {
    return 'undetermined';
  }
}

/**
 * Human-readable place for coordinates, e.g. "MG Road, Bengaluru". Uses the
 * platform geocoder (on Android this may contact Google's service). Returns
 * null when unavailable; never throws.
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!address) return null;

    const primary = address.name || address.street || address.district;
    const area = address.district || address.city || address.subregion;
    const parts = [primary, area].filter((part): part is string => !!part);
    const unique = parts.filter((part, index) => parts.indexOf(part) === index);
    return unique.length > 0 ? unique.join(', ') : null;
  } catch {
    // Geocoding needs a network/geocoder; callers fall back to no place name.
    return null;
  }
}

/**
 * Foreground-only, one-shot location. Prompts for permission if needed, so call
 * it only in response to a user action or after permission was already granted.
 * Never throws; failure is reported in the result.
 */
export async function getCurrentLocation(): Promise<LocationResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== 'granted') {
      return { status: 'denied', canAskAgain: permission.canAskAgain };
    }

    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      LOCATION_TIMEOUT_MS,
    );

    const { latitude, longitude, accuracy } = position.coords;
    const placeName = await reverseGeocode(latitude, longitude);

    return {
      status: 'success',
      location: {
        latitude,
        longitude,
        accuracyMeters: accuracy ?? null,
        placeName,
        capturedAt: new Date(position.timestamp).toISOString(),
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    console.warn('Location unavailable:', reason);
    return { status: 'unavailable', reason };
  }
}
