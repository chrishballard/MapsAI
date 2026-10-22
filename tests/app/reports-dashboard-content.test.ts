import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// The web reports dashboard. With "All Profiles" a range holds one
// DailyMetric row per profile per day; charted as-is that drew a point per
// profile per date (a sawtooth) instead of the day's total. The PDF was fixed
// in #19; this pins the dashboard to the same per-day sums. It also pins the
// action queries to the whole of the range's last day.

const mocks = vi.hoisted(() => ({
  prisma: {
    dailyMetric: { findMany: vi.fn() },
    post: { findMany: vi.fn() },
    reviewResponse: { findMany: vi.fn() },
    profileDescription: { findMany: vi.fn() },
    profile: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
// Child components are only inspected as elements, never rendered.
vi.mock('@/app/dashboard/reports/views-on-google-chart', () => ({ ViewsOnGoogleChart: 'ViewsOnGoogleChart' }));
vi.mock('@/app/dashboard/reports/metric-spark-card', () => ({ MetricSparkCard: 'MetricSparkCard' }));
vi.mock('@/app/dashboard/reports/actions-log', () => ({ ActionsLog: 'ActionsLog' }));
vi.mock('@/app/dashboard/reports/executive-summary', () => ({ ExecutiveSummary: 'ExecutiveSummary' }));
vi.mock('@/app/dashboard/reports/dashboard-download-btn', () => ({ DashboardDownloadBtn: 'DashboardDownloadBtn' }));

const { ReportsDashboardContent } = await import('@/app/dashboard/reports/reports-dashboard-content');

const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function metricRow(profileId: string, ymd: string, n: number) {
  return {
    id: `${profileId}-${ymd}`,
    profileId,
    date: utc(ymd),
    impressionsSearchDesktop: n,
    impressionsSearchMobile: n,
    impressionsMapsDesktop: n,
    impressionsMapsMobile: n,
    websiteClicks: n,
    callClicks: n,
    directionRequests: n,
  };
}

/** Every element of the given type in the returned tree. */
function elementsOf(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (n: ReactNode) => {
    if (n === null || n === undefined || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    if (el.type === type) out.push(el);
    walk(el.props?.children as ReactNode);
  };
  walk(node);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.dailyMetric.findMany.mockResolvedValue([]);
  mocks.prisma.post.findMany.mockResolvedValue([]);
  mocks.prisma.reviewResponse.findMany.mockResolvedValue([]);
  mocks.prisma.profileDescription.findMany.mockResolvedValue([]);
  mocks.prisma.profile.findUnique.mockResolvedValue(null);
});

describe('ReportsDashboardContent: All Profiles charts', () => {
  beforeEach(() => {
    mocks.prisma.dailyMetric.findMany
      .mockResolvedValueOnce([
        metricRow('a', '2026-03-01', 1),
        metricRow('b', '2026-03-01', 10),
        metricRow('a', '2026-03-02', 2),
        metricRow('b', '2026-03-02', 20),
      ])
      .mockResolvedValueOnce([]);
  });

  it('charts one point per day, summed across profiles', async () => {
    const tree = await ReportsDashboardContent({ profileId: null, from: '2026-03-01', to: '2026-03-02' });

    const [chart] = elementsOf(tree, 'ViewsOnGoogleChart');
    expect(chart.props.data).toEqual([
      { date: '2026-03-01', search: 22, maps: 22 },
      { date: '2026-03-02', search: 44, maps: 44 },
    ]);
  });

  it('sums each sparkline per day too', async () => {
    const tree = await ReportsDashboardContent({ profileId: null, from: '2026-03-01', to: '2026-03-02' });

    const cards = elementsOf(tree, 'MetricSparkCard');
    expect(cards.map((c) => c.props.id)).toEqual(['calls', 'clicks', 'directions']);
    for (const card of cards) {
      expect(card.props.sparkData).toEqual([
        { date: '2026-03-01', value: 11 },
        { date: '2026-03-02', value: 22 },
      ]);
    }
  });
});

// The metrics sync reads every connected location the agency's logins can
// see, about 225 of them never onboarded (not clients). Summed into "All
// Profiles" they made September 2026 read 503k impressions where the 100
// onboarded clients had 163k. All Profiles means the profiles the page
// offers: onboarded ones.
describe('ReportsDashboardContent: All Profiles means onboarded profiles', () => {
  it('scopes every query to onboarded profiles', async () => {
    await ReportsDashboardContent({ profileId: null, from: '2026-09-01', to: '2026-09-30' });

    const onboarded = { profile: { isOnboarded: true } };
    for (const [args] of mocks.prisma.dailyMetric.findMany.mock.calls) {
      expect(args.where).toMatchObject(onboarded);
    }
    expect(mocks.prisma.dailyMetric.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where).toMatchObject(onboarded);
    expect(mocks.prisma.profileDescription.findMany.mock.calls[0][0].where).toMatchObject(onboarded);
    expect(mocks.prisma.reviewResponse.findMany.mock.calls[0][0].where).toMatchObject({
      review: onboarded,
    });
  });

  it('still scopes to the one profile when one is picked', async () => {
    await ReportsDashboardContent({ profileId: 'p1', from: '2026-09-01', to: '2026-09-30' });

    expect(mocks.prisma.dailyMetric.findMany.mock.calls[0][0].where).toMatchObject({ profileId: 'p1' });
    expect(mocks.prisma.reviewResponse.findMany.mock.calls[0][0].where).toMatchObject({
      review: { profileId: 'p1' },
    });
  });
});

describe('ReportsDashboardContent: the whole last day counts', () => {
  it('queries posts, replies and descriptions up to midnight after the last day', async () => {
    await ReportsDashboardContent({ profileId: 'p1', from: '2026-03-01', to: '2026-03-31' });

    const range = { gte: utc('2026-03-01'), lt: utc('2026-04-01') };
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where.publishedAt).toEqual(range);
    expect(mocks.prisma.profileDescription.findMany.mock.calls[0][0].where.pushedAt).toEqual(range);
    expect(mocks.prisma.reviewResponse.findMany.mock.calls[0][0].where.OR[0]).toEqual({
      publishedAt: range,
    });
  });
});
