/// <reference types="node" />
/**
 * Test-only stand-in for expo-sqlite's SQLiteDatabase, backed by Node's built-in
 * SQLite engine. Implements just the async methods Memora's data layer uses, so
 * repository and migration tests run real SQL (constraints, cascades, rollbacks).
 */
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

type Params = (string | number | null)[];

function normalize(args: unknown[]): Params {
  return (args.length === 1 && Array.isArray(args[0]) ? args[0] : args) as Params;
}

export class NodeSQLiteDatabase {
  readonly raw: DatabaseSync;

  constructor() {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  async execAsync(sql: string): Promise<void> {
    this.raw.exec(sql);
  }

  async runAsync(sql: string, ...args: unknown[]) {
    const result = this.raw.prepare(sql).run(...normalize(args));
    return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
  }

  async getFirstAsync<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...normalize(args)) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...normalize(args)) as T[];
  }

  private async transaction(begin: string, task: () => Promise<void>): Promise<void> {
    this.raw.exec(begin);
    try {
      await task();
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return this.transaction('BEGIN', task);
  }

  withExclusiveTransactionAsync(task: (txn: SQLiteDatabase) => Promise<void>): Promise<void> {
    return this.transaction('BEGIN EXCLUSIVE', () => task(this.asExpo()));
  }

  asExpo(): SQLiteDatabase {
    return this as unknown as SQLiteDatabase;
  }
}
