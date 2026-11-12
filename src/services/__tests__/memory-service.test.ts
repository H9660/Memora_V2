import { migrate } from '@/database/migrations';
import { SQLiteMemoryRepository } from '@/repositories/sqlite-memory-repository';
import { CaptureValidationError, createMemoryService } from '@/services/memory-service';
import { deletePhoto, persistPhoto } from '@/services/photos';
import { NodeSQLiteDatabase } from '@/test-utils/node-sqlite-database';

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));
jest.mock('@/database/database', () => ({ getDatabase: jest.fn() }));
jest.mock('@/repositories', () => ({ memoryRepository: {} }));
jest.mock('@/services/photos', () => ({
  persistPhoto: jest.fn(async (photo: { width: number; height: number; source: string }) => ({
    uri: 'file:///app/memory-photos/stored.jpg',
    width: photo.width,
    height: photo.height,
    source: photo.source,
  })),
  deletePhoto: jest.fn(),
  deleteAllPhotos: jest.fn(),
}));

const CAPTURED_AT = '2026-11-10T12:00:00.000Z';
const pendingPhoto = {
  uri: 'file:///cache/picker/tmp.jpg',
  width: 800,
  height: 600,
  source: 'library' as const,
  capturedAt: CAPTURED_AT,
};

async function setup() {
  const db = new NodeSQLiteDatabase();
  await migrate(db.asExpo());
  const repository = new SQLiteMemoryRepository(async () => db.asExpo());
  return { repository, service: createMemoryService(repository) };
}

beforeEach(() => jest.clearAllMocks());

describe('memory service', () => {
  it('captures a note without location or photo', async () => {
    const { service, repository } = await setup();
    const memory = await service.capture({ note: 'Just a note', capturedAt: CAPTURED_AT, location: null, photo: null });

    const saved = await repository.getById(memory.id);
    expect(saved).toMatchObject({ note: 'Just a note', latitude: null, placeName: null, eventTime: null });
    expect(saved?.evidence.map((evidence) => evidence.type)).toEqual(['USER_NOTE']);
    expect(persistPhoto).not.toHaveBeenCalled();
  });

  it('stores the durable photo uri, not the temporary picker uri', async () => {
    const { service, repository } = await setup();
    const memory = await service.capture({ note: '', capturedAt: CAPTURED_AT, location: null, photo: pendingPhoto });

    const photo = (await repository.getById(memory.id))?.evidence.find((evidence) => evidence.type === 'PHOTO');
    expect(photo?.data.uri).toBe('file:///app/memory-photos/stored.jpg');
  });

  it('rejects an empty capture before touching storage', async () => {
    const { service } = await setup();
    await expect(
      service.capture({ note: '  ', capturedAt: CAPTURED_AT, location: null, photo: null }),
    ).rejects.toBeInstanceOf(CaptureValidationError);
  });

  it('removes the copied photo if the database write fails', async () => {
    const { service, repository } = await setup();
    jest.spyOn(repository, 'create').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      service.capture({ note: 'x', capturedAt: CAPTURED_AT, location: null, photo: pendingPhoto }),
    ).rejects.toThrow('disk full');
    expect(deletePhoto).toHaveBeenCalledWith('file:///app/memory-photos/stored.jpg');
  });

  it('deletes photo files along with the memory', async () => {
    const { service, repository } = await setup();
    const memory = await service.capture({ note: 'x', capturedAt: CAPTURED_AT, location: null, photo: pendingPhoto });

    await service.remove(memory.id);

    expect(await repository.getById(memory.id)).toBeNull();
    expect(deletePhoto).toHaveBeenCalledWith('file:///app/memory-photos/stored.jpg');
  });
});
