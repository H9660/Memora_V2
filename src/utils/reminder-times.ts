export interface ReminderTime {
  hour: number;
  minute: number;
}

/** Android throttles apps with very many alarms; this keeps reminders reliable. */
export const MAX_REMINDERS = 48;

/** Repeat choices for the "every …" helper, in minutes. */
export const REPEAT_OPTIONS_MINUTES = [30, 60, 120, 180, 240, 360, 720] as const;

export function toMinutes({ hour, minute }: ReminderTime): number {
  return hour * 60 + minute;
}

export function fromMinutes(total: number): ReminderTime {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  return { hour: Math.floor(wrapped / 60), minute: wrapped % 60 };
}

export function sameTime(a: ReminderTime, b: ReminderTime): boolean {
  return toMinutes(a) === toMinutes(b);
}

function isValidTime(time: ReminderTime): boolean {
  return (
    Number.isInteger(time.hour) &&
    Number.isInteger(time.minute) &&
    time.hour >= 0 &&
    time.hour < 24 &&
    time.minute >= 0 &&
    time.minute < 60
  );
}

/** Drops invalid and duplicate times and sorts them through the day. */
export function normalizeTimes(times: ReminderTime[]): ReminderTime[] {
  const unique = new Map<number, ReminderTime>();
  for (const time of times) {
    if (isValidTime(time)) unique.set(toMinutes(time), { hour: time.hour, minute: time.minute });
  }
  return [...unique.entries()].sort(([a], [b]) => a - b).map(([, time]) => time);
}

/**
 * Times from `start` to `end` (inclusive) every `everyMinutes`. If `end` is
 * earlier than `start` the window runs past midnight. Capped at MAX_REMINDERS.
 */
export function generateTimes(everyMinutes: number, start: ReminderTime, end: ReminderTime): ReminderTime[] {
  if (!Number.isFinite(everyMinutes) || everyMinutes < 1) return [];

  const startMinutes = toMinutes(start);
  let endMinutes = toMinutes(end);
  if (endMinutes < startMinutes) endMinutes += 1440;

  const times: ReminderTime[] = [];
  for (let t = startMinutes; t <= endMinutes && times.length < MAX_REMINDERS; t += everyMinutes) {
    times.push(fromMinutes(t));
  }
  return normalizeTimes(times);
}

export function formatReminderTime({ hour, minute }: ReminderTime): string {
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatEvery(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}
