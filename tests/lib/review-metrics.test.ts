import { describe, it, expect } from 'vitest';
import {
  computeTrend,
  computeRatingDistribution,
  computeMonthlyData,
  computeDaysSince,
  getRecencyStatus,
  formatDataThrough,
} from '@/lib/review-metrics';

// Helpers
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

describe('computeTrend', () => {
  it('returns correct pct change when prior > 0', () => {
    const reviews = [
      // 5 reviews in last 30 days
      { reviewDate: daysAgo(5) },
      { reviewDate: daysAgo(10) },
      { reviewDate: daysAgo(15) },
      { reviewDate: daysAgo(20) },
      { reviewDate: daysAgo(25) },
      // 3 reviews in prior 30 days (31-60 days ago)
      { reviewDate: daysAgo(35) },
      { reviewDate: daysAgo(45) },
      { reviewDate: daysAgo(55) },
    ];
    const result = computeTrend(reviews, now);
    expect(result.current).toBe(5);
    expect(result.prior).toBe(3);
    expect(result.pct).toBe(67); // Math.round(((5-3)/3)*100) = 67
  });

  it('returns pct=null when prior is 0', () => {
    const reviews = [
      { reviewDate: daysAgo(5) },
      { reviewDate: daysAgo(10) },
    ];
    const result = computeTrend(reviews, now);
    expect(result.current).toBe(2);
    expect(result.prior).toBe(0);
    expect(result.pct).toBeNull();
  });

  it('returns current=0, prior=0, pct=null for empty array', () => {
    const result = computeTrend([], now);
    expect(result.current).toBe(0);
    expect(result.prior).toBe(0);
    expect(result.pct).toBeNull();
  });

  it('counts only reviews in the correct windows', () => {
    const reviews = [
      { reviewDate: daysAgo(1) },  // in last 30
      { reviewDate: daysAgo(31) }, // in prior 30
      { reviewDate: daysAgo(65) }, // outside both windows
    ];
    const result = computeTrend(reviews, now);
    expect(result.current).toBe(1);
    expect(result.prior).toBe(1);
    expect(result.pct).toBe(0);
  });
});

describe('computeRatingDistribution', () => {
  it('returns correct counts for mixed ratings', () => {
    const reviews = [
      { rating: 5 },
      { rating: 5 },
      { rating: 5 },
      { rating: 1 },
      { rating: 1 },
    ];
    const result = computeRatingDistribution(reviews);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ star: 5, count: 3 });
    expect(result[1]).toEqual({ star: 4, count: 0 });
    expect(result[2]).toEqual({ star: 3, count: 0 });
    expect(result[3]).toEqual({ star: 2, count: 0 });
    expect(result[4]).toEqual({ star: 1, count: 2 });
  });

  it('returns all zeros for empty array', () => {
    const result = computeRatingDistribution([]);
    expect(result).toHaveLength(5);
    for (const point of result) {
      expect(point.count).toBe(0);
    }
    expect(result.map(p => p.star)).toEqual([5, 4, 3, 2, 1]);
  });

  it('returns array ordered from 5 to 1 (top-to-bottom for chart)', () => {
    const result = computeRatingDistribution([{ rating: 3 }]);
    expect(result[0].star).toBe(5);
    expect(result[4].star).toBe(1);
  });
});

describe('computeMonthlyData', () => {
  it('returns 12 buckets', () => {
    const result = computeMonthlyData([], now);
    expect(result).toHaveLength(12);
  });

  it('buckets reviews correctly by UTC month', () => {
    // Create a review we know is in a specific UTC month
    const specificDate = new Date('2026-01-15T00:00:00Z');
    const fixedNow = new Date('2026-04-01T00:00:00Z');
    const reviews = [
      { reviewDate: specificDate, rating: 4 },
      { reviewDate: specificDate, rating: 5 },
    ];
    const result = computeMonthlyData(reviews, fixedNow);
    const janBucket = result.find(r => r.sortKey === '2026-01');
    expect(janBucket).toBeDefined();
    expect(janBucket!.volume).toBe(2);
    expect(janBucket!.avgRating).toBe(4.5);
  });

  it('empty months have volume=0 and avgRating=null (chart skips gap)', () => {
    const result = computeMonthlyData([], now);
    for (const bucket of result) {
      expect(bucket.volume).toBe(0);
      expect(bucket.avgRating).toBeNull();
    }
  });

  it('rounds avgRating to 1 decimal', () => {
    const fixedNow = new Date('2026-04-01T00:00:00Z');
    const reviews = [
      { reviewDate: new Date('2026-03-10T00:00:00Z'), rating: 4 },
      { reviewDate: new Date('2026-03-15T00:00:00Z'), rating: 5 },
      { reviewDate: new Date('2026-03-20T00:00:00Z'), rating: 3 },
    ];
    const result = computeMonthlyData(reviews, fixedNow);
    const marBucket = result.find(r => r.sortKey === '2026-03');
    expect(marBucket).toBeDefined();
    expect(marBucket!.avgRating).toBe(4.0); // (4+5+3)/3 = 4.0
  });

  it('uses UTC-based grouping (getUTCMonth) for date bucketing', () => {
    const fixedNow = new Date('2026-04-01T00:00:00Z');
    // Review at 2026-02-28T23:59:00Z is in Feb UTC
    const review = { reviewDate: new Date('2026-02-28T23:59:00Z'), rating: 5 };
    const result = computeMonthlyData([review], fixedNow);
    const febBucket = result.find(r => r.sortKey === '2026-02');
    expect(febBucket).toBeDefined();
    expect(febBucket!.volume).toBe(1);
  });

  it('month label is formatted as "Jan 2026" style', () => {
    const fixedNow = new Date('2026-04-01T00:00:00Z');
    const result = computeMonthlyData([], fixedNow);
    // First bucket should be 12 months back from Apr 2026 = Apr 2025
    const firstBucket = result[0];
    expect(firstBucket.month).toMatch(/^\w{3} \d{4}$/);
  });
});

describe('computeDaysSince', () => {
  it('returns correct day count for a date 5 days ago', () => {
    const date = daysAgo(5);
    const result = computeDaysSince(date, now);
    expect(result).toBe(5);
  });

  it('returns null when date is null', () => {
    const result = computeDaysSince(null, now);
    expect(result).toBeNull();
  });

  it('returns 0 for today', () => {
    const result = computeDaysSince(now, now);
    expect(result).toBe(0);
  });

  it('returns 14 for exactly 14 days ago', () => {
    const result = computeDaysSince(daysAgo(14), now);
    expect(result).toBe(14);
  });
});

describe('getRecencyStatus', () => {
  it('returns good/green/"Profile is active" for 0 days', () => {
    const result = getRecencyStatus(0);
    expect(result.status).toBe('good');
    expect(result.color).toBe('green');
    expect(result.message).toBe('Profile is active');
  });

  it('returns good/green for exactly 14 days', () => {
    const result = getRecencyStatus(14);
    expect(result.status).toBe('good');
    expect(result.color).toBe('green');
  });

  it('returns warning/amber/"Consider requesting reviews" for 15 days', () => {
    const result = getRecencyStatus(15);
    expect(result.status).toBe('warning');
    expect(result.color).toBe('amber');
    expect(result.message).toBe('Consider requesting reviews');
  });

  it('returns warning/amber for exactly 30 days', () => {
    const result = getRecencyStatus(30);
    expect(result.status).toBe('warning');
    expect(result.color).toBe('amber');
  });

  it('returns critical/red/"No reviews in over a month" for 31 days', () => {
    const result = getRecencyStatus(31);
    expect(result.status).toBe('critical');
    expect(result.color).toBe('red');
    expect(result.message).toBe('No reviews in over a month');
  });

  it('returns critical/red/"No reviews yet" for null', () => {
    const result = getRecencyStatus(null);
    expect(result.status).toBe('critical');
    expect(result.color).toBe('red');
    expect(result.message).toBe('No reviews yet');
  });
});

describe('formatDataThrough', () => {
  it('formats date as "Data through Mar 31, 2026"', () => {
    const date = new Date('2026-03-31T00:00:00Z');
    const result = formatDataThrough(date);
    expect(result).toBe('Data through Mar 31, 2026');
  });

  it('formats a different date correctly', () => {
    const date = new Date('2026-01-15T00:00:00Z');
    const result = formatDataThrough(date);
    expect(result).toBe('Data through Jan 15, 2026');
  });
});
