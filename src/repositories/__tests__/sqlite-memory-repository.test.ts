import { migrate, SCHEMA_VERSION } from '@/database/migrations';
import { MemoryRepositoryError } from '@/repositories/memory-repository';
import { SQLiteMemoryRepository } from '@/repositories/sqlite-memory-repository';
import { NodeSQLiteDatabase } from '@/test-utils/node-sqlite-database';
import { MemoryEvent } from '@/types/memory';
import { createMemory } from '@/utils/memory-factory';

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));
// The production module opens a real device database; tests inject their own.
jest.mock('@/database/database', () => ({ getDatabase: jest.fn() }));

const hoursAgo = (hours: number) =>
  new Date(Date.UTC(2026, 10, 10, 12) - hours * 3_600_000).toISOString();

async function setup() {
  const db = new NodeSQLiteDatabase();
  await migrate(db.asExpo());
  const repository = new SQLiteMemoryRepository(async () => db.asExpo());
  return { db, repository };
}

function countRows(db: NodeSQLiteDatabase, table: 'memories' | 'memory_evidence'): number {
  return (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function memoryWithLocation(note: string, capturedAt: string, placeName: string | null = 'Old Town Café'): MemoryEvent {
  return createMemory({
    note,
    capturedAt,
    location: { latitude: 48.2, longitude: 16.37, accuracyMeters: 12, placeName, capturedAt },
  });
}

describe('migrations', () => {
  it('creates the schema at the latest version with foreign keys enforced', async () => {
    const { db } = await setup();
    const version = db.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(SCHEMA_VERSION);
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO memory_evidence (id, memory_id, type, captured_at, data_json) VALUES ('e', 'missing', 'USER_NOTE', 'x', '{}')",
        )
        .run(),
    ).toThrow();
  });

  it('upgrades a v1 database without losing existing memories', async () => {
    const db = new NodeSQLiteDatabase();
    db.raw.exec(`
      CREATE TABLE memories (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, note TEXT NOT NULL,
        event_time TEXT, captured_at TEXT NOT NULL, place_name TEXT, latitude REAL, longitude REAL);
      CREATE TABLE memory_evidence (id TEXT PRIMARY KEY NOT NULL, memory_id TEXT NOT NULL, type TEXT NOT NULL,
        captured_at TEXT NOT NULL, data_json TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE);
      INSERT INTO memories VALUES ('legacy', 'Old memory', 'Saved before v2', NULL, '2026-01-01T10:00:00.000Z', 'Park', 1.5, 2.5);
      INSERT INTO memory_evidence VALUES ('legacy-note', 'legacy', 'USER_NOTE', '2026-01-01T10:00:00.000Z', '{"text":"Saved before v2"}');
      PRAGMA user_version = 1;
    `);

    await migrate(db.asExpo());
    const repository = new SQLiteMemoryRepository(async () => db.asExpo());
    const legacy = await repository.getById('legacy');

    expect(legacy).toMatchObject({
      title: 'Old memory',
      note: 'Saved before v2',
      placeName: 'Park',
      latitude: 1.5,
      longitude: 2.5,
      updatedAt: null,
    });
    expect(legacy?.evidence).toHaveLength(1);
  });
});

describe('migrating the earlier prototype schema', () => {
  // Same layout as databases created by the app's earlier prototype (user_version 1).
  function prototypeDb(): NodeSQLiteDatabase {
    const db = new NodeSQLiteDatabase();
    db.raw.exec(`
      CREATE TABLE memories (id TEXT PRIMARY KEY NOT NULL, captured_at TEXT NOT NULL, event_time TEXT,
        note TEXT NOT NULL, latitude REAL, longitude REAL, place_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX idx_memories_captured_at ON memories (captured_at DESC);
      CREATE TABLE evidence (id TEXT PRIMARY KEY NOT NULL,
        memory_id TEXT NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
        type TEXT NOT NULL, captured_at TEXT NOT NULL, source_description TEXT NOT NULL, payload_ref TEXT);
      CREATE INDEX idx_evidence_memory_id ON evidence (memory_id);
      CREATE TABLE memory_evidence (id TEXT PRIMARY KEY NOT NULL, memory_id TEXT NOT NULL, type TEXT NOT NULL,
        captured_at TEXT NOT NULL, data TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE);

      INSERT INTO memories VALUES ('m1', '2026-11-02T17:49:20.296Z', NULL, 'Left my umbrella at the library',
        10.5, 20.25, NULL, '2026-11-02T17:49:37.985Z', '2026-11-02T17:49:37.985Z');
      INSERT INTO memories VALUES ('m2', '2026-11-03T09:00:00.000Z', NULL, 'Edited later',
        NULL, NULL, 'Station', '2026-11-03T09:00:01.000Z', '2026-11-04T10:00:00.000Z');
      INSERT INTO evidence VALUES ('e-note', 'm1', 'USER_NOTE', '2026-11-02T17:49:20.296Z', 'Written by you', NULL);
      INSERT INTO evidence VALUES ('e-loc', 'm1', 'LOCATION', '2026-11-02T17:49:25.799Z', 'Phone location (foreground GPS)', NULL);
      INSERT INTO evidence VALUES ('e-photo', 'm1', 'PHOTO', '2026-11-02T17:49:31.024Z',
        'Photo taken with your camera', 'file:///data/files/photos/p.jpg');
      INSERT INTO memory_evidence VALUES ('e-new', 'm2', 'USER_NOTE', '2026-11-03T09:00:00.000Z', '{"text":"Edited later"}');
      PRAGMA user_version = 1;
    `);
    return db;
  }

  it('converts memories and evidence without losing data', async () => {
    const db = prototypeDb();
    await migrate(db.asExpo());
    const repository = new SQLiteMemoryRepository(async () => db.asExpo());

    const m1 = await repository.getById('m1');
    expect(m1).toMatchObject({
      title: 'Left my umbrella at the library',
      note: 'Left my umbrella at the library',
      capturedAt: '2026-11-02T17:49:20.296Z',
      updatedAt: null,
      latitude: 10.5,
      longitude: 20.25,
    });
    expect(m1?.evidence.map((evidence) => [evidence.id, evidence.type])).toEqual([
      ['e-note', 'USER_NOTE'],
      ['e-loc', 'LOCATION'],
      ['e-photo', 'PHOTO'],
    ]);
    expect(m1?.evidence[0].data).toMatchObject({ text: 'Left my umbrella at the library' });
    expect(m1?.evidence[1].data).toMatchObject({ latitude: 10.5, longitude: 20.25, source: 'expo-location' });
    expect(m1?.evidence[2].data).toMatchObject({ uri: 'file:///data/files/photos/p.jpg', source: 'camera' });

    const m2 = await repository.getById('m2');
    expect(m2).toMatchObject({ placeName: 'Station', updatedAt: '2026-11-04T10:00:00.000Z' });
    expect(m2?.evidence[0].data).toEqual({ text: 'Edited later' });

    const version = db.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(SCHEMA_VERSION);
  });

  it('leaves a working schema: new memories save, search works, deletes cascade', async () => {
    const db = prototypeDb();
    await migrate(db.asExpo());
    await migrate(db.asExpo()); // re-running is a no-op
    const repository = new SQLiteMemoryRepository(async () => db.asExpo());

    const fresh = memoryWithLocation('After the upgrade', hoursAgo(1));
    await repository.create(fresh);
    expect((await repository.search('umbrella')).map((memory) => memory.id)).toEqual(['m1']);

    await repository.delete('m1');
    expect(await repository.getEvidence('m1')).toEqual([]);
    expect((await repository.getAll()).map((memory) => memory.id)).toEqual([fresh.id, 'm2']);
  });
});

describe('SQLiteMemoryRepository', () => {
  it('saves a memory and retrieves it by id with its evidence', async () => {
    const { repository } = await setup();
    const memory = memoryWithLocation('Met Jo for coffee', hoursAgo(1));

    await repository.create(memory);

    expect(await repository.getById(memory.id)).toEqual(memory);
    expect(await repository.getEvidence(memory.id)).toEqual(memory.evidence);
  });

  it('returns null for an unknown id', async () => {
    const { repository } = await setup();
    expect(await repository.getById('nope')).toBeNull();
  });

  it('lists all memories newest-captured first', async () => {
    const { repository } = await setup();
    const older = createMemory({ note: 'older', capturedAt: hoursAgo(30) });
    const newest = createMemory({ note: 'newest', capturedAt: hoursAgo(1) });
    const middle = createMemory({ note: 'middle', capturedAt: hoursAgo(5) });

    for (const memory of [older, newest, middle]) await repository.create(memory);

    const all = await repository.getAll();
    expect(all.map((memory) => memory.note)).toEqual(['newest', 'middle', 'older']);
    expect(await repository.count()).toBe(3);
  });

  it('rejects invalid memories without writing anything', async () => {
    const { db, repository } = await setup();
    const memory = { ...createMemory({ note: 'x', capturedAt: hoursAgo(1) }), capturedAt: 'bad' };

    await expect(repository.create(memory)).rejects.toBeInstanceOf(MemoryRepositoryError);
    expect(countRows(db, 'memories')).toBe(0);
  });

  it('does not leave partial records when a transaction fails', async () => {
    const { db, repository } = await setup();
    const first = memoryWithLocation('first', hoursAgo(2));
    await repository.create(first);

    // Second memory reuses an evidence id, so its evidence insert fails after the memory row was written.
    const second = createMemory({ note: 'second', capturedAt: hoursAgo(1) });
    second.evidence[0] = { ...second.evidence[0], id: first.evidence[0].id };

    await expect(repository.create(second)).rejects.toBeInstanceOf(MemoryRepositoryError);
    expect(await repository.getById(second.id)).toBeNull();
    expect(countRows(db, 'memories')).toBe(1);
    expect(countRows(db, 'memory_evidence')).toBe(first.evidence.length);
  });

  it('refuses to overwrite an existing memory on create', async () => {
    const { repository } = await setup();
    const memory = createMemory({ note: 'original', capturedAt: hoursAgo(1) });
    await repository.create(memory);

    const clash = { ...createMemory({ note: 'impostor', capturedAt: hoursAgo(1) }), id: memory.id };
    clash.evidence = clash.evidence.map((evidence) => ({ ...evidence, memoryId: memory.id }));

    await expect(repository.create(clash)).rejects.toBeInstanceOf(MemoryRepositoryError);
    expect((await repository.getById(memory.id))?.note).toBe('original');
  });

  it('edits title and note but keeps the originally captured note evidence', async () => {
    const { repository } = await setup();
    const memory = createMemory({ note: 'First draft', capturedAt: hoursAgo(1) });
    await repository.create(memory);

    const editedAt = hoursAgo(0);
    const updated = await repository.update(
      memory.id,
      { title: '  Better title ', note: 'Corrected note' },
      editedAt,
    );

    expect(updated).toMatchObject({ title: 'Better title', note: 'Corrected note', updatedAt: editedAt });
    expect(updated?.evidence[0].data).toEqual({ text: 'First draft' });
  });

  it('returns null when editing a memory that no longer exists', async () => {
    const { repository } = await setup();
    expect(await repository.update('gone', { title: 't', note: 'n' }, hoursAgo(0))).toBeNull();
  });

  it('deletes a memory and its evidence', async () => {
    const { db, repository } = await setup();
    const keep = memoryWithLocation('keep', hoursAgo(2));
    const remove = memoryWithLocation('remove', hoursAgo(1));
    await repository.create(keep);
    await repository.create(remove);

    await repository.delete(remove.id);

    expect(await repository.getById(remove.id)).toBeNull();
    expect(await repository.getEvidence(remove.id)).toEqual([]);
    expect(countRows(db, 'memory_evidence')).toBe(keep.evidence.length);
  });

  it('cascades evidence deletion at the database level', async () => {
    const { db, repository } = await setup();
    const memory = memoryWithLocation('cascade', hoursAgo(1));
    await repository.create(memory);

    db.raw.prepare('DELETE FROM memories WHERE id = ?').run(memory.id);

    expect(countRows(db, 'memory_evidence')).toBe(0);
  });

  it('deletes everything', async () => {
    const { db, repository } = await setup();
    await repository.create(memoryWithLocation('a', hoursAgo(2)));
    await repository.create(memoryWithLocation('b', hoursAgo(1)));

    await repository.deleteAll();

    expect(countRows(db, 'memories')).toBe(0);
    expect(countRows(db, 'memory_evidence')).toBe(0);
  });

  describe('search', () => {
    it('matches title, note and place case-insensitively, newest first', async () => {
      const { repository } = await setup();
      const byNote = createMemory({ note: 'Bought FRESH bread\nfrom the bakery', capturedAt: hoursAgo(3) });
      const byPlace = memoryWithLocation('Quick stop', hoursAgo(1), 'Bakery Lane');
      const unrelated = createMemory({ note: 'Gym session', capturedAt: hoursAgo(2) });
      for (const memory of [byNote, byPlace, unrelated]) await repository.create(memory);

      const results = await repository.search('  bakery ');
      expect(results.map((memory) => memory.id)).toEqual([byPlace.id, byNote.id]);
      expect((await repository.search('fresh')).map((memory) => memory.id)).toEqual([byNote.id]);
    });

    it('matches text that only exists in evidence (the original note after an edit)', async () => {
      const { repository } = await setup();
      const memory = createMemory({ note: 'Saw a heron by the canal', capturedAt: hoursAgo(1) });
      await repository.create(memory);
      await repository.update(memory.id, { title: 'Walk', note: 'Walk' }, hoursAgo(0));

      expect((await repository.search('heron')).map((result) => result.id)).toEqual([memory.id]);
    });

    it('treats LIKE wildcards literally and ignores blank queries', async () => {
      const { repository } = await setup();
      await repository.create(createMemory({ note: 'Nothing special', capturedAt: hoursAgo(1) }));
      await repository.create(createMemory({ note: 'Got 100% on the test', capturedAt: hoursAgo(2) }));

      expect((await repository.search('%')).map((memory) => memory.note)).toEqual(['Got 100% on the test']);
      expect(await repository.search('_')).toEqual([]);
      expect(await repository.search('   ')).toEqual([]);
    });
  });

  it('survives corrupted evidence rows', async () => {
    const { db, repository } = await setup();
    const memory = createMemory({ note: 'resilient', capturedAt: hoursAgo(1) });
    await repository.create(memory);

    db.raw
      .prepare(
        `INSERT INTO memory_evidence (id, memory_id, type, captured_at, data_json) VALUES
         ('bad-json', ?, 'LOCATION', ?, '{not json'),
         ('array-json', ?, 'PHOTO', ?, '[1,2]'),
         ('unknown-type', ?, 'AUDIO', ?, '{}')`,
      )
      .run(memory.id, hoursAgo(1), memory.id, hoursAgo(1), memory.id, hoursAgo(1));

    const loaded = await repository.getById(memory.id);
    const byId = Object.fromEntries((loaded?.evidence ?? []).map((evidence) => [evidence.id, evidence]));

    expect(byId['bad-json'].data).toEqual({});
    expect(byId['array-json'].data).toEqual({});
    expect(byId['unknown-type']).toBeUndefined();
    expect(await repository.getAll()).toHaveLength(1);
  });

  it('wraps database failures in MemoryRepositoryError', async () => {
    const repository = new SQLiteMemoryRepository(() => Promise.reject(new Error('disk I/O error')));
    await expect(repository.getAll()).rejects.toBeInstanceOf(MemoryRepositoryError);
  });
});
