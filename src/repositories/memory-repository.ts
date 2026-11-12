import { MemoryEdit, MemoryEvent, MemoryEvidence } from '@/types/memory';

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
  /** Case-insensitive match on title, note, place and note/location evidence; newest first. */
  search(query: string): Promise<MemoryEvent[]>;
  count(): Promise<number>;
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
