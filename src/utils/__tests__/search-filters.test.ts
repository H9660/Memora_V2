import { formatCustomRange, isInDayPart, resolveDateRange } from '@/utils/search-filters';

// Local time, so these hold in any timezone.
const now = new Date(2026, 10, 12, 15, 30);
const local = (d: number, h = 0) => new Date(2026, 10, d, h).toISOString();

describe('resolveDateRange', () => {
  it('has no window for any time', () => {
    expect(resolveDateRange('any', now)).toBeNull();
  });

  it('covers whole local days', () => {
    expect(resolveDateRange('today', now)).toEqual({ start: local(12), end: local(13) });
    expect(resolveDateRange('yesterday', now)).toEqual({ start: local(11), end: local(12) });
    expect(resolveDateRange('week', now)).toEqual({ start: local(6), end: local(13) });
    expect(resolveDateRange('month', now)).toEqual({ start: new Date(2026, 9, 14).toISOString(), end: local(13) });
  });

  it('includes both ends of a custom range, in either order', () => {
    const range = { start: local(3), end: local(6) };
    expect(resolveDateRange('custom', now, { from: new Date(2026, 10, 3, 18), to: new Date(2026, 10, 5, 9) })).toEqual(
      range,
    );
    expect(resolveDateRange('custom', now, { from: new Date(2026, 10, 5), to: new Date(2026, 10, 3) })).toEqual(range);
    expect(resolveDateRange('custom', now)).toBeNull();
  });
});

describe('isInDayPart', () => {
  it('matches local hours, with night wrapping past midnight', () => {
    expect(isInDayPart(local(12, 8), 'morning')).toBe(true);
    expect(isInDayPart(local(12, 12), 'morning')).toBe(false);
    expect(isInDayPart(local(12, 12), 'afternoon')).toBe(true);
    expect(isInDayPart(local(12, 19), 'evening')).toBe(true);
    expect(isInDayPart(local(12, 23), 'night')).toBe(true);
    expect(isInDayPart(local(12, 2), 'night')).toBe(true);
    expect(isInDayPart(local(12, 6), 'night')).toBe(false);
    expect(isInDayPart(local(12, 6), 'any')).toBe(true);
  });
});

describe('formatCustomRange', () => {
  it('shows one date for a single day and a span otherwise', () => {
    const day = new Date(2026, 10, 3);
    expect(formatCustomRange(day, day)).not.toContain('–');
    expect(formatCustomRange(day, new Date(2026, 10, 5))).toContain('–');
  });
});
