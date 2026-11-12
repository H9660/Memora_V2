import { distanceMeters } from '@/utils/geo';
import {
  formatEvery,
  fromMinutes,
  generateTimes,
  MAX_REMINDERS,
  normalizeTimes,
} from '@/utils/reminder-times';

const t = (hour: number, minute = 0) => ({ hour, minute });

describe('reminder times', () => {
  it('normalizes: sorts, de-duplicates and drops invalid times', () => {
    expect(normalizeTimes([t(18), t(9, 30), t(18), t(24), t(7, 60), t(0)])).toEqual([t(0), t(9, 30), t(18)]);
  });

  it('generates every hour within a window, inclusive', () => {
    const times = generateTimes(60, t(9), t(12));
    expect(times).toEqual([t(9), t(10), t(11), t(12)]);
  });

  it('supports minute-level repeats and windows past midnight', () => {
    expect(generateTimes(30, t(23), t(0, 30))).toEqual([t(0), t(0, 30), t(23), t(23, 30)]);
  });

  it('caps the number of reminders', () => {
    expect(generateTimes(1, t(0), t(23, 59))).toHaveLength(MAX_REMINDERS);
  });

  it('rejects nonsense intervals', () => {
    expect(generateTimes(0, t(9), t(10))).toEqual([]);
    expect(generateTimes(Number.NaN, t(9), t(10))).toEqual([]);
  });

  it('wraps minutes into a day and formats repeat labels', () => {
    expect(fromMinutes(1500)).toEqual(t(1));
    expect(fromMinutes(-30)).toEqual(t(23, 30));
    expect(formatEvery(30)).toBe('30 min');
    expect(formatEvery(60)).toBe('1 hour');
    expect(formatEvery(180)).toBe('3 hours');
  });
});

describe('distanceMeters', () => {
  it('is zero for the same point and roughly right for known distances', () => {
    const a = { latitude: 12.9716, longitude: 77.5946 };
    expect(distanceMeters(a, a)).toBe(0);
    // 0.001° of latitude ≈ 111 m
    expect(distanceMeters(a, { ...a, latitude: a.latitude + 0.001 })).toBeGreaterThan(105);
    expect(distanceMeters(a, { ...a, latitude: a.latitude + 0.001 })).toBeLessThan(117);
  });
});
