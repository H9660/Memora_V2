import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/database/database';

/** The user's own words about a day. Never generated or changed by the app. */
export interface DayNote {
  day: string;
  note: string;
  updatedAt: string;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DAY_NOTE_LENGTH = 2000;

export class DayNoteRepository {
  constructor(private readonly openDb: () => Promise<SQLiteDatabase> = getDatabase) {}

  async get(day: string): Promise<DayNote | null> {
    const db = await this.openDb();
    const row = await db.getFirstAsync<{ day: string; note: string; updated_at: string }>(
      'SELECT day, note, updated_at FROM day_notes WHERE day = ?',
      [day],
    );
    return row ? { day: row.day, note: row.note, updatedAt: row.updated_at } : null;
  }

  /** Saves the note; an empty note removes it. */
  async set(day: string, note: string, updatedAt = new Date().toISOString()): Promise<void> {
    if (!DAY_KEY.test(day)) throw new Error('Invalid day.');
    const db = await this.openDb();
    if (note.trim().length === 0) {
      await db.runAsync('DELETE FROM day_notes WHERE day = ?', [day]);
      return;
    }
    await db.runAsync(
      `INSERT INTO day_notes (day, note, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
      [day, note.slice(0, MAX_DAY_NOTE_LENGTH), updatedAt],
    );
  }

  async listAll(): Promise<DayNote[]> {
    const db = await this.openDb();
    const rows = await db.getAllAsync<{ day: string; note: string; updated_at: string }>(
      'SELECT day, note, updated_at FROM day_notes ORDER BY day ASC',
    );
    return rows.map((row) => ({ day: row.day, note: row.note, updatedAt: row.updated_at }));
  }

  /** Restore: adds notes for days that have none on this device. Returns how many were added. */
  async importMissing(notes: DayNote[]): Promise<number> {
    const db = await this.openDb();
    let added = 0;
    for (const note of notes) {
      if (!DAY_KEY.test(note.day) || typeof note.note !== 'string' || !note.note.trim()) continue;
      const result = await db.runAsync(
        'INSERT OR IGNORE INTO day_notes (day, note, updated_at) VALUES (?, ?, ?)',
        [note.day, note.note.slice(0, MAX_DAY_NOTE_LENGTH), note.updatedAt ?? new Date().toISOString()],
      );
      added += result.changes;
    }
    return added;
  }

  async deleteAll(): Promise<void> {
    const db = await this.openDb();
    await db.runAsync('DELETE FROM day_notes');
  }
}

export const dayNoteRepository = new DayNoteRepository();
