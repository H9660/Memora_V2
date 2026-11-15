/** Time filters for memory search: a date window and an optional part of the day. */
import type { TimeRange } from '@/repositories/memory-repository';

export type DatePreset = 'any' | 'today' | 'yesterday' | 'week' | 'month' | 'custom';
export type DayPart = 'any' | 'morning' | 'afternoon' | 'evening' | 'night';

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'custom', label: 'Pick dates…' },
];

/** Local-time hour spans; night wraps past midnight. */
export const DAY_PARTS: { value: DayPart; label: string; from: number; to: number }[] = [
  { value: 'any', label: 'All day', from: 0, to: 24 },
  { value: 'morning', label: 'Morning', from: 5, to: 12 },
  { value: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { value: 'evening', label: 'Evening', from: 17, to: 21 },
  { value: 'night', label: 'Night', from: 21, to: 5 },
];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The window for a preset, or null for "any time". `custom` covers whole local
 * days from `from` to `to` inclusive (swapped if given backwards).
 */
export function resolveDateRange(
  preset: DatePreset,
  now = new Date(),
  custom?: { from: Date; to: Date },
): TimeRange | null {
  const today = startOfDay(now);
  let start: Date;
  let end: Date;
  switch (preset) {
    case 'any':
      return null;
    case 'today':
      [start, end] = [today, addDays(today, 1)];
      break;
    case 'yesterday':
      [start, end] = [addDays(today, -1), today];
      break;
    case 'week':
      [start, end] = [addDays(today, -6), addDays(today, 1)];
      break;
    case 'month':
      [start, end] = [addDays(today, -29), addDays(today, 1)];
      break;
    case 'custom': {
      if (!custom) return null;
      const [a, b] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
      [start, end] = [startOfDay(a), addDays(startOfDay(b), 1)];
      break;
    }
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Whether a time falls in the given part of the (local) day. */
export function isInDayPart(iso: string, part: DayPart): boolean {
  if (part === 'any') return true;
  const span = DAY_PARTS.find((p) => p.value === part);
  if (!span) return true;
  const hour = new Date(iso).getHours();
  return span.from < span.to ? hour >= span.from && hour < span.to : hour >= span.from || hour < span.to;
}

export function formatCustomRange(from: Date, to: Date): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return a.toDateString() === b.toDateString() ? fmt(a) : `${fmt(a)} – ${fmt(b)}`;
}
