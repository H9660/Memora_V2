export const EVIDENCE_TYPES = ['USER_NOTE', 'LOCATION', 'PHOTO'] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export function isEvidenceType(value: unknown): value is EvidenceType {
  return typeof value === 'string' && (EVIDENCE_TYPES as readonly string[]).includes(value);
}

export interface MemoryEvidence {
  id: string;
  memoryId: string;
  type: EvidenceType;
  /** ISO 8601 time the observation was made. */
  capturedAt: string;
  data: Record<string, unknown>;
}

export interface MemoryEvent {
  id: string;
  title: string;
  /**
   * User-provided text, stored exactly as entered. Only the user may change it;
   * derived or generated content never replaces it. May be empty when the
   * memory was captured with a photo only.
   */
  note: string;
  /** When the experience happened, if known. Never guessed. */
  eventTime: string | null;
  /** When Memora recorded the memory. */
  capturedAt: string;
  /** When the user last edited the title or note; null if never edited. */
  updatedAt: string | null;
  placeName: string | null;
  latitude: number | null;
  longitude: number | null;
  evidence: MemoryEvidence[];
}

/** The note as it was when captured. Kept even if the memory's note is later edited. */
export interface UserNoteEvidenceData {
  text: string;
}

/** Where the device was at capture time. Not proof of what the user was doing. */
export interface LocationEvidenceData {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  placeName: string | null;
  source: 'expo-location';
}

/** A photo copied into app-private storage. */
export interface PhotoEvidenceData {
  uri: string;
  width: number | null;
  height: number | null;
  source: 'camera' | 'library';
}

/** Fields a user may edit after capture. */
export interface MemoryEdit {
  title: string;
  note: string;
}
