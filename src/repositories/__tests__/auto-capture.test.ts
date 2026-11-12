import { migrate } from '@/database/migrations';
import { AutoCaptureRepository, parseCaptureFileName } from '@/repositories/auto-capture-repository';
import { buildDayReview, MAX_AUTO_SLIDES, sampleEvenly } from '@/review/day-review';
import { NodeSQLiteDatabase } from '@/test-utils/node-sqlite-database';

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));
jest.mock('@/database/database', () => ({ getDatabase: jest.fn() }));

const base = Date.UTC(2026, 10, 12, 4, 0);
const capture = (minutes: number, lens: 'back' | 'front' = 'back') =>
  parseCaptureFileName(`${base + minutes * 60_000}-${lens}.jpg`, `file:///auto/${base + minutes * 60_000}-${lens}.jpg`)!;

describe('parseCaptureFileName', () => {
  it('reads time and lens from the service’s file names', () => {
    expect(parseCaptureFileName('1731384000000-front.jpg', 'file:///x')).toEqual({
      id: '1731384000000-front.jpg',
      capturedAt: new Date(1731384000000).toISOString(),
      uri: 'file:///x',
      lens: 'front',
    });
  });

  it('ignores temp files and anything else', () => {
    expect(parseCaptureFileName('.1731384000000.tmp', 'x')).toBeNull();
    expect(parseCaptureFileName('holiday.jpg', 'x')).toBeNull();
    expect(parseCaptureFileName('1731384000000-side.jpg', 'x')).toBeNull();
  });
});

describe('AutoCaptureRepository', () => {
  it('mirrors the files on disk', async () => {
    const db = new NodeSQLiteDatabase();
    await migrate(db.asExpo());
    const repo = new AutoCaptureRepository(async () => db.asExpo());

    expect(await repo.syncWith([capture(0), capture(5), capture(10)])).toBe(3);
    expect(await repo.syncWith([capture(5), capture(10), capture(15)])).toBe(1); // 0 deleted on disk, 15 new
    const listed = await repo.listBetween(new Date(base).toISOString(), new Date(base + 3_600_000).toISOString());
    expect(listed.map((c) => c.id)).toEqual([capture(5).id, capture(10).id, capture(15).id]);

    const old = await repo.listOlderThan(new Date(base + 7 * 60_000).toISOString());
    expect(old.map((c) => c.id)).toEqual([capture(5).id]);
    await repo.delete(old.map((c) => c.id));
    expect(await repo.count()).toBe(2);
  });
});

describe('auto photos in the daily review', () => {
  it('samples evenly, keeping first and last', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const sample = sampleEvenly(items, 5);
    expect(sample).toEqual([0, 25, 50, 74, 99]);
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('adds auto photos to the film with places from the location log, capped per day', () => {
    const autos = Array.from({ length: 200 }, (_, i) => capture(i));
    const review = buildDayReview({
      memories: [],
      observations: [
        {
          id: 'o1',
          capturedAt: new Date(base + 2 * 60_000).toISOString(),
          latitude: 1,
          longitude: 1,
          accuracyMeters: 5,
          placeName: 'Cubbon Park',
          source: 'background',
        },
      ],
      autoCaptures: autos,
    });

    expect(review.slides).toHaveLength(MAX_AUTO_SLIDES);
    expect(review.slides[0]).toMatchObject({ source: 'auto', placeName: 'Cubbon Park', memoryId: null });
    expect(review.autoPhotoCount).toBe(200);
    expect(review.summary).toContain(`The auto camera took 200 photos (the film shows ${MAX_AUTO_SLIDES}).`);
  });
});
