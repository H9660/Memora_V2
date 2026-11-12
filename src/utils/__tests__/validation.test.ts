import { MemoryEvent } from '@/types/memory';
import { validateCaptureInput, validateEdit, validateMemory } from '@/utils/validation';

function validMemory(overrides: Partial<MemoryEvent> = {}): MemoryEvent {
  return {
    id: 'mem-1',
    title: 'Lunch at the market',
    note: 'Lunch at the market',
    eventTime: null,
    capturedAt: '2026-11-10T12:30:00.000Z',
    updatedAt: null,
    placeName: null,
    latitude: null,
    longitude: null,
    evidence: [],
    ...overrides,
  };
}

describe('validateMemory', () => {
  it('accepts a valid memory', () => {
    expect(validateMemory(validMemory())).toEqual([]);
  });

  it('accepts a null event time and a missing location', () => {
    expect(validateMemory(validMemory({ eventTime: null, latitude: null, longitude: null }))).toEqual(
      [],
    );
  });

  it('accepts a valid location and event time', () => {
    expect(
      validateMemory(
        validMemory({ latitude: 51.5, longitude: -0.12, eventTime: '2026-11-10T11:00:00.000Z' }),
      ),
    ).toEqual([]);
  });

  it('rejects a missing title', () => {
    expect(validateMemory(validMemory({ title: '   ' }))).toContain('Missing title.');
  });

  it('rejects a missing id', () => {
    expect(validateMemory(validMemory({ id: '' }))).toContain('Missing id.');
  });

  it.each(['not a date', '2026-11-10', '2026-13-45T99:00:00Z', ''])(
    'rejects an invalid capture time: %p',
    (capturedAt: string) => {
      expect(validateMemory(validMemory({ capturedAt }))).toContain('Invalid capture time.');
    },
  );

  it('rejects an invalid event time', () => {
    expect(validateMemory(validMemory({ eventTime: 'yesterday' }))).toContain('Invalid event time.');
  });

  it('rejects out-of-range coordinates', () => {
    const errors = validateMemory(validMemory({ latitude: 91, longitude: 181 }));
    expect(errors).toContain('Latitude out of range.');
    expect(errors).toContain('Longitude out of range.');
  });

  it('rejects non-finite coordinates', () => {
    expect(validateMemory(validMemory({ latitude: NaN, longitude: 0 }))).toContain(
      'Latitude out of range.',
    );
  });

  it('rejects a latitude without a longitude', () => {
    expect(validateMemory(validMemory({ latitude: 10, longitude: null }))).toContain(
      'Latitude and longitude must both be set or both be empty.',
    );
  });

  it('rejects evidence that belongs to another memory', () => {
    const errors = validateMemory(
      validMemory({
        evidence: [
          { id: 'e1', memoryId: 'other', type: 'USER_NOTE', capturedAt: '2026-11-10T12:30:00.000Z', data: {} },
        ],
      }),
    );
    expect(errors).toContain('Evidence e1 belongs to another memory.');
  });

  it('requires a note unless there is a photo', () => {
    expect(validateMemory(validMemory({ note: '' }))).toContain('A memory needs a note or a photo.');
    expect(
      validateMemory(
        validMemory({
          note: '',
          evidence: [
            { id: 'p1', memoryId: 'mem-1', type: 'PHOTO', capturedAt: '2026-11-10T12:30:00.000Z', data: {} },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('validateCaptureInput', () => {
  it('requires a note or a photo', () => {
    expect(validateCaptureInput({ note: '  ', hasPhoto: false })).not.toBeNull();
    expect(validateCaptureInput({ note: '', hasPhoto: true })).toBeNull();
    expect(validateCaptureInput({ note: 'Hello', hasPhoto: false })).toBeNull();
  });
});

describe('validateEdit', () => {
  it('rejects an empty title', () => {
    expect(validateEdit({ title: ' ', note: 'x' }, false)).toBe('The title cannot be empty.');
  });
});
