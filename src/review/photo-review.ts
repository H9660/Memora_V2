/**
 * Gathers every photo Memora holds for a time window (memory photos and
 * auto-camera photos) so the user can look through them and delete any.
 */
import type { AutoCapture } from '@/repositories/auto-capture-repository';
import type { TimeRange } from '@/repositories/memory-repository';
import { MemoryEvent } from '@/types/memory';

export type ReviewPhoto =
  | {
      kind: 'memory';
      key: string;
      uri: string;
      capturedAt: string;
      memoryId: string;
      evidenceId: string;
      memoryTitle: string;
      placeName: string | null;
    }
  | {
      kind: 'auto';
      key: string;
      uri: string;
      capturedAt: string;
      captureId: string;
    };

export const RECENT_HOURS_OPTIONS = [1, 3, 6, 12] as const;
export const DEFAULT_RECENT_HOURS = 3;

/** The last `hours` hours up to (and slightly past) now. */
export function recentRange(hours: number, now = new Date()): TimeRange {
  // A minute of slack so a photo taken while the screen loads still counts.
  return {
    start: new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString(),
    end: new Date(now.getTime() + 60 * 1000).toISOString(),
  };
}

function inRange(iso: string, range: TimeRange): boolean {
  return iso >= range.start && iso < range.end;
}

/** Newest first. Memory photos are matched on the photo's own time, not the memory's. */
export function collectPhotos(input: {
  memories: MemoryEvent[];
  autoCaptures: AutoCapture[];
  range: TimeRange;
}): ReviewPhoto[] {
  const photos: ReviewPhoto[] = [];

  for (const memory of input.memories) {
    for (const evidence of memory.evidence) {
      if (evidence.type !== 'PHOTO' || typeof evidence.data.uri !== 'string') continue;
      if (!inRange(evidence.capturedAt, input.range)) continue;
      photos.push({
        kind: 'memory',
        key: `memory:${evidence.id}`,
        uri: evidence.data.uri,
        capturedAt: evidence.capturedAt,
        memoryId: memory.id,
        evidenceId: evidence.id,
        memoryTitle: memory.title,
        placeName: memory.placeName,
      });
    }
  }

  for (const capture of input.autoCaptures) {
    if (!inRange(capture.capturedAt, input.range)) continue;
    photos.push({
      kind: 'auto',
      key: `auto:${capture.id}`,
      uri: capture.uri,
      capturedAt: capture.capturedAt,
      captureId: capture.id,
    });
  }

  return photos.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.key.localeCompare(b.key));
}

/**
 * Which memories lose their only content if these photos go: no note text and
 * every photo selected. Those memories are deleted whole; the user is told first.
 */
export function memoriesEmptiedBy(selected: ReviewPhoto[], memories: MemoryEvent[]): MemoryEvent[] {
  const chosen = new Set(selected.filter((p) => p.kind === 'memory').map((p) => p.evidenceId));
  return memories.filter((memory) => {
    const photos = memory.evidence.filter((e) => e.type === 'PHOTO');
    return (
      photos.length > 0 &&
      photos.some((photo) => chosen.has(photo.id)) &&
      photos.every((photo) => chosen.has(photo.id)) &&
      memory.note.trim().length === 0
    );
  });
}
