/**
 * Turns one day's records into a review: a photo film, a sequence of places and
 * a short factual summary. Everything is derived from saved data; nothing is
 * inferred about what the user did.
 */
import type { AutoCapture } from '@/repositories/auto-capture-repository';
import type { LocationObservation } from '@/repositories/location-log-repository';
import { MemoryEvent } from '@/types/memory';
import { formatTime } from '@/utils/dates';

/** How far (either side) a location-log reading may be from a photo to label it. */
const PLACE_MATCH_WINDOW_MS = 20 * 60 * 1000;
/** Most auto-camera photos shown in one film (evenly spaced through the day). */
export const MAX_AUTO_SLIDES = 60;

export interface FilmSlide {
  key: string;
  uri: string;
  capturedAt: string;
  placeName: string | null;
  source: 'memory' | 'auto';
  /** Set for photos attached to a memory. */
  memoryId: string | null;
  memoryTitle: string | null;
}

export interface PlaceStop {
  placeName: string;
  from: string;
  to: string;
}

export interface DayReview {
  slides: FilmSlide[];
  stops: PlaceStop[];
  summary: string[];
  memoryCount: number;
  autoPhotoCount: number;
}

/** "YYYY-MM-DD" for a local calendar day. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDayKey(key: string | undefined): Date | null {
  const match = key ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Evenly spaced subset of at most `max` items, always keeping the first and last. */
export function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  if (max <= 1) return items.slice(0, max);
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}

/** Local midnight-to-midnight as ISO (UTC) strings, for range queries. */
export function dayBounds(day: Date): { start: string; end: string } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function shiftDay(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

function nearestPlace(time: string, observations: LocationObservation[]): string | null {
  const t = Date.parse(time);
  let best: { gap: number; name: string } | null = null;
  for (const observation of observations) {
    if (!observation.placeName) continue;
    const gap = Math.abs(Date.parse(observation.capturedAt) - t);
    if (gap <= PLACE_MATCH_WINDOW_MS && (!best || gap < best.gap)) {
      best = { gap, name: observation.placeName };
    }
  }
  return best?.name ?? null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function buildDayReview(input: {
  /** That day's memories, any order. */
  memories: MemoryEvent[];
  /** That day's location-log readings, any order. */
  observations: LocationObservation[];
  /** That day's auto-camera photos, any order. */
  autoCaptures?: AutoCapture[];
}): DayReview {
  const memories = [...input.memories].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const observations = [...input.observations].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  const slides: FilmSlide[] = [];
  for (const memory of memories) {
    for (const evidence of memory.evidence) {
      if (evidence.type !== 'PHOTO' || typeof evidence.data.uri !== 'string') continue;
      slides.push({
        key: evidence.id,
        uri: evidence.data.uri,
        capturedAt: evidence.capturedAt,
        placeName: memory.placeName ?? nearestPlace(evidence.capturedAt, observations),
        source: 'memory',
        memoryId: memory.id,
        memoryTitle: memory.title,
      });
    }
  }

  const autoCaptures = [...(input.autoCaptures ?? [])].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  for (const capture of sampleEvenly(autoCaptures, MAX_AUTO_SLIDES)) {
    slides.push({
      key: capture.id,
      uri: capture.uri,
      capturedAt: capture.capturedAt,
      placeName: nearestPlace(capture.capturedAt, observations),
      source: 'auto',
      memoryId: null,
      memoryTitle: null,
    });
  }
  slides.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  // Places in time order from both memories and the location log; repeats in a row merge into one stop.
  const sightings = [
    ...observations
      .filter((o) => o.placeName)
      .map((o) => ({ at: o.capturedAt, place: o.placeName as string })),
    ...memories.filter((m) => m.placeName).map((m) => ({ at: m.capturedAt, place: m.placeName as string })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const stops: PlaceStop[] = [];
  for (const sighting of sightings) {
    const last = stops[stops.length - 1];
    if (last && last.placeName === sighting.place) last.to = sighting.at;
    else stops.push({ placeName: sighting.place, from: sighting.at, to: sighting.at });
  }

  const summary: string[] = [];
  if (memories.length === 0 && stops.length === 0 && autoCaptures.length === 0) {
    summary.push('Nothing was recorded on this day.');
  } else {
    if (memories.length > 0) {
      const first = memories[0].capturedAt;
      const last = memories[memories.length - 1].capturedAt;
      const span =
        memories.length === 1 ? `at ${formatTime(first)}` : `between ${formatTime(first)} and ${formatTime(last)}`;
      const photoPart = slides.length > 0 ? ` and ${plural(slides.length, 'photo', 'photos')}` : '';
      summary.push(`You saved ${plural(memories.length, 'memory', 'memories')}${photoPart} ${span}.`);
    } else {
      summary.push('No memories were saved on this day.');
    }

    if (autoCaptures.length > 0) {
      const shown = Math.min(autoCaptures.length, MAX_AUTO_SLIDES);
      summary.push(
        `The auto camera took ${plural(autoCaptures.length, 'photo', 'photos')}` +
          (shown < autoCaptures.length ? ` (the film shows ${shown}).` : '.'),
      );
    }

    if (stops.length > 0) {
      const names = stops.map((stop) => stop.placeName);
      const shown = names.length > 6 ? [...names.slice(0, 6), `${names.length - 6} more`] : names;
      summary.push(`Your phone was at ${plural(stops.length, 'place', 'places')}: ${shown.join(' → ')}.`);
    }

    if (memories.length > 0) {
      const titles = memories.slice(0, 4).map((m) => `“${m.title}”`);
      const more = memories.length > 4 ? ` and ${memories.length - 4} more` : '';
      summary.push(`Memories: ${titles.join(', ')}${more}.`);
    }
  }

  return { slides, stops, summary, memoryCount: memories.length, autoPhotoCount: autoCaptures.length };
}
