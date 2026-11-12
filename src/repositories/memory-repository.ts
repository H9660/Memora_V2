import { MemoryEdit, MemoryEvent, MemoryEvidence } from '@/types/memory';

/** Half-open time window [start, end) as ISO 8601 strings. */
export interface TimeRange {
  start: string;
  end: string;
}

/** Persistence contract for memories. The SQLite implementation is the only one in production. */
export interface MemoryRepository {
  /** Inserts a new memory and its evidence atomically. Fails if the id already exists. */
  create(memory: MemoryEvent): Promise<void>;
  /** Changes the user-editable fields and records the edit time. Returns the updated memory, or null if it no longer exists. */
  update(id: string, edit: MemoryEdit, updatedAt: string): Promise<MemoryEvent | null>;
  getById(id: string): Promise<MemoryEvent | null>;
  /** Newest captured first. */
  getAll(): Promise<MemoryEvent[]>;
  /** Memories captured in [startIso, endIso), oldest first. */
  getBetween(startIso: string, endIso: string): Promise<MemoryEvent[]>;
  /** Evidence for one memory, oldest observation first. */
  getEvidence(memoryId: string): Promise<MemoryEvidence[]>;
  /**
   * Case-insensitive match on title, note, place and note/location evidence; newest first.
   * With a range, only memories captured in it. An empty query with a range lists the whole range.
   */
  search(query: string, range?: TimeRange): Promise<MemoryEvent[]>;
  count(): Promise<number>;
  /** Removes one piece of evidence (e.g. a photo) from its memory. */
  deleteEvidence(evidenceId: string): Promise<void>;
  /** Removes the memory and (via cascade) its evidence. */
  delete(id: string): Promise<void>;
  deleteAll(): Promise<void>;
}

export class MemoryRepositoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MemoryRepositoryError';
  }
}
