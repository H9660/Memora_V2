import {
  LocationEvidenceData,
  MemoryEvent,
  MemoryEvidence,
  PhotoEvidenceData,
  UserNoteEvidenceData,
} from '@/types/memory';
import { generateId } from '@/utils/ids';

const MAX_DERIVED_TITLE_LENGTH = 60;
export const UNTITLED_MEMORY = 'Untitled memory';
export const PHOTO_MEMORY_TITLE = 'Photo memory';

export interface CreateMemoryInput {
  /** Stored exactly as given. */
  note: string;
  capturedAt: string;
  eventTime?: string | null;
  location?: (Omit<LocationEvidenceData, 'source'> & { capturedAt: string }) | null;
  photo?: (Omit<PhotoEvidenceData, 'uri'> & { uri: string; capturedAt: string }) | null;
}

/** Deterministic title: the first line of the note, shortened. */
export function deriveTitle(note: string, hasPhoto = false): string {
  const firstLine = note.trim().split('\n')[0].trim();

  if (firstLine.length === 0) {
    return hasPhoto ? PHOTO_MEMORY_TITLE : UNTITLED_MEMORY;
  }

  if (firstLine.length <= MAX_DERIVED_TITLE_LENGTH) {
    return firstLine;
  }

  return `${firstLine.slice(0, MAX_DERIVED_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function createMemory({
  note,
  capturedAt,
  eventTime = null,
  location = null,
  photo = null,
}: CreateMemoryInput): MemoryEvent {
  const id = generateId();
  const evidence: MemoryEvidence[] = [];

  if (note.trim().length > 0) {
    const noteData: UserNoteEvidenceData = { text: note };
    evidence.push({
      id: generateId(),
      memoryId: id,
      type: 'USER_NOTE',
      capturedAt,
      data: { ...noteData },
    });
  }

  if (location) {
    const { capturedAt: locationCapturedAt, ...rest } = location;
    const locationData: LocationEvidenceData = { ...rest, source: 'expo-location' };

    evidence.push({
      id: generateId(),
      memoryId: id,
      type: 'LOCATION',
      capturedAt: locationCapturedAt,
      data: { ...locationData },
    });
  }

  if (photo) {
    const { capturedAt: photoCapturedAt, ...photoData } = photo;

    evidence.push({
      id: generateId(),
      memoryId: id,
      type: 'PHOTO',
      capturedAt: photoCapturedAt,
      data: { ...photoData },
    });
  }

  return {
    id,
    title: deriveTitle(note, photo !== null),
    note,
    eventTime,
    capturedAt,
    updatedAt: null,
    placeName: location?.placeName ?? null,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    evidence,
  };
}
