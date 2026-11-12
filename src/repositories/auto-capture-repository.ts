import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/database/database';

/** A photo the auto camera took. An observation, not a memory. */
export interface AutoCapture {
  /** The file name, e.g. "1731400000000-back.jpg". */
  id: string;
  capturedAt: string;
  uri: string;
  lens: 'back' | 'front';
}

interface Row {
  id: string;
  captured_at: string;
  uri: string;
  lens: string;
}

const toCapture = (row: Row): AutoCapture => ({
  id: row.id,
  capturedAt: row.captured_at,
  uri: row.uri,
  lens: row.lens === 'front' ? 'front' : 'back',
});

export class AutoCaptureRepository {
  constructor(private readonly openDb: () => Promise<SQLiteDatabase> = getDatabase) {}

  /**
   * Makes the table match the files on disk: adds new files, drops rows whose
   * file is gone. Returns how many were added.
   */
  async syncWith(files: AutoCapture[]): Promise<number> {
    const db = await this.openDb();
    let added = 0;
    await db.withExclusiveTransactionAsync(async (txn) => {
      const existing = new Set((await txn.getAllAsync<{ id: string }>('SELECT id FROM auto_captures')).map((r) => r.id));
      const onDisk = new Set(files.map((f) => f.id));

      for (const file of files) {
        if (existing.has(file.id)) continue;
        await txn.runAsync('INSERT INTO auto_captures (id, captured_at, uri, lens) VALUES (?, ?, ?, ?)', [
          file.id,
          file.capturedAt,
          file.uri,
          file.lens,
        ]);
        added++;
      }
      for (const id of existing) {
        if (!onDisk.has(id)) await txn.runAsync('DELETE FROM auto_captures WHERE id = ?', [id]);
      }
    });
    return added;
  }

  async listBetween(startIso: string, endIso: string): Promise<AutoCapture[]> {
    const db = await this.openDb();
    const rows = await db.getAllAsync<Row>(
      'SELECT * FROM auto_captures WHERE captured_at >= ? AND captured_at < ? ORDER BY captured_at ASC',
      [startIso, endIso],
    );
    return rows.map(toCapture);
  }

  async listOlderThan(cutoffIso: string): Promise<AutoCapture[]> {
    const db = await this.openDb();
    const rows = await db.getAllAsync<Row>('SELECT * FROM auto_captures WHERE captured_at < ?', [cutoffIso]);
    return rows.map(toCapture);
  }

  async count(): Promise<number> {
    const db = await this.openDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM auto_captures');
    return row?.n ?? 0;
  }

  async delete(ids: string[]): Promise<void> {
    const db = await this.openDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const id of ids) await txn.runAsync('DELETE FROM auto_captures WHERE id = ?', [id]);
    });
  }

  async deleteAll(): Promise<void> {
    const db = await this.openDb();
    await db.runAsync('DELETE FROM auto_captures');
  }
}

/** Parses "<epochMillis>-<lens>.jpg"; returns null for anything else (temp files, strays). */
export function parseCaptureFileName(name: string, uri: string): AutoCapture | null {
  const match = /^(\d{12,14})-(back|front)\.jpg$/.exec(name);
  if (!match) return null;
  const time = Number(match[1]);
  if (!Number.isFinite(time)) return null;
  return { id: name, capturedAt: new Date(time).toISOString(), uri, lens: match[2] as 'back' | 'front' };
}

export const autoCaptureRepository = new AutoCaptureRepository();
