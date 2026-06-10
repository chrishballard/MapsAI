import { describe, it, expect } from 'vitest';
import { calculateScheduleDates, calculateRollingScheduleDates } from '@/lib/scheduling';

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

describe('calculateRollingScheduleDates', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY_MS;

  it('returns empty array for zero or negative post count', () => {
    expect(calculateRollingScheduleDates(0)).toEqual([]);
    expect(calculateRollingScheduleDates(-2)).toEqual([]);
  });

  it('always returns exactly postCount dates, all in the future at 17:00 UTC', () => {
    for (const count of [1, 4, 8, 12, 30]) {
      const dates = calculateRollingScheduleDates(count);
      expect(dates.length).toBe(count);
      const now = new Date();
      for (const d of dates) {
        expect(d.getTime()).toBeGreaterThan(now.getTime());
        expect(d.getUTCHours()).toBe(17);
      }
    }
  });

  it('spaces weekly (4/month) posts ~7-8 days apart, never on consecutive days', () => {
    const dates = calculateRollingScheduleDates(4);
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      expect(gap).toBeGreaterThanOrEqual(5);
      expect(gap).toBeLessThanOrEqual(10);
    }
  });

  it('spaces 3x-per-week (12/month) posts ~2-3 days apart — never daily', () => {
    const dates = calculateRollingScheduleDates(12);
    const span = daysBetween(dates[0], dates[dates.length - 1]);
    // 12 posts must cover roughly a month, not be crammed into two weeks
    expect(span).toBeGreaterThanOrEqual(22);
  });

  it('avoids weekends at normal cadences', () => {
    for (const count of [4, 8, 12]) {
      const dates = calculateRollingScheduleDates(count);
      for (const d of dates) {
        const day = d.getUTCDay();
        expect(day).toBeGreaterThanOrEqual(1);
        expect(day).toBeLessThanOrEqual(5);
      }
    }
  });

  it('never schedules two posts on the same day and skips takenDates', () => {
    const taken = new Set<string>();
    const first = calculateRollingScheduleDates(8);
    for (const d of first) taken.add(d.toISOString().slice(0, 10));
    const second = calculateRollingScheduleDates(8, null, taken);
    const all = [...first, ...second].map((d) => d.toISOString().slice(0, 10));
    expect(new Set(all).size).toBe(all.length);
  });

  it('continues cadence one interval after a recent anchor', () => {
    const anchor = new Date(Date.now() + 1 * DAY_MS); // last post tomorrow
    const dates = calculateRollingScheduleDates(4, anchor);
    const gap = daysBetween(anchor, dates[0]);
    expect(gap).toBeGreaterThanOrEqual(5); // ~7.5d interval, weekday-snapped
    expect(gap).toBeLessThanOrEqual(10);
  });

  it('starts promptly (about tomorrow) for a stale or missing anchor', () => {
    const stale = new Date(Date.now() - 90 * DAY_MS);
    for (const anchor of [stale, null]) {
      const dates = calculateRollingScheduleDates(4, anchor);
      const gap = daysBetween(new Date(), dates[0]);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(4); // tomorrow, weekday/taken-snapped
    }
  });
});
