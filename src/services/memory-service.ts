/**
 * Memory engine: the single entry point screens use to create, read, change
 * and delete memories. It combines sensor/provider output into a MemoryEvent,
 * and keeps files (photos) and database rows consistent.
 */
import { memoryRepository } from '@/repositories';
import { MemoryRepository } from '@/repositories/memory-repository';
import type { LocationData } from '@/services/location';
import {
  deleteAllPhotos,
  deletePhoto,
  PendingPhoto,
  persistPhoto,
} from '@/services/photos';
import { MemoryEdit, MemoryEvent } from '@/types/memory';
import { createMemory } from '@/utils/memory-factory';
import { validateCaptureInput } from '@/utils/validation';

export interface CaptureInput {
  /** Saved exactly as the user typed it. */
  note: string;
  /** When Memora started recording this memory (ISO 8601). */
  capturedAt: string;
  location: LocationData | null;
  photo: PendingPhoto | null;
}

export class CaptureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureValidationError';
  }
}

export function photoUrisOf(memory: MemoryEvent): string[] {
  return memory.evidence
    .filter((evidence) => evidence.type === 'PHOTO')
    .map((evidence) => evidence.data.uri)
    .filter((uri): uri is string => typeof uri === 'string');
}

export function createMemoryService(repository: MemoryRepository) {
  return {
    /** Validates, stores any photo durably, then saves memory + evidence in one transaction. */
    async capture(input: CaptureInput): Promise<MemoryEvent> {
      const problem = validateCaptureInput({ note: input.note, hasPhoto: input.photo !== null });
      if (problem) throw new CaptureValidationError(problem);

      const storedPhoto = input.photo ? await persistPhoto(input.photo) : null;

      const memory = createMemory({
        note: input.note,
        capturedAt: input.capturedAt,
        location: input.location,
        photo: storedPhoto ? { ...storedPhoto, capturedAt: input.photo!.capturedAt } : null,
      });

      try {
        await repository.create(memory);
      } catch (error) {
        // Don't leave an orphaned photo file if the database write failed.
        if (storedPhoto) deletePhoto(storedPhoto.uri);
        throw error;
      }

      return memory;
    },

    list: () => repository.getAll(),
    get: (id: string) => repository.getById(id),
    search: (query: string) => repository.search(query),
    count: () => repository.count(),

    /** Edits title/note. The USER_NOTE evidence still holds the note as first captured. */
    edit: (id: string, edit: MemoryEdit) =>
      repository.update(id, edit, new Date().toISOString()),

    async remove(id: string): Promise<void> {
      const memory = await repository.getById(id);
      await repository.delete(id);
      // Rows are gone; now clean up files. Failures here only leave an unreferenced file.
      if (memory) photoUrisOf(memory).forEach((uri) => deletePhoto(uri));
    },

    async removeAll(): Promise<void> {
      await repository.deleteAll();
      deleteAllPhotos();
    },
  };
}

export const memoryService = createMemoryService(memoryRepository);
