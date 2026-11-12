import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/database/database';

/** Small JSON key-value store for user preferences, kept in the same local database. */
export class SettingsRepository {
  constructor(private readonly openDb: () => Promise<SQLiteDatabase> = getDatabase) {}

  /** Returns the stored value, or `fallback` if missing or unreadable. */
  async get<T extends object>(key: string, fallback: T): Promise<T> {
    const db = await this.openDb();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return fallback;
    try {
      return { ...fallback, ...(JSON.parse(row.value) as T) };
    } catch {
      return fallback;
    }
  }

  async set<T extends object>(key: string, value: T): Promise<void> {
    const db = await this.openDb();
    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }
}

export const settingsRepository = new SettingsRepository();
