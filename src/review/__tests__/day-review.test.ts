import { migrate } from '@/database/migrations';
import { DayNoteRepository } from '@/repositories/day-note-repository';
import type { LocationObservation } from '@/repositories/location-log-repository';
import { SQLiteMemoryRepository } from '@/repositories/sqlite-memory-repository';
import { buildDayReview, dayBounds, dayKey, parseDayKey, shiftDay } from '@/review/day-review';
import { NodeSQLiteDatabase } from '@/test-utils/node-sqlite-database';
import { createMemory } from '@/utils/memory-factory';

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));
jest.mock('@/database/database', () => ({ getDatabase: jest.fn() }));

const at = (hh: number, mm = 0) => new Date(2026, 10, 12, hh, mm).toISOString();

function reading(time: string, placeName: string | null): LocationObservation {
  return { id: `o-${time}`, capturedAt: time, latitude: 1, longitude: 1, accuracyMeters: 10, placeName, source: 'background' };
}

function photoMemory(note: string, time: string, placeName: string | null = null) {
  return createMemory({
    note,
    capturedAt: time,
    location: placeName ? { latitude: 1, longitude: 1, accuracyMeters: 5, placeName, capturedAt: time } : null,
    photo: { uri: `file:///p/${note}.jpg`, width: 1, height: 1, source: 'camera', capturedAt: time },
  });
}

describe('buildDayReview', () => {
  it('orders photos by time and labels each with a place', () => {
    const review = buildDayReview({
      memories: [
        photoMemory('lunch', at(13), 'MG Road'),
        photoMemory('walk', at(9, 10)), // no place on the memory: use the log reading 5 min earlier
        photoMemory('late', at(22)), // nothing within 20 min: no place
      ],
      observations: [reading(at(9, 5), 'Cubbon Park'), reading(at(21, 0), 'Home')],
    });

    expect(review.slides.map((s) => [s.memoryTitle, s.placeName])).toEqual([
      ['walk', 'Cubbon Park'],
      ['lunch', 'MG Road'],
      ['late', null],
    ]);
  });

  it('merges consecutive readings at the same place into stops', () => {
    const review = buildDayReview({
      memories: [],
      observations: [
        reading(at(8), 'Home'),
        reading(at(8, 30), 'Home'),
        reading(at(10), 'Office'),
        reading(at(12), 'Office'),
        reading(at(13), null),
        reading(at(19), 'Home'),
      ],
    });
    expect(review.stops).toEqual([
      { placeName: 'Home', from: at(8), to: at(8, 30) },
      { placeName: 'Office', from: at(10), to: at(12) },
      { placeName: 'Home', from: at(19), to: at(19) },
    ]);
  });

  it('writes a factual summary', () => {
    const review = buildDayReview({
      memories: [photoMemory('Coffee with Sam', at(9), 'Café'), createMemory({ note: 'Called mum', capturedAt: at(18) })],
      observations: [reading(at(12), 'Office')],
    });
    expect(review.summary[0]).toMatch(/^You saved 2 memories and 1 photo between .+ and .+\.$/);
    expect(review.summary[1]).toBe('Your phone was at 2 places: Café → Office.');
    expect(review.summary[2]).toBe('Memories: “Coffee with Sam”, “Called mum”.');
  });

  it('says so when nothing was recorded', () => {
    expect(buildDayReview({ memories: [], observations: [] }).summary).toEqual(['Nothing was recorded on this day.']);
  });
});

describe('day helpers', () => {
  it('round-trips day keys and computes local-day bounds', () => {
    const day = new Date(2026, 0, 31);
    expect(dayKey(day)).toBe('2026-01-31');
    expect(parseDayKey('2026-01-31')?.getTime()).toBe(day.getTime());
    expect(parseDayKey('nope')).toBeNull();
    expect(dayKey(shiftDay(day, 1))).toBe('2026-02-01');

    const { start, end } = dayBounds(day);
    expect(new Date(start).getTime()).toBe(new Date(2026, 0, 31).getTime());
    expect(new Date(end).getTime()).toBe(new Date(2026, 1, 1).getTime());
  });
});

describe('day storage', () => {
  async function setup() {
    const db = new NodeSQLiteDatabase();
    await migrate(db.asExpo());
    const open = async () => db.asExpo();
    return { memories: new SQLiteMemoryRepository(open), notes: new DayNoteRepository(open) };
  }

  it('loads only the memories inside a day, oldest first', async () => {
    const { memories } = await setup();
    const before = createMemory({ note: 'yesterday', capturedAt: new Date(2026, 10, 11, 23, 59).toISOString() });
    const morning = createMemory({ note: 'morning', capturedAt: at(8) });
    const evening = createMemory({ note: 'evening', capturedAt: at(20) });
    const after = createMemory({ note: 'tomorrow', capturedAt: new Date(2026, 10, 13, 0, 0).toISOString() });
    for (const m of [evening, before, after, morning]) await memories.create(m);

    const { start, end } = dayBounds(new Date(2026, 10, 12));
    expect((await memories.getBetween(start, end)).map((m) => m.note)).toEqual(['morning', 'evening']);
  });

  it('saves, replaces and clears the user’s day note', async () => {
    const { notes } = await setup();
    await notes.set('2026-11-12', 'Tired but happy', '2026-11-12T20:00:00.000Z');
    await notes.set('2026-11-12', 'Tired but happy. Saw Sam.', '2026-11-12T21:00:00.000Z');
    expect(await notes.get('2026-11-12')).toEqual({
      day: '2026-11-12',
      note: 'Tired but happy. Saw Sam.',
      updatedAt: '2026-11-12T21:00:00.000Z',
    });

    expect(await notes.importMissing([{ day: '2026-11-12', note: 'from backup', updatedAt: 'x' }, { day: '2026-11-01', note: 'older', updatedAt: 'x' }])).toBe(1);
    expect((await notes.get('2026-11-12'))?.note).toBe('Tired but happy. Saw Sam.');

    await notes.set('2026-11-12', '   ');
    expect(await notes.get('2026-11-12')).toBeNull();
    await expect(notes.set('12/11/2026', 'bad key')).rejects.toThrow();
  });
});
