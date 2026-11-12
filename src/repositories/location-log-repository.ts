import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/database/database';
import { MemoryRepositoryError } from '@/repositories/memory-repository';
import { generateId } from '@/utils/ids';
import { isIsoTimestamp } from '@/utils/validation';

/**
 * Where the phone was at a moment, recorded by the optional background log.
 * An observation, never a memory: it says nothing about what the user was doing.
 */
export interface LocationObservation {
  id: string;
  capturedAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  /** Reverse-geocoded place; null until resolved (or if the geocoder had no answer). */
  placeName: string | null;
  source: 'background';
}

export type NewObservation = Omit<LocationObservation, 'id' | 'source' | 'placeName'>;

interface ObservationRow {
  id: string;
  captured_at: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  place_name: string | null;
  source: string;
}

function toObservation(row: ObservationRow): LocationObservation {
  return {
    id: row.id,
    capturedAt: row.captured_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_meters,
    placeName: row.place_name,
    source: 'background',
  };
}

function isValid(observation: NewObservation): boolean {
  return (
    isIsoTimestamp(observation.capturedAt) &&
    Number.isFinite(observation.latitude) &&
    Number.isFinite(observation.longitude) &&
    Math.abs(observation.latitude) <= 90 &&
    Math.abs(observation.longitude) <= 180
  );
}

export class LocationLogRepository {
  constructor(private readonly openDb: () => Promise<SQLiteDatabase> = getDatabase) {}

  private async run<T>(action: string, task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
    try {
      return await task(await this.openDb());
    } catch (error) {
      throw new MemoryRepositoryError(`Could not ${action}.`, { cause: error });
    }
  }

  /**
   * Stores observations, skipping invalid ones and any closer than `minGapMs` to the
   * previous stored one (Android may deliver batches or duplicates). Returns the stored rows, oldest first.
   */
  add(observations: NewObservation[], minGapMs: number): Promise<LocationObservation[]> {
    return this.run('record location', async (db) => {
      const latest = await db.getFirstAsync<{ captured_at: string }>(
        'SELECT captured_at FROM location_observations ORDER BY captured_at DESC LIMIT 1',
      );
      let lastTime = latest ? Date.parse(latest.captured_at) : -Infinity;
      const stored: LocationObservation[] = [];

      const sorted = observations
        .filter(isValid)
        .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

      await db.withExclusiveTransactionAsync(async (txn) => {
        for (const observation of sorted) {
          const time = Date.parse(observation.capturedAt);
          if (time - lastTime < minGapMs) continue;

          const id = generateId();
          await txn.runAsync(
            `INSERT INTO location_observations (id, captured_at, latitude, longitude, accuracy_meters, source)
             VALUES (?, ?, ?, ?, ?, 'background')`,
            [
              id,
              observation.capturedAt,
              observation.latitude,
              observation.longitude,
              observation.accuracyMeters,
            ],
          );
          lastTime = time;
          stored.push({ ...observation, id, placeName: null, source: 'background' });
        }
      });

      return stored;
    });
  }

  /** Newest first. */
  list(limit = 500): Promise<LocationObservation[]> {
    return this.run('load location history', async (db) => {
      const rows = await db.getAllAsync<ObservationRow>(
        'SELECT * FROM location_observations ORDER BY captured_at DESC LIMIT ?',
        [limit],
      );
      return rows.map(toObservation);
    });
  }

  /** Readings still without a place name, oldest first. */
  listWithoutPlace(limit: number): Promise<LocationObservation[]> {
    return this.run('load location history', async (db) => {
      const rows = await db.getAllAsync<ObservationRow>(
        'SELECT * FROM location_observations WHERE place_name IS NULL ORDER BY captured_at ASC LIMIT ?',
        [limit],
      );
      return rows.map(toObservation);
    });
  }

  /** The most recent reading before `capturedAt` that already has a place name. */
  latestWithPlaceBefore(capturedAt: string): Promise<LocationObservation | null> {
    return this.run('load location history', async (db) => {
      const row = await db.getFirstAsync<ObservationRow>(
        `SELECT * FROM location_observations
         WHERE place_name IS NOT NULL AND captured_at < ?
         ORDER BY captured_at DESC LIMIT 1`,
        [capturedAt],
      );
      return row ? toObservation(row) : null;
    });
  }

  setPlaceName(id: string, placeName: string): Promise<void> {
    return this.run('save place name', async (db) => {
      await db.runAsync('UPDATE location_observations SET place_name = ? WHERE id = ?', [placeName, id]);
    });
  }

  /** Every reading, oldest first (used for backups). */
  listAll(): Promise<LocationObservation[]> {
    return this.run('load location history', async (db) => {
      const rows = await db.getAllAsync<ObservationRow>(
        'SELECT * FROM location_observations ORDER BY captured_at ASC',
      );
      return rows.map(toObservation);
    });
  }

  /** Readings between two ISO times (inclusive start, exclusive end), oldest first. */
  listBetween(startIso: string, endIso: string): Promise<LocationObservation[]> {
    return this.run('load location history', async (db) => {
      const rows = await db.getAllAsync<ObservationRow>(
        `SELECT * FROM location_observations
         WHERE captured_at >= ? AND captured_at < ?
         ORDER BY captured_at ASC`,
        [startIso, endIso],
      );
      return rows.map(toObservation);
    });
  }

  /** Inserts readings whose ids aren't stored yet (restore). Returns how many were added. */
  importMissing(observations: LocationObservation[]): Promise<number> {
    return this.run('restore location history', async (db) => {
      let added = 0;
      await db.withExclusiveTransactionAsync(async (txn) => {
        for (const o of observations) {
          if (!isValid(o) || typeof o.id !== 'string') continue;
          const result = await txn.runAsync(
            `INSERT OR IGNORE INTO location_observations
               (id, captured_at, latitude, longitude, accuracy_meters, place_name, source)
             VALUES (?, ?, ?, ?, ?, ?, 'background')`,
            [o.id, o.capturedAt, o.latitude, o.longitude, o.accuracyMeters ?? null, o.placeName ?? null],
          );
          added += result.changes;
        }
      });
      return added;
    });
  }

  count(): Promise<number> {
    return this.run('count location history', async (db) => {
      const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM location_observations');
      return row?.n ?? 0;
    });
  }

  /** Retention: removes observations captured before `cutoffIso`. */
  deleteOlderThan(cutoffIso: string): Promise<void> {
    return this.run('prune location history', async (db) => {
      await db.runAsync('DELETE FROM location_observations WHERE captured_at < ?', [cutoffIso]);
    });
  }

  deleteAll(): Promise<void> {
    return this.run('delete location history', async (db) => {
      await db.runAsync('DELETE FROM location_observations');
    });
  }
}

export const locationLogRepository = new LocationLogRepository();
