import { describe, it, expect } from 'vitest';
import { calculateScheduleDates } from '@/lib/scheduling';

// Use a month far in the future so every weekday is "future" relative to now
const farFuture = new Date();
farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 1);
const targetMonth = farFuture.getUTCMonth();
const targetYear = farFuture.getUTCFullYear();

describe('calculateScheduleDates', () => {
  it('returns empty array for zero or negative post count', () => {
    expect(calculateScheduleDates(0, targetMonth, targetYear)).toEqual([]);
    expect(calculateScheduleDates(-3, targetMonth, targetYear)).toEqual([]);
  });

  it('schedules every post at 17:00 UTC (US business hours)', () => {
    const dates = calculateScheduleDates(4, targetMonth, targetYear);
    expect(dates.length).toBe(4);
    for (const date of dates) {
      expect(date.getUTCHours()).toBe(17);
      expect(date.getUTCMinutes()).toBe(0);
    }
  });

  it('only schedules on weekdays in the target month', () => {
    const dates = calculateScheduleDates(8, targetMonth, targetYear);
    for (const date of dates) {
      expect(date.getUTCMonth()).toBe(targetMonth);
      expect(date.getUTCFullYear()).toBe(targetYear);
      const day = date.getUTCDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
    }
  });

  it('never schedules two posts on the same day', () => {
    const dates = calculateScheduleDates(20, targetMonth, targetYear);
    const dayStrings = dates.map((d) => d.toISOString().slice(0, 10));
    expect(new Set(dayStrings).size).toBe(dayStrings.length);
  });

  it('excludes dates listed in takenDates', () => {
    const all = calculateScheduleDates(31, targetMonth, targetYear);
    const taken = new Set(all.slice(0, 3).map((d) => d.toISOString().slice(0, 10)));
    const dates = calculateScheduleDates(31, targetMonth, targetYear, taken);
    for (const date of dates) {
      expect(taken.has(date.toISOString().slice(0, 10))).toBe(false);
    }
  });

  it('caps the number of dates at available weekdays', () => {
    const dates = calculateScheduleDates(100, targetMonth, targetYear);
    // A month has at most 23 weekdays
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThanOrEqual(23);
  });
});
