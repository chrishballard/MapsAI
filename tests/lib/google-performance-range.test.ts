import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Performance API request range. DailyMetric rows are keyed on UTC dates,
// so the calendar days asked of Google must be UTC days too. Read through
// local getters, a UTC midnight in a US zone is the previous evening, and the
// whole range slid back a day whenever the sync ran outside UTC (scripts and
// backfills on a laptop). The caller's side is in metrics-sync-range.test.ts.

const mocks = vi.hoisted(() => ({
  fetchMulti: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    businessprofileperformance: () => ({
      locations: { fetchMultiDailyMetricsTimeSeries: mocks.fetchMulti },
    }),
  },
}));
vi.mock('@/lib/google', () => ({ createGoogleClient: vi.fn(async () => ({})) }));

const { fetchDailyMetrics } = await import('@/lib/google-performance');

let previousTz: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchMulti.mockResolvedValue({ data: {} });
  previousTz = process.env.TZ;
  process.env.TZ = 'America/Denver';
});
afterEach(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('fetchDailyMetrics', () => {
  it('the zone is really in effect (guards the cases below)', () => {
    expect(new Date('2026-03-01T00:00:00Z').getDate()).toBe(28);
  });

  it('asks Google for the UTC calendar days it was given', async () => {
    await fetchDailyMetrics(
      'ga1',
      '12345',
      new Date('2025-12-15T00:00:00Z'),
      new Date('2026-03-01T00:00:00Z')
    );
    expect(mocks.fetchMulti).toHaveBeenCalledWith(
      expect.objectContaining({
        location: 'locations/12345',
        'dailyRange.startDate.year': 2025,
        'dailyRange.startDate.month': 12,
        'dailyRange.startDate.day': 15,
        'dailyRange.endDate.year': 2026,
        'dailyRange.endDate.month': 3,
        'dailyRange.endDate.day': 1,
      })
    );
  });
});
