import { autoCaptureRepository } from '@/repositories/auto-capture-repository';
import { dayNoteRepository, DayNote } from '@/repositories/day-note-repository';
import { locationLogRepository } from '@/repositories/location-log-repository';
import { memoryRepository } from '@/repositories/sqlite-memory-repository';
import { buildDayReview, dayBounds, DayReview, dayKey, shiftDay } from '@/review/day-review';
import { syncAutoCaptures } from '@/services/auto-camera';
import { photoExists } from '@/services/photos';
import { MemoryEvent } from '@/types/memory';

export interface OnThisDayGroup {
  label: string;
  day: string;
  memories: MemoryEvent[];
}

export interface LoadedDayReview extends DayReview {
  day: string;
  memories: MemoryEvent[];
  note: DayNote | null;
  onThisDay: OnThisDayGroup[];
}

async function memoriesOn(day: Date): Promise<MemoryEvent[]> {
  const { start, end } = dayBounds(day);
  return memoryRepository.getBetween(start, end);
}

export async function loadDayReview(day: Date): Promise<LoadedDayReview> {
  const { start, end } = dayBounds(day);
  // Pick up photos the auto camera wrote since last time; never block the review on it.
  await syncAutoCaptures().catch(() => undefined);
  const [memories, observations, note, autoCaptures] = await Promise.all([
    memoryRepository.getBetween(start, end),
    locationLogRepository.listBetween(start, end),
    dayNoteRepository.get(dayKey(day)),
    autoCaptureRepository.listBetween(start, end),
  ]);

  const review = buildDayReview({ memories, observations, autoCaptures });
  // Skip photos whose files are gone so the film doesn't stall on blank frames.
  const slides = review.slides.filter((slide) => photoExists(slide.uri));

  const lookbacks: { label: string; date: Date }[] = [
    { label: '1 week ago', date: shiftDay(day, -7) },
    { label: '1 month ago', date: new Date(day.getFullYear(), day.getMonth() - 1, day.getDate()) },
    { label: '1 year ago', date: new Date(day.getFullYear() - 1, day.getMonth(), day.getDate()) },
  ];
  const onThisDay = (
    await Promise.all(
      lookbacks.map(async ({ label, date }) => ({ label, day: dayKey(date), memories: await memoriesOn(date) })),
    )
  ).filter((group) => group.memories.length > 0);

  return { ...review, slides, day: dayKey(day), memories, note, onThisDay };
}

export function saveDayNote(day: string, note: string): Promise<void> {
  return dayNoteRepository.set(day, note);
}
