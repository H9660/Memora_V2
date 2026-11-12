import { createMemory, deriveTitle } from '@/utils/memory-factory';
import { validateMemory } from '@/utils/validation';

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));

const NOW = '2026-11-10T12:30:00.000Z';

describe('deriveTitle', () => {
  it('uses the first line of the note', () => {
    expect(deriveTitle('  Dinner with Ana \nWe tried the new place')).toBe('Dinner with Ana');
  });

  it('shortens long first lines', () => {
    const title = deriveTitle('a'.repeat(100));
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back for empty notes', () => {
    expect(deriveTitle('   ')).toBe('Untitled memory');
    expect(deriveTitle('', true)).toBe('Photo memory');
  });
});

describe('createMemory', () => {
  it('keeps the note exactly as entered and records it as user evidence', () => {
    const note = '  Exactly   as typed \n';
    const memory = createMemory({ note, capturedAt: NOW });

    expect(memory.note).toBe(note);
    expect(memory.eventTime).toBeNull();
    expect(memory.updatedAt).toBeNull();
    expect(memory.evidence).toHaveLength(1);
    expect(memory.evidence[0]).toMatchObject({ type: 'USER_NOTE', data: { text: note }, memoryId: memory.id });
    expect(validateMemory(memory)).toEqual([]);
  });

  it('adds location as separate sensor evidence with its own timestamp', () => {
    const memory = createMemory({
      note: 'Coffee',
      capturedAt: NOW,
      location: {
        latitude: 12.97,
        longitude: 77.59,
        accuracyMeters: 20,
        placeName: 'MG Road',
        capturedAt: '2026-11-10T12:29:55.000Z',
      },
    });

    const location = memory.evidence.find((evidence) => evidence.type === 'LOCATION');
    expect(location).toMatchObject({
      capturedAt: '2026-11-10T12:29:55.000Z',
      data: { latitude: 12.97, longitude: 77.59, placeName: 'MG Road', source: 'expo-location' },
    });
    expect(memory).toMatchObject({ placeName: 'MG Road', latitude: 12.97, longitude: 77.59 });
  });

  it('creates a photo-only memory without user-note evidence', () => {
    const memory = createMemory({
      note: '',
      capturedAt: NOW,
      photo: { uri: 'file:///photo.jpg', width: 10, height: 10, source: 'library', capturedAt: NOW },
    });

    expect(memory.title).toBe('Photo memory');
    expect(memory.evidence.map((evidence) => evidence.type)).toEqual(['PHOTO']);
    expect(validateMemory(memory)).toEqual([]);
  });

  it('generates unique ids', () => {
    const a = createMemory({ note: 'a', capturedAt: NOW });
    const b = createMemory({ note: 'b', capturedAt: NOW });
    expect(a.id).not.toBe(b.id);
    expect(a.evidence[0].id).not.toBe(b.evidence[0].id);
  });
});
