function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", or a full date such as "Monday, 2 November 2026". */
export function getDayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Groups items (assumed newest first) into day sections, preserving order. */
export function groupByDay<T>(
  items: T[],
  getIso: (item: T) => string,
  now = new Date(),
): { title: string; data: T[] }[] {
  const sections: { title: string; data: T[] }[] = [];

  for (const item of items) {
    const title = getDayLabel(getIso(item), now);
    const last = sections[sections.length - 1];

    if (last && last.title === title) {
      last.data.push(item);
    } else {
      sections.push({ title, data: [item] });
    }
  }

  return sections;
}
