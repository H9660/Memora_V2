import { MemoryEdit, MemoryEvent } from '@/types/memory';

export const MAX_NOTE_LENGTH = 5000;
export const MAX_TITLE_LENGTH = 120;

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** True for a full ISO 8601 timestamp (as produced by `Date#toISOString`) that parses to a real date. */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_8601.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Checks what the user entered on the Capture screen. A memory needs at least
 * a note or a photo; location alone is an observation, not a memory.
 */
export function validateCaptureInput(input: { note: string; hasPhoto: boolean }): string | null {
  if (input.note.trim().length === 0 && !input.hasPhoto) {
    return 'Write a note or add a photo before saving.';
  }

  if (input.note.length > MAX_NOTE_LENGTH) {
    return `Notes can be at most ${MAX_NOTE_LENGTH} characters.`;
  }

  return null;
}

/** Checks a title/note edit. The note may only be emptied if the memory has a photo. */
export function validateEdit(edit: MemoryEdit, hasPhoto: boolean): string | null {
  if (edit.title.trim().length === 0) return 'The title cannot be empty.';
  if (edit.title.length > MAX_TITLE_LENGTH) {
    return `Titles can be at most ${MAX_TITLE_LENGTH} characters.`;
  }
  return validateCaptureInput({ note: edit.note, hasPhoto });
}

/** Returns a list of problems; an empty list means the memory is valid. */
export function validateMemory(memory: MemoryEvent): string[] {
  const errors: string[] = [];

  if (typeof memory.id !== 'string' || memory.id.trim().length === 0) errors.push('Missing id.');

  if (typeof memory.title !== 'string' || memory.title.trim().length === 0) {
    errors.push('Missing title.');
  } else if (memory.title.length > MAX_TITLE_LENGTH) {
    errors.push('Title is too long.');
  }

  if (typeof memory.note !== 'string') {
    errors.push('Note must be text.');
  } else if (memory.note.length > MAX_NOTE_LENGTH) {
    errors.push(`Notes can be at most ${MAX_NOTE_LENGTH} characters.`);
  }

  if (!isIsoTimestamp(memory.capturedAt)) errors.push('Invalid capture time.');
  if (memory.eventTime !== null && !isIsoTimestamp(memory.eventTime)) {
    errors.push('Invalid event time.');
  }
  if (memory.updatedAt !== null && !isIsoTimestamp(memory.updatedAt)) {
    errors.push('Invalid edit time.');
  }

  const hasLatitude = memory.latitude !== null;
  const hasLongitude = memory.longitude !== null;
  if (hasLatitude !== hasLongitude) {
    errors.push('Latitude and longitude must both be set or both be empty.');
  }
  if (
    memory.latitude !== null &&
    (!Number.isFinite(memory.latitude) || Math.abs(memory.latitude) > 90)
  ) {
    errors.push('Latitude out of range.');
  }
  if (
    memory.longitude !== null &&
    (!Number.isFinite(memory.longitude) || Math.abs(memory.longitude) > 180)
  ) {
    errors.push('Longitude out of range.');
  }

  const evidenceIds = new Set<string>();
  for (const evidence of memory.evidence) {
    if (evidence.memoryId !== memory.id) {
      errors.push(`Evidence ${evidence.id} belongs to another memory.`);
    }
    if (evidenceIds.has(evidence.id)) {
      errors.push(`Duplicate evidence id ${evidence.id}.`);
    }
    evidenceIds.add(evidence.id);
    if (!isIsoTimestamp(evidence.capturedAt)) {
      errors.push(`Evidence ${evidence.id} has an invalid capture time.`);
    }
  }

  const hasPhoto = memory.evidence.some((evidence) => evidence.type === 'PHOTO');
  if (typeof memory.note === 'string' && memory.note.trim().length === 0 && !hasPhoto) {
    errors.push('A memory needs a note or a photo.');
  }

  return errors;
}
