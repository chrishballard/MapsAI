import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The date range syncProfileMetrics asks for. fetchDailyMetrics reads its
// dates as UTC calendar days (see google-performance-range.test.ts), so the
// sync must hand it UTC midnights: today's UTC date and `days` before it,
// whatever zone the process runs in.

const mocks = vi.hoisted(() => ({
  fetchDailyMetrics: vi.fn(),
  fetchSearchKeywords: vi.fn(),
  prisma: {
    dailyMetric: { upsert: vi.fn() },
    monthlyKeyword: { upsert: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google-performance', () => ({
  fetchDailyMetrics: mocks.fetchDailyMetrics,
  parseMetricsResponse: () => [],
}));
vi.mock('@/lib/google-keywords', () => ({ fetchSearchKeywords: mocks.fetchSearchKeywords }));

const { syncProfileMetrics } = await import('@/lib/sync/metrics');

const profile = {
  id: 'p1',
  name: 'Badger Test Gutters',
  googleAccountId: 'ga1',
  locationName: 'locations/12345',
};

let previousTz: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchDailyMetrics.mockResolvedValue({});
  mocks.fetchSearchKeywords.mockResolvedValue([]);
  previousTz = process.env.TZ;
  process.env.TZ = 'America/Denver';
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('syncProfileMetrics date range', () => {
  it('passes UTC midnights for today and `days` before it', async () => {
    // 03:00 UTC on Mar 15 is the evening of Mar 14 in Denver.
    vi.setSystemTime(new Date('2026-03-15T03:00:00Z'));
    await syncProfileMetrics(profile, { days: 90, keywordMonths: 0, logPrefix: '[test]' });

    const [, locationId, startDate, endDate] = mocks.fetchDailyMetrics.mock.calls[0];
    expect(locationId).toBe('12345');
    expect(endDate).toEqual(new Date('2026-03-15T00:00:00Z'));
    expect(startDate).toEqual(new Date('2025-12-15T00:00:00Z'));
  });

  it('counts days on the UTC calendar across a DST change', async () => {
    // US clocks went forward on 2026-03-08; a local-day subtraction would
    // come back an hour off midnight.
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    await syncProfileMetrics(profile, { days: 30, keywordMonths: 0, logPrefix: '[test]' });

    const [, , startDate, endDate] = mocks.fetchDailyMetrics.mock.calls[0];
    expect(endDate).toEqual(new Date('2026-03-20T00:00:00Z'));
    expect(startDate).toEqual(new Date('2026-02-18T00:00:00Z'));
  });
});
