import { describe, it, expect } from 'vitest';
import {
  computeDateRange,
  computePriorPeriod,
  aggregateDailyMetrics,
  computePctChange,
  computeSparklineData,
  buildActionsLog,
} from '@/lib/report-metrics';

// Helpers
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe('computeDateRange', () => {
  it('defaults to last 30 days when no params provided', () => {
    const { from, to } = computeDateRange(undefined, undefined);
    const today = toYMD(new Date());
    const thirtyDaysAgo = toYMD(new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000));
    expect(to).toBe(today);
    expect(from).toBe(thirtyDaysAgo);
  });

  it('returns explicit from/to when provided', () => {
    const { from, to } = computeDateRange('2026-03-01', '2026-03-31');
    expect(from).toBe('2026-03-01');
    expect(to).toBe('2026-03-31');
  });

  it('returns from and to as YYYY-MM-DD strings', () => {
    const { from, to } = computeDateRange(undefined, undefined);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('defaults when only from is undefined', () => {
    const { from, to } = computeDateRange(undefined, '2026-03-31');
    const today = toYMD(new Date());
    const thirtyDaysAgo = toYMD(new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000));
    expect(to).toBe(today);
    expect(from).toBe(thirtyDaysAgo);
  });
});

describe('computePriorPeriod', () => {
  it('returns preceding equal-length period for a 30-day range', () => {
    const from = new Date('2026-03-01T00:00:00Z');
    const to = new Date('2026-03-31T00:00:00Z');
    const { priorFrom, priorTo } = computePriorPeriod(from, to);
    // priorTo = from - 1 day = 2026-02-28
    expect(toYMD(priorTo)).toBe('2026-02-28');
    // length = 30 days (Mar 1 to Mar 31 = 30 days in ms)
    // priorFrom = priorTo - length = 2026-02-28 - 30 days = 2026-01-29
    const expectedPriorFrom = new Date(priorTo.getTime() - (to.getTime() - from.getTime()));
    expect(priorFrom.getTime()).toBe(expectedPriorFrom.getTime());
  });

  it('priorTo is one day before from', () => {
    const from = new Date('2026-03-01T00:00:00Z');
    const to = new Date('2026-03-31T00:00:00Z');
    const { priorTo } = computePriorPeriod(from, to);
    const expected = new Date(from.getTime() - 86400000);
    expect(priorTo.getTime()).toBe(expected.getTime());
  });

  it('returns Date objects', () => {
    const from = new Date('2026-03-01T00:00:00Z');
    const to = new Date('2026-03-31T00:00:00Z');
    const { priorFrom, priorTo } = computePriorPeriod(from, to);
    expect(priorFrom).toBeInstanceOf(Date);
    expect(priorTo).toBeInstanceOf(Date);
  });

  it('handles single-day ranges', () => {
    const from = new Date('2026-03-15T00:00:00Z');
    const to = new Date('2026-03-15T00:00:00Z');
    const { priorFrom, priorTo } = computePriorPeriod(from, to);
    // priorTo = Mar 14
    expect(toYMD(priorTo)).toBe('2026-03-14');
    // length = 0, so priorFrom = priorTo
    expect(priorFrom.getTime()).toBe(priorTo.getTime());
  });
});

describe('aggregateDailyMetrics', () => {
  it('returns all zeros for empty array', () => {
    const result = aggregateDailyMetrics([]);
    expect(result).toEqual({
      searchImpressions: 0,
      mapsImpressions: 0,
      websiteClicks: 0,
      callClicks: 0,
      directionRequests: 0,
    });
  });

  it('sums desktop+mobile into searchImpressions and mapsImpressions separately', () => {
    const metrics = [{
      impressionsSearchDesktop: 100,
      impressionsSearchMobile: 50,
      impressionsMapsDesktop: 30,
      impressionsMapsMobile: 20,
      websiteClicks: 10,
      callClicks: 5,
      directionRequests: 3,
    }];
    const result = aggregateDailyMetrics(metrics);
    expect(result.searchImpressions).toBe(150); // 100 + 50
    expect(result.mapsImpressions).toBe(50);    // 30 + 20
    expect(result.websiteClicks).toBe(10);
    expect(result.callClicks).toBe(5);
    expect(result.directionRequests).toBe(3);
  });

  it('sums multiple records correctly', () => {
    const metrics = [
      {
        impressionsSearchDesktop: 100,
        impressionsSearchMobile: 50,
        impressionsMapsDesktop: 30,
        impressionsMapsMobile: 20,
        websiteClicks: 10,
        callClicks: 5,
        directionRequests: 3,
      },
      {
        impressionsSearchDesktop: 200,
        impressionsSearchMobile: 100,
        impressionsMapsDesktop: 60,
        impressionsMapsMobile: 40,
        websiteClicks: 20,
        callClicks: 10,
        directionRequests: 6,
      },
    ];
    const result = aggregateDailyMetrics(metrics);
    expect(result.searchImpressions).toBe(450); // (100+50) + (200+100)
    expect(result.mapsImpressions).toBe(150);   // (30+20) + (60+40)
    expect(result.websiteClicks).toBe(30);
    expect(result.callClicks).toBe(15);
    expect(result.directionRequests).toBe(9);
  });

  it('does NOT combine search and maps into a single total', () => {
    const metrics = [{
      impressionsSearchDesktop: 100,
      impressionsSearchMobile: 50,
      impressionsMapsDesktop: 30,
      impressionsMapsMobile: 20,
      websiteClicks: 0,
      callClicks: 0,
      directionRequests: 0,
    }];
    const result = aggregateDailyMetrics(metrics);
    // Search and maps should be separate, not combined
    expect(result.searchImpressions).not.toBe(200); // not all four summed
    expect(result.mapsImpressions).not.toBe(200);
  });
});

describe('computePctChange', () => {
  it('returns 100 for 10 current vs 5 previous', () => {
    expect(computePctChange(10, 5)).toBe(100);
  });

  it('returns null when previous is 0 (divide-by-zero guard)', () => {
    expect(computePctChange(5, 0)).toBeNull();
  });

  it('returns null when both are 0', () => {
    expect(computePctChange(0, 0)).toBeNull();
  });

  it('returns 0 when current equals previous', () => {
    expect(computePctChange(10, 10)).toBe(0);
  });

  it('returns negative percent for decrease', () => {
    expect(computePctChange(5, 10)).toBe(-50);
  });

  it('rounds to nearest integer', () => {
    // (7-3)/3 * 100 = 133.33 => 133
    expect(computePctChange(7, 3)).toBe(133);
  });
});

describe('computeSparklineData', () => {
  it('returns empty array for empty metrics', () => {
    expect(computeSparklineData([], 'callClicks')).toEqual([]);
  });

  it('returns array of { date: YYYY-MM-DD, value: number } sorted by date ascending', () => {
    const metrics = [
      { date: new Date('2026-03-10T00:00:00Z'), callClicks: 5, websiteClicks: 2, directionRequests: 1 },
      { date: new Date('2026-03-08T00:00:00Z'), callClicks: 3, websiteClicks: 1, directionRequests: 0 },
      { date: new Date('2026-03-12T00:00:00Z'), callClicks: 7, websiteClicks: 4, directionRequests: 2 },
    ];
    const result = computeSparklineData(metrics, 'callClicks');
    expect(result).toHaveLength(3);
    expect(result[0].date).toBe('2026-03-08');
    expect(result[0].value).toBe(3);
    expect(result[1].date).toBe('2026-03-10');
    expect(result[1].value).toBe(5);
    expect(result[2].date).toBe('2026-03-12');
    expect(result[2].value).toBe(7);
  });

  it('extracts the correct field', () => {
    const metrics = [
      { date: new Date('2026-03-10T00:00:00Z'), callClicks: 5, websiteClicks: 2, directionRequests: 1 },
    ];
    expect(computeSparklineData(metrics, 'websiteClicks')[0].value).toBe(2);
    expect(computeSparklineData(metrics, 'directionRequests')[0].value).toBe(1);
  });

  it('formats date as YYYY-MM-DD using UTC', () => {
    const metrics = [
      { date: new Date('2026-03-15T00:00:00Z'), callClicks: 3, websiteClicks: 0, directionRequests: 0 },
    ];
    const result = computeSparklineData(metrics, 'callClicks');
    expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result[0].date).toBe('2026-03-15');
  });
});

describe('buildActionsLog', () => {
  const from = new Date('2026-03-01T00:00:00Z');
  const to = new Date('2026-03-31T23:59:59Z');

  it('returns empty array when all inputs are empty', () => {
    const result = buildActionsLog([], [], [], from, to);
    expect(result).toEqual([]);
  });

  it('filters posts to only PUBLISHED status with publishedAt in range', () => {
    const posts = [
      { id: '1', status: 'PUBLISHED', publishedAt: new Date('2026-03-15T00:00:00Z'), profile: { name: 'Profile A' } },
      { id: '2', status: 'DRAFT', publishedAt: new Date('2026-03-15T00:00:00Z'), profile: { name: 'Profile A' } },
      { id: '3', status: 'PUBLISHED', publishedAt: new Date('2026-02-15T00:00:00Z'), profile: { name: 'Profile A' } }, // out of range
      { id: '4', status: 'PUBLISHED', publishedAt: null, profile: { name: 'Profile A' } },
    ];
    const result = buildActionsLog(posts, [], [], from, to);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(result[0].type).toBe('post');
  });

  it('filters responses to only PUBLISHED status with createdAt in range', () => {
    const responses = [
      { id: 'r1', status: 'PUBLISHED', createdAt: new Date('2026-03-10T00:00:00Z'), review: { profile: { name: 'Profile B' } } },
      { id: 'r2', status: 'DRAFT', createdAt: new Date('2026-03-10T00:00:00Z'), review: { profile: { name: 'Profile B' } } },
      { id: 'r3', status: 'PUBLISHED', createdAt: new Date('2026-01-10T00:00:00Z'), review: { profile: { name: 'Profile B' } } }, // out of range
    ];
    const result = buildActionsLog([], responses, [], from, to);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
    expect(result[0].type).toBe('review_reply');
  });

  it('filters descriptions to only those with pushedAt in range', () => {
    const descriptions = [
      { id: 'd1', pushedAt: new Date('2026-03-20T00:00:00Z'), profile: { name: 'Profile C' } },
      { id: 'd2', pushedAt: null, profile: { name: 'Profile C' } },
      { id: 'd3', pushedAt: new Date('2026-01-20T00:00:00Z'), profile: { name: 'Profile C' } }, // out of range
    ];
    const result = buildActionsLog([], [], descriptions, from, to);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('d1');
    expect(result[0].type).toBe('description');
  });

  it('returns items sorted newest-first', () => {
    const posts = [
      { id: 'p1', status: 'PUBLISHED', publishedAt: new Date('2026-03-05T00:00:00Z'), profile: { name: 'Profile A' } },
      { id: 'p2', status: 'PUBLISHED', publishedAt: new Date('2026-03-20T00:00:00Z'), profile: { name: 'Profile A' } },
      { id: 'p3', status: 'PUBLISHED', publishedAt: new Date('2026-03-10T00:00:00Z'), profile: { name: 'Profile A' } },
    ];
    const result = buildActionsLog(posts, [], [], from, to);
    expect(result[0].id).toBe('p2'); // newest first
    expect(result[1].id).toBe('p3');
    expect(result[2].id).toBe('p1');
  });

  it('does NOT slice results (returns all items in range)', () => {
    const posts = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}`,
      status: 'PUBLISHED',
      publishedAt: new Date(`2026-03-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z`),
      profile: { name: 'Profile A' },
    }));
    const result = buildActionsLog(posts, [], [], from, to);
    expect(result.length).toBe(25); // no slice limit
  });

  it('returns ActionLogItem with id, label, profileName, time, type fields', () => {
    const posts = [
      { id: 'p1', status: 'PUBLISHED', publishedAt: new Date('2026-03-15T00:00:00Z'), profile: { name: 'Test Profile' } },
    ];
    const result = buildActionsLog(posts, [], [], from, to);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('label');
    expect(result[0]).toHaveProperty('profileName', 'Test Profile');
    expect(result[0]).toHaveProperty('time');
    expect(result[0]).toHaveProperty('type', 'post');
  });

  it('mixes items from all three sources sorted newest-first', () => {
    const posts = [
      { id: 'p1', status: 'PUBLISHED', publishedAt: new Date('2026-03-10T00:00:00Z'), profile: { name: 'Profile A' } },
    ];
    const responses = [
      { id: 'r1', status: 'PUBLISHED', createdAt: new Date('2026-03-20T00:00:00Z'), review: { profile: { name: 'Profile B' } } },
    ];
    const descriptions = [
      { id: 'd1', pushedAt: new Date('2026-03-15T00:00:00Z'), profile: { name: 'Profile C' } },
    ];
    const result = buildActionsLog(posts, responses, descriptions, from, to);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('r1'); // Mar 20
    expect(result[1].id).toBe('d1'); // Mar 15
    expect(result[2].id).toBe('p1'); // Mar 10
  });
});
