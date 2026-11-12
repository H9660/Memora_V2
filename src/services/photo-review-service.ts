import { autoCaptureRepository } from '@/repositories/auto-capture-repository';
import type { TimeRange } from '@/repositories/memory-repository';
import { memoryRepository } from '@/repositories/sqlite-memory-repository';
import { collectPhotos, memoriesEmptiedBy, ReviewPhoto } from '@/review/photo-review';
import { deleteAutoCaptures, syncAutoCaptures } from '@/services/auto-camera';
import { memoryService } from '@/services/memory-service';
import { photoExists } from '@/services/photos';
import { MemoryEvent } from '@/types/memory';

/** Memory photos may be a few minutes older than their memory's save time; look a little wider. */
const MEMORY_LOOKAROUND_MS = 6 * 60 * 60 * 1000;

export interface LoadedPhotos {
  photos: ReviewPhoto[];
  /** The memories those photos belong to, for deletion warnings. */
  memories: MemoryEvent[];
}

export async function loadPhotos(range: TimeRange): Promise<LoadedPhotos> {
  await syncAutoCaptures().catch(() => undefined);
  const wideStart = new Date(Date.parse(range.start) - MEMORY_LOOKAROUND_MS).toISOString();
  const wideEnd = new Date(Date.parse(range.end) + MEMORY_LOOKAROUND_MS).toISOString();
  const [memories, autoCaptures] = await Promise.all([
    memoryRepository.getBetween(wideStart, wideEnd),
    autoCaptureRepository.listBetween(range.start, range.end),
  ]);
  const photos = collectPhotos({ memories, autoCaptures, range }).filter((photo) => photoExists(photo.uri));
  const owners = new Set(photos.flatMap((photo) => (photo.kind === 'memory' ? [photo.memoryId] : [])));
  return { photos, memories: memories.filter((memory) => owners.has(memory.id)) };
}

export { memoriesEmptiedBy };

export interface DeleteResult {
  photosDeleted: number;
  memoriesDeleted: number;
  failed: number;
}

/** Deletes the chosen photos. Auto-camera photos go in one batch; memory photos one at a time. */
export async function deletePhotos(selected: ReviewPhoto[]): Promise<DeleteResult> {
  const result: DeleteResult = { photosDeleted: 0, memoriesDeleted: 0, failed: 0 };

  const auto = selected.flatMap((photo) => (photo.kind === 'auto' ? [{ id: photo.captureId, uri: photo.uri }] : []));
  if (auto.length > 0) {
    try {
      await deleteAutoCaptures(auto);
      result.photosDeleted += auto.length;
    } catch {
      result.failed += auto.length;
    }
  }

  for (const photo of selected) {
    if (photo.kind !== 'memory') continue;
    try {
      const outcome = await memoryService.removePhoto(photo.memoryId, photo.evidenceId);
      if (outcome === 'photo-removed') result.photosDeleted++;
      // Also counts photos whose memory was already removed earlier in this batch.
      else {
        result.photosDeleted++;
        if (outcome === 'memory-removed') result.memoriesDeleted++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}
