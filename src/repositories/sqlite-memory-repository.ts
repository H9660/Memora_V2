import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/database/database';
import { MemoryRepository, MemoryRepositoryError } from '@/repositories/memory-repository';
import { isEvidenceType, MemoryEdit, MemoryEvent, MemoryEvidence } from '@/types/memory';
import { UNTITLED_MEMORY } from '@/utils/memory-factory';
import { isIsoTimestamp, validateEdit, validateMemory } from '@/utils/validation';

interface MemoryRow {
  id: string;
  title: string | null;
  note: string | null;
  event_time: string | null;
  captured_at: string;
  updated_at: string | null;
  place_name: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface EvidenceRow {
  id: string;
  memory_id: string;
  type: string;
  captured_at: string;
  data_json: string | null;
}

const MEMORY_COLUMNS =
  'id, title, note, event_time, captured_at, updated_at, place_name, latitude, longitude';

/** Evidence types whose JSON payload holds user-meaningful text worth searching. */
const SEARCHABLE_EVIDENCE = "('USER_NOTE', 'LOCATION')";

function parseEvidenceData(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through: corrupted payloads are shown as empty rather than crashing the app.
  }
  return {};
}

/** Returns null for rows that can't be represented (unknown type), so one bad row doesn't break a list. */
function toEvidence(row: EvidenceRow): MemoryEvidence | null {
  if (!isEvidenceType(row.type)) {
    console.warn(`Skipping evidence with unknown type "${row.type}".`);
    return null;
  }

  return {
    id: row.id,
    memoryId: row.memory_id,
    type: row.type,
    capturedAt: row.captured_at,
    data: parseEvidenceData(row.data_json),
  };
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toMemory(row: MemoryRow, evidence: MemoryEvidence[]): MemoryEvent {
  const latitude = finiteOrNull(row.latitude);
  const longitude = finiteOrNull(row.longitude);
  const hasCoordinates = latitude !== null && longitude !== null;

  return {
    id: row.id,
    title: row.title?.trim() ? row.title : UNTITLED_MEMORY,
    note: row.note ?? '',
    eventTime: isIsoTimestamp(row.event_time) ? row.event_time : null,
    capturedAt: row.captured_at,
    updatedAt: isIsoTimestamp(row.updated_at) ? row.updated_at : null,
    placeName: row.place_name,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    evidence,
  };
}

/** Escapes LIKE wildcards so user input is matched literally (used with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export class SQLiteMemoryRepository implements MemoryRepository {
  constructor(private readonly openDb: () => Promise<SQLiteDatabase> = getDatabase) {}

  private async run<T>(action: string, task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
    try {
      const db = await this.openDb();
      return await task(db);
    } catch (error) {
      if (error instanceof MemoryRepositoryError) throw error;
      throw new MemoryRepositoryError(`Could not ${action}.`, { cause: error });
    }
  }

  private async loadEvidence(db: SQLiteDatabase, memoryIds: string[]): Promise<MemoryEvidence[]> {
    if (memoryIds.length === 0) return [];

    const placeholders = memoryIds.map(() => '?').join(', ');
    const rows = await db.getAllAsync<EvidenceRow>(
      `SELECT id, memory_id, type, captured_at, data_json FROM memory_evidence
       WHERE memory_id IN (${placeholders})
       ORDER BY captured_at ASC, rowid ASC`,
      memoryIds,
    );

    return rows.map(toEvidence).filter((evidence) => evidence !== null);
  }

  private async withEvidence(db: SQLiteDatabase, rows: MemoryRow[]): Promise<MemoryEvent[]> {
    if (rows.length === 0) return [];

    const byMemory = new Map<string, MemoryEvidence[]>();
    // SQLite caps bound parameters; batch large timelines.
    const BATCH = 500;
    for (let start = 0; start < rows.length; start += BATCH) {
      const ids = rows.slice(start, start + BATCH).map((row) => row.id);
      for (const evidence of await this.loadEvidence(db, ids)) {
        const list = byMemory.get(evidence.memoryId) ?? [];
        list.push(evidence);
        byMemory.set(evidence.memoryId, list);
      }
    }

    return rows.map((row) => toMemory(row, byMemory.get(row.id) ?? []));
  }

  create(memory: MemoryEvent): Promise<void> {
    const errors = validateMemory(memory);
    if (errors.length > 0) {
      return Promise.reject(new MemoryRepositoryError(errors.join(' ')));
    }

    return this.run('save the memory', (db) =>
      // Exclusive so the memory and its evidence are written together or not at all.
      db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          `INSERT INTO memories (${MEMORY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            memory.id,
            memory.title,
            memory.note,
            memory.eventTime,
            memory.capturedAt,
            memory.updatedAt,
            memory.placeName,
            memory.latitude,
            memory.longitude,
          ],
        );

        for (const evidence of memory.evidence) {
          await txn.runAsync(
            `INSERT INTO memory_evidence (id, memory_id, type, captured_at, data_json)
             VALUES (?, ?, ?, ?, ?)`,
            [evidence.id, memory.id, evidence.type, evidence.capturedAt, JSON.stringify(evidence.data)],
          );
        }
      }),
    );
  }

  async update(id: string, edit: MemoryEdit, updatedAt: string): Promise<MemoryEvent | null> {
    if (!isIsoTimestamp(updatedAt)) {
      throw new MemoryRepositoryError('Invalid edit time.');
    }

    return this.run('update the memory', async (db) => {
      const existing = await this.getByIdWith(db, id);
      if (!existing) return null;

      const hasPhoto = existing.evidence.some((evidence) => evidence.type === 'PHOTO');
      const error = validateEdit(edit, hasPhoto);
      if (error) throw new MemoryRepositoryError(error);

      // Only the memory row changes; USER_NOTE evidence keeps the note as originally captured.
      await db.runAsync('UPDATE memories SET title = ?, note = ?, updated_at = ? WHERE id = ?', [
        edit.title.trim(),
        edit.note,
        updatedAt,
        id,
      ]);

      return this.getByIdWith(db, id);
    });
  }

  private async getByIdWith(db: SQLiteDatabase, id: string): Promise<MemoryEvent | null> {
    const row = await db.getFirstAsync<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ?`,
      [id],
    );
    if (!row) return null;

    const [memory] = await this.withEvidence(db, [row]);
    return memory;
  }

  getById(id: string): Promise<MemoryEvent | null> {
    return this.run('load the memory', (db) => this.getByIdWith(db, id));
  }

  getAll(): Promise<MemoryEvent[]> {
    return this.run('load memories', async (db) => {
      const rows = await db.getAllAsync<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories ORDER BY captured_at DESC, id DESC`,
      );
      return this.withEvidence(db, rows);
    });
  }

  getBetween(startIso: string, endIso: string): Promise<MemoryEvent[]> {
    return this.run('load memories', async (db) => {
      const rows = await db.getAllAsync<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE captured_at >= ? AND captured_at < ?
         ORDER BY captured_at ASC, id ASC`,
        [startIso, endIso],
      );
      return this.withEvidence(db, rows);
    });
  }

  getEvidence(memoryId: string): Promise<MemoryEvidence[]> {
    return this.run('load evidence', (db) => this.loadEvidence(db, [memoryId]));
  }

  search(query: string): Promise<MemoryEvent[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return Promise.resolve([]);

    return this.run('search memories', async (db) => {
      const pattern = `%${escapeLike(trimmed)}%`;
      // LIKE is case-insensitive for ASCII in SQLite.
      const rows = await db.getAllAsync<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories m
         WHERE m.title LIKE ?1 ESCAPE '\\'
            OR m.note LIKE ?1 ESCAPE '\\'
            OR m.place_name LIKE ?1 ESCAPE '\\'
            OR EXISTS (
              SELECT 1 FROM memory_evidence e
              WHERE e.memory_id = m.id
                AND e.type IN ${SEARCHABLE_EVIDENCE}
                AND e.data_json LIKE ?1 ESCAPE '\\'
            )
         ORDER BY m.captured_at DESC, m.id DESC`,
        [pattern],
      );
      return this.withEvidence(db, rows);
    });
  }

  count(): Promise<number> {
    return this.run('count memories', async (db) => {
      const row = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM memories');
      return row?.total ?? 0;
    });
  }

  delete(id: string): Promise<void> {
    return this.run('delete the memory', (db) =>
      db.withExclusiveTransactionAsync(async (txn) => {
        // Cascade also covers this; deleting explicitly keeps cleanup independent of the pragma.
        await txn.runAsync('DELETE FROM memory_evidence WHERE memory_id = ?', [id]);
        await txn.runAsync('DELETE FROM memories WHERE id = ?', [id]);
      }),
    );
  }

  deleteAll(): Promise<void> {
    return this.run('delete all memories', (db) =>
      db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync('DELETE FROM memory_evidence');
        await txn.runAsync('DELETE FROM memories');
      }),
    );
  }
}

export const memoryRepository: MemoryRepository = new SQLiteMemoryRepository();
