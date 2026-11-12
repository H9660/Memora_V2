import { collectPhotos, memoriesEmptiedBy, recentRange } from '@/review/photo-review';
import { MemoryEvent, MemoryEvidence } from '@/types/memory';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 10, 0) + minutes * 60_000).toISOString();

function photo(id: string, memoryId: string, minutes: number): MemoryEvidence {
  return { id, memoryId, type: 'PHOTO', capturedAt: at(minutes), data: { uri: `file:///p/${id}.jpg` } };
}

function memory(id: string, note: string, evidence: MemoryEvidence[], minutes = 0): MemoryEvent {
  return {
    id,
    title: note || 'Untitled',
    note,
    eventTime: null,
    capturedAt: at(minutes),
    updatedAt: null,
    placeName: 'Park',
    latitude: null,
    longitude: null,
    evidence,
  };
}

const auto = (minutes: number) => ({
  id: `${Date.parse(at(minutes))}-back.jpg`,
  capturedAt: at(minutes),
  uri: `file:///auto/${minutes}.jpg`,
  lens: 'back' as const,
});

describe('recentRange', () => {
  it('covers the last N hours up to now', () => {
    const now = new Date(at(0));
    const range = recentRange(3, now);
    expect(range.start).toBe(at(-180));
    expect(range.end > now.toISOString()).toBe(true);
  });
});

describe('collectPhotos', () => {
  it('mixes memory and auto photos in the window, newest first', () => {
    const memories = [
      memory('m1', 'Lunch', [photo('p1', 'm1', -30)]),
      memory('m2', '', [photo('p2', 'm2', -500)]), // outside the window
    ];
    const photos = collectPhotos({
      memories,
      autoCaptures: [auto(-10), auto(-200), auto(-60)],
      range: { start: at(-180), end: at(1) },
    });

    expect(photos.map((p) => p.capturedAt)).toEqual([at(-10), at(-30), at(-60)]);
    expect(photos.map((p) => p.kind)).toEqual(['auto', 'memory', 'auto']);
    expect(photos[1]).toMatchObject({ memoryId: 'm1', evidenceId: 'p1', memoryTitle: 'Lunch', placeName: 'Park' });
  });

  it('ignores non-photo evidence and photos without a uri', () => {
    const broken: MemoryEvidence = { id: 'x', memoryId: 'm', type: 'PHOTO', capturedAt: at(0), data: {} };
    const note: MemoryEvidence = { id: 'n', memoryId: 'm', type: 'USER_NOTE', capturedAt: at(0), data: { text: 'hi' } };
    expect(
      collectPhotos({
        memories: [memory('m', 'hi', [broken, note])],
        autoCaptures: [],
        range: { start: at(-60), end: at(60) },
      }),
    ).toEqual([]);
  });
});

describe('memoriesEmptiedBy', () => {
  const photoOnly = memory('a', '', [photo('a1', 'a', 0), photo('a2', 'a', 1)]);
  const withNote = memory('b', 'Dinner', [photo('b1', 'b', 2)]);
  const all = collectPhotos({ memories: [photoOnly, withNote], autoCaptures: [], range: { start: at(-10), end: at(10) } });
  const pick = (...ids: string[]) => all.filter((p) => p.kind === 'memory' && ids.includes(p.evidenceId));

  it('flags a photo-only memory when all its photos are chosen', () => {
    expect(memoriesEmptiedBy(pick('a1', 'a2', 'b1'), [photoOnly, withNote]).map((m) => m.id)).toEqual(['a']);
  });

  it('does not flag memories that keep a photo or have a note', () => {
    expect(memoriesEmptiedBy(pick('a1', 'b1'), [photoOnly, withNote])).toEqual([]);
  });
});
