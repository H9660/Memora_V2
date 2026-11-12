import { migrate } from '@/database/migrations';
import { LocationLogRepository } from '@/repositories/location-log-repository';
import { NodeSQLiteDatabase } from '@/test-utils/node-sqlite-database';

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));
jest.mock('expo-task-manager', () => ({ isTaskDefined: () => true, defineTask: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('@/services/location', () => ({ reverseGeocode: jest.fn() }));

const mockDb = { current: null as NodeSQLiteDatabase | null };
jest.mock('@/database/database', () => ({
  getDatabase: async () => mockDb.current!.asExpo(),
}));

// Imported after the mocks so the service uses the in-memory database.
/* eslint-disable import/first */
import {
  fillMissingPlaceNames,
  formatInterval,
  isValidInterval,
  resolvePlaceNames,
} from '@/services/background-location';
import { reverseGeocode } from '@/services/location';
/* eslint-enable import/first */

const geocode = reverseGeocode as jest.MockedFunction<typeof reverseGeocode>;
const MIN = 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 10, 12) + minutes * MIN).toISOString();

let log: LocationLogRepository;

beforeEach(async () => {
  geocode.mockReset();
  mockDb.current = new NodeSQLiteDatabase();
  await migrate(mockDb.current.asExpo());
  log = new LocationLogRepository(async () => mockDb.current!.asExpo());
});

describe('place names for the location log', () => {
  it('geocodes readings, reusing the name for nearby ones', async () => {
    geocode.mockResolvedValueOnce('Cubbon Park, Bengaluru').mockResolvedValueOnce('MG Road, Bengaluru');
    const stored = await log.add(
      [
        { capturedAt: at(0), latitude: 12.9763, longitude: 77.5929, accuracyMeters: 10 },
        { capturedAt: at(1), latitude: 12.9764, longitude: 77.5929, accuracyMeters: 10 }, // ~11 m away
        { capturedAt: at(2), latitude: 12.9757, longitude: 77.6062, accuracyMeters: 10 }, // ~1.4 km away
      ],
      0,
    );

    expect(await resolvePlaceNames(stored)).toBe(3);
    expect(geocode).toHaveBeenCalledTimes(2);
    expect((await log.list()).map((observation) => observation.placeName)).toEqual([
      'MG Road, Bengaluru',
      'Cubbon Park, Bengaluru',
      'Cubbon Park, Bengaluru',
    ]);
  });

  it('leaves unresolved readings empty and fills them in later', async () => {
    geocode.mockResolvedValueOnce(null);
    const stored = await log.add(
      [{ capturedAt: at(0), latitude: 12.9763, longitude: 77.5929, accuracyMeters: 10 }],
      0,
    );
    expect(await resolvePlaceNames(stored)).toBe(0);
    expect((await log.list())[0].placeName).toBeNull();

    geocode.mockResolvedValueOnce('Cubbon Park, Bengaluru');
    expect(await fillMissingPlaceNames()).toBe(1);
    expect((await log.list())[0].placeName).toBe('Cubbon Park, Bengaluru');
  });
});

describe('intervals', () => {
  it('accepts whole minutes from 1 to 720', () => {
    expect([1, 3, 720].every(isValidInterval)).toBe(true);
    expect([0, 0.5, 721, Number.NaN].some(isValidInterval)).toBe(false);
  });

  it('formats intervals', () => {
    expect(formatInterval(3)).toBe('3 min');
    expect(formatInterval(60)).toBe('1 h');
    expect(formatInterval(90)).toBe('1 h 30 min');
  });
});
