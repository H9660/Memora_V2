import * as SQLite from 'expo-sqlite';

import { migrate } from '@/database/migrations';

const DATABASE_NAME = 'memora.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await db.execAsync('PRAGMA journal_mode = WAL');
  // Foreign keys are off by default and must be enabled on every connection.
  await db.execAsync('PRAGMA foreign_keys = ON');
  await migrate(db);

  return db;
}

/** Opens and migrates the database once; later calls share the same connection. */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error) => {
      // Allow a retry on the next call instead of caching the failure.
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}
