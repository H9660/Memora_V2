import type { SQLiteDatabase } from 'expo-sqlite';

import { deriveTitle } from '@/utils/memory-factory';

/**
 * A migration step: plain SQL, or a function for steps that must inspect and
 * transform existing data. Each step upgrades the schema by one version.
 * Append new steps; never edit one that has already shipped.
 */
type Migration =
  | { kind: 'sql'; sql: string }
  /** Runs with foreign keys disabled so tables can be rebuilt without triggering cascades. */
  | { kind: 'rebuild'; run: (db: SQLiteDatabase) => Promise<void> };

const MIGRATIONS: Migration[] = [
  // v1: initial schema (no-op where tables already exist; v2 reconciles their shape).
  {
    kind: 'sql',
    sql: `
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL,
      event_time TEXT,
      captured_at TEXT NOT NULL,
      place_name TEXT,
      latitude REAL,
      longitude REAL
    );

    CREATE TABLE IF NOT EXISTS memory_evidence (
      id TEXT PRIMARY KEY NOT NULL,
      memory_id TEXT NOT NULL,
      type TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memories_captured_at
    ON memories(captured_at);
    `,
  },
  // v2: bring any earlier layout (fresh v1, or the pre-SQLite-repository prototype schema)
  // to the canonical shape, adding updated_at. Rebuilds tables, preserving every row.
  { kind: 'rebuild', run: reconcileSchema },
  // v3: optional background location log (separate from memories) and app settings.
  {
    kind: 'sql',
    sql: `
    CREATE TABLE IF NOT EXISTS location_observations (
      id TEXT PRIMARY KEY NOT NULL,
      captured_at TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_meters REAL,
      source TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_location_observations_captured_at
    ON location_observations(captured_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    `,
  },
  // v4: human-readable place for each location-log reading (filled by reverse geocoding).
  {
    kind: 'sql',
    sql: `ALTER TABLE location_observations ADD COLUMN place_name TEXT;`,
  },
  // v5: the user's own note about a whole day (Daily Review). Keyed by local date, YYYY-MM-DD.
  {
    kind: 'sql',
    sql: `
    CREATE TABLE IF NOT EXISTS day_notes (
      day TEXT PRIMARY KEY NOT NULL,
      note TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    `,
  },
  // v6: photos taken automatically by the auto camera (kept apart from memories).
  {
    kind: 'sql',
    sql: `
    CREATE TABLE IF NOT EXISTS auto_captures (
      id TEXT PRIMARY KEY NOT NULL,
      captured_at TEXT NOT NULL,
      uri TEXT NOT NULL,
      lens TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auto_captures_captured_at
    ON auto_captures(captured_at);
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function columnsOf(db: SQLiteDatabase, table: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

async function tableExists(db: SQLiteDatabase, table: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  return (row?.n ?? 0) > 0;
}

/** Turns a row of the prototype `evidence` table into canonical evidence data. */
function legacyEvidenceData(evidence: Row, memory: Row | undefined): Record<string, unknown> {
  const description = str(evidence.source_description);
  const base = description ? { legacyDescription: description } : {};

  switch (evidence.type) {
    case 'USER_NOTE':
      return { text: str(memory?.note) ?? '', ...base };
    case 'LOCATION':
      return {
        latitude: num(memory?.latitude),
        longitude: num(memory?.longitude),
        accuracyMeters: null,
        placeName: str(memory?.place_name),
        source: 'expo-location',
        ...base,
      };
    case 'PHOTO':
      return {
        uri: str(evidence.payload_ref),
        width: null,
        height: null,
        source: description && /camera/i.test(description) ? 'camera' : 'library',
        ...base,
      };
    default:
      return { ...base, payloadRef: str(evidence.payload_ref) };
  }
}

async function reconcileSchema(db: SQLiteDatabase): Promise<void> {
  const memoryColumns = await columnsOf(db, 'memories');
  const memories = await db.getAllAsync<Row>('SELECT * FROM memories');

  const evidenceColumns = await columnsOf(db, 'memory_evidence');
  const evidence = evidenceColumns.size > 0
    ? await db.getAllAsync<Row>('SELECT * FROM memory_evidence ORDER BY rowid')
    : [];
  const legacyEvidence = (await tableExists(db, 'evidence'))
    ? await db.getAllAsync<Row>('SELECT * FROM evidence ORDER BY rowid')
    : [];

  const photoMemoryIds = new Set(
    [...evidence, ...legacyEvidence].filter((row) => row.type === 'PHOTO').map((row) => row.memory_id),
  );

  await db.execAsync(`
    CREATE TABLE memories_v2 (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL,
      event_time TEXT,
      captured_at TEXT NOT NULL,
      updated_at TEXT,
      place_name TEXT,
      latitude REAL,
      longitude REAL
    );
    CREATE TABLE memory_evidence_v2 (
      id TEXT PRIMARY KEY NOT NULL,
      memory_id TEXT NOT NULL,
      type TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
  `);

  const memoriesById = new Map<unknown, Row>();
  for (const row of memories) {
    memoriesById.set(row.id, row);
    const note = str(row.note) ?? '';
    const capturedAt = str(row.captured_at) ?? str(row.created_at) ?? new Date(0).toISOString();
    const existingTitle = memoryColumns.has('title') ? str(row.title)?.trim() : null;
    // The prototype set updated_at = created_at on insert; that is not a user edit.
    const updatedAt = str(row.updated_at);
    const editedAt = updatedAt && updatedAt !== str(row.created_at) ? updatedAt : null;

    await db.runAsync(
      `INSERT INTO memories_v2
         (id, title, note, event_time, captured_at, updated_at, place_name, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(row.id),
        existingTitle || deriveTitle(note, photoMemoryIds.has(row.id)),
        note,
        str(row.event_time),
        capturedAt,
        editedAt,
        str(row.place_name),
        num(row.latitude),
        num(row.longitude),
      ],
    );
  }

  const seenEvidence = new Set<unknown>();
  for (const row of evidence) {
    if (!memoriesById.has(row.memory_id)) continue; // orphan from a time FKs were off
    seenEvidence.add(row.id);
    const json = str(row.data_json) ?? str(row.data) ?? '{}';
    await db.runAsync(
      'INSERT INTO memory_evidence_v2 (id, memory_id, type, captured_at, data_json) VALUES (?, ?, ?, ?, ?)',
      [String(row.id), String(row.memory_id), String(row.type), String(row.captured_at), json],
    );
  }

  for (const row of legacyEvidence) {
    if (seenEvidence.has(row.id) || !memoriesById.has(row.memory_id)) continue;
    const data = legacyEvidenceData(row, memoriesById.get(row.memory_id));
    await db.runAsync(
      'INSERT INTO memory_evidence_v2 (id, memory_id, type, captured_at, data_json) VALUES (?, ?, ?, ?, ?)',
      [String(row.id), String(row.memory_id), String(row.type), String(row.captured_at), JSON.stringify(data)],
    );
  }

  // The prototype `evidence` table is left in place (unused) so no original data is destroyed.
  await db.execAsync(`
    DROP TABLE IF EXISTS memory_evidence;
    DROP TABLE memories;
    ALTER TABLE memories_v2 RENAME TO memories;
    ALTER TABLE memory_evidence_v2 RENAME TO memory_evidence;
    CREATE INDEX IF NOT EXISTS idx_memories_captured_at ON memories(captured_at);
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_memory_id ON memory_evidence(memory_id);
  `);
}

/**
 * Brings the schema up to date. Each step runs in its own transaction, so a
 * failure leaves the last good version intact and the step is retried next launch.
 */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = result?.user_version ?? 0;

  for (let version = currentVersion; version < MIGRATIONS.length; version++) {
    const step = MIGRATIONS[version];

    if (step.kind === 'sql') {
      await db.withTransactionAsync(async () => {
        await db.execAsync(step.sql);
        await db.execAsync(`PRAGMA user_version = ${version + 1}`);
      });
      continue;
    }

    // foreign_keys can't change inside a transaction, so toggle it around the step.
    await db.execAsync('PRAGMA foreign_keys = OFF');
    try {
      await db.withTransactionAsync(async () => {
        await step.run(db);
        const violations = await db.getAllAsync('PRAGMA foreign_key_check(memory_evidence)');
        if (violations.length > 0) {
          throw new Error(`Migration ${version + 1} left ${violations.length} broken references.`);
        }
        await db.execAsync(`PRAGMA user_version = ${version + 1}`);
      });
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON');
    }
  }
}
