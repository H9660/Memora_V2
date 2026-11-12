/// <reference types="node" />
import { randomBytes } from 'node:crypto';

import { createBackupService, PhotoStore } from '@/backup/backup-service';
import { BackupAuthError, BackupFormatError, BackupReader, MemoryBytes } from '@/backup/format';
import { migrate } from '@/database/migrations';
import { LocationLogRepository } from '@/repositories/location-log-repository';
import { SQLiteMemoryRepository } from '@/repositories/sqlite-memory-repository';
import { NodeSQLiteDatabase } from '@/test-utils/node-sqlite-database';
import { createMemory } from '@/utils/memory-factory';

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));
jest.mock('@/database/database', () => ({ getDatabase: jest.fn() }));

const PASSWORD = 'correct horse battery';
const random = (length: number) => new Uint8Array(randomBytes(length));

/** In-memory stand-in for the device photo folder. */
function fakePhotos(initial: Record<string, Uint8Array> = {}) {
  const files = new Map(Object.entries(initial));
  let counter = 0;
  const store: PhotoStore = {
    read: async (uri) => files.get(uri) ?? null,
    save: async (bytes, extension) => {
      const uri = `file:///restored/${counter++}.${extension}`;
      files.set(uri, bytes);
      return uri;
    },
    remove: (uri) => {
      files.delete(uri);
    },
  };
  return { store, files };
}

async function device(photos: ReturnType<typeof fakePhotos>) {
  const db = new NodeSQLiteDatabase();
  await migrate(db.asExpo());
  const open = async () => db.asExpo();
  const memories = new SQLiteMemoryRepository(open);
  const locationLog = new LocationLogRepository(open);
  const service = createBackupService({ memories, locationLog, photos: photos.store, random, iterations: 1000 });
  return { memories, locationLog, service };
}

async function populatedSource() {
  const photoBytes = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 0xff, 0xd9]);
  const photos = fakePhotos({ 'file:///app/memory-photos/a.jpg': photoBytes });
  const source = await device(photos);

  const withPhoto = createMemory({
    note: 'Picnic by the lake',
    capturedAt: '2026-11-10T10:00:00.000Z',
    location: { latitude: 12.97, longitude: 77.59, accuracyMeters: 10, placeName: 'Ulsoor Lake', capturedAt: '2026-11-10T10:00:00.000Z' },
    photo: { uri: 'file:///app/memory-photos/a.jpg', width: 4, height: 2, source: 'camera', capturedAt: '2026-11-10T10:00:05.000Z' },
  });
  const noteOnly = createMemory({ note: 'Called grandma', capturedAt: '2026-11-11T18:00:00.000Z' });
  await source.memories.create(withPhoto);
  await source.memories.create(noteOnly);
  const [reading] = await source.locationLog.add(
    [{ capturedAt: '2026-11-10T09:00:00.000Z', latitude: 12.9, longitude: 77.5, accuracyMeters: 20 }],
    0,
  );
  await source.locationLog.setPlaceName(reading.id, 'Home');

  const out = new MemoryBytes();
  const stats = await source.service.exportTo(out, PASSWORD);
  return { bytes: out.bytes(), stats, withPhoto, noteOnly, photoBytes };
}

describe('backup and restore', () => {
  it('round-trips memories, photos and the location log', async () => {
    const { bytes, stats, withPhoto, noteOnly, photoBytes } = await populatedSource();
    expect(stats).toEqual({ memories: 2, photos: 1, missingPhotos: 0, locationReadings: 1, dayNotes: 0 });

    const targetPhotos = fakePhotos();
    const target = await device(targetPhotos);
    const result = await target.service.importFrom(MemoryBytes.from(bytes), PASSWORD);

    expect(result).toMatchObject({
      memoriesAdded: 2,
      memoriesAlreadyPresent: 0,
      memoriesFailed: 0,
      photosRestored: 1,
      locationReadingsAdded: 1,
    });

    const restored = await target.memories.getById(withPhoto.id);
    expect(restored).toMatchObject({ note: 'Picnic by the lake', placeName: 'Ulsoor Lake', capturedAt: withPhoto.capturedAt });
    const photo = restored!.evidence.find((e) => e.type === 'PHOTO')!;
    expect(photo.data.uri).toMatch(/^file:\/\/\/restored\//);
    expect(targetPhotos.files.get(photo.data.uri as string)).toEqual(photoBytes);
    expect(await target.memories.getById(noteOnly.id)).toMatchObject({ note: 'Called grandma' });
    expect((await target.locationLog.listAll())[0]).toMatchObject({ placeName: 'Home' });
  });

  it('does not contain readable personal data', async () => {
    const { bytes } = await populatedSource();
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).not.toContain('Picnic');
    expect(text).not.toContain('Ulsoor');
    expect(text).toContain('memora-backup'); // only the plaintext header is readable
  });

  it('merges: memories already on the device are left untouched, and restoring twice adds nothing', async () => {
    const { bytes, withPhoto } = await populatedSource();
    const targetPhotos = fakePhotos();
    const target = await device(targetPhotos);

    await target.service.importFrom(MemoryBytes.from(bytes), PASSWORD);
    await target.memories.update(withPhoto.id, { title: 'Edited here', note: 'Edited on this phone' }, '2026-11-12T08:00:00.000Z');

    const second = await target.service.importFrom(MemoryBytes.from(bytes), PASSWORD);
    expect(second).toMatchObject({ memoriesAdded: 0, memoriesAlreadyPresent: 2, photosRestored: 0, locationReadingsAdded: 0 });
    expect((await target.memories.getById(withPhoto.id))?.note).toBe('Edited on this phone');
    expect(targetPhotos.files.size).toBe(1); // no duplicate photo files
  });

  it('rejects a wrong password without changing anything', async () => {
    const { bytes } = await populatedSource();
    const target = await device(fakePhotos());

    await expect(target.service.importFrom(MemoryBytes.from(bytes), 'wrong password')).rejects.toBeInstanceOf(BackupAuthError);
    expect(await target.memories.getAll()).toEqual([]);
  });

  it('detects truncated and tampered files, and cleans up partial photos', async () => {
    const { bytes } = await populatedSource();

    const truncatedPhotos = fakePhotos();
    const truncated = await device(truncatedPhotos);
    await expect(
      truncated.service.importFrom(MemoryBytes.from(bytes.slice(0, bytes.length - 20)), PASSWORD),
    ).rejects.toBeInstanceOf(Error);
    expect(await truncated.memories.getAll()).toEqual([]);
    expect(truncatedPhotos.files.size).toBe(0);

    const tamperedBytes = bytes.slice();
    tamperedBytes[tamperedBytes.length - 30] ^= 0xff;
    const tampered = await device(fakePhotos());
    await expect(tampered.service.importFrom(MemoryBytes.from(tamperedBytes), PASSWORD)).rejects.toBeInstanceOf(
      BackupAuthError,
    );
    expect(await tampered.memories.getAll()).toEqual([]);
  });

  it('reads the header without a password and rejects non-backup files', async () => {
    const { bytes } = await populatedSource();
    const header = await BackupReader.readHeader(MemoryBytes.from(bytes));
    expect(header).toMatchObject({ format: 'memora-backup', version: 1, cipher: 'AES-256-GCM' });

    await expect(
      BackupReader.readHeader(MemoryBytes.from(new TextEncoder().encode('just a text file'))),
    ).rejects.toBeInstanceOf(BackupFormatError);
  });

  it('refuses short passwords', async () => {
    const source = await device(fakePhotos());
    await expect(source.service.exportTo(new MemoryBytes(), 'short')).rejects.toBeInstanceOf(BackupFormatError);
  });
});
