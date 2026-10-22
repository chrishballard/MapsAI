import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// The PDF reports are the numbers clients read. These tests pin what goes
// into them: the data handed to the template, the chart series, and the
// labels. Charts and react-pdf are mocked so nothing native renders; the
// template components are plain strings, so a document can be walked as a
// tree for its text.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    dailyMetric: { findMany: vi.fn() },
    monthlyKeyword: { findMany: vi.fn() },
    review: { findMany: vi.fn() },
    post: { count: vi.fn(), findMany: vi.fn() },
    reviewResponse: { findMany: vi.fn() },
    profileDescription: { findMany: vi.fn() },
  },
  renderImpressionsChart: vi.fn(),
  renderSparklineChart: vi.fn(),
  renderToBuffer: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/pdf/chart-renderer', () => ({
  renderImpressionsChart: mocks.renderImpressionsChart,
  renderSparklineChart: mocks.renderSparklineChart,
}));
vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: mocks.renderToBuffer,
  StyleSheet: { create: <T,>(styles: T) => styles },
  Document: 'Document',
  Page: 'Page',
  View: 'View',
  Text: 'Text',
  Image: 'Image',
}));

const { generateReport, generateDashboardReport } = await import(
  '@/lib/pdf/report-generator'
);
const { ReportDocument } = await import('@/lib/pdf/report-template');
type ReportData = import('@/lib/pdf/report-template').ReportData;
type DashboardReportData = import('@/lib/pdf/report-template').DashboardReportData;

const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/** A DailyMetric row with every count set to n. */
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
    conversations: 0,
    createdAt: utc(ymd),
  };
}

/** The data object the last render handed to the template. */
function renderedData<T>(): T {
  const calls = mocks.renderToBuffer.mock.calls;
  const element = calls[calls.length - 1][0] as ReactElement<{ data: T }>;
  return element.props.data;
}

/** Every <Text> in a rendered document, each as one string. */
function textsOf(node: ReactNode): string[] {
  const out: string[] = [];
  const flatten = (n: ReactNode): string => {
    if (n === null || n === undefined || typeof n === 'boolean') return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(flatten).join('');
    const el = n as ReactElement<{ children?: ReactNode }>;
    return flatten(el.props?.children);
  };
  const walk = (n: ReactNode) => {
    if (n === null || n === undefined || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    const el = n as ReactElement<{ children?: ReactNode }>;
    if (el.type === 'Text') {
      out.push(flatten(el.props.children));
      return;
    }
    walk(el.props?.children);
  };
  walk(node);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renderToBuffer.mockResolvedValue(Buffer.from('%PDF-'));
  mocks.renderImpressionsChart.mockResolvedValue(Buffer.from('png'));
  mocks.renderSparklineChart.mockResolvedValue(Buffer.from('png'));
  mocks.prisma.profile.findUnique.mockResolvedValue(null);
  mocks.prisma.profile.findUniqueOrThrow.mockResolvedValue({
    id: 'p1',
    name: 'Badger Test Gutters',
    address: '1 Main St',
    category: 'Gutter service',
  });
  mocks.prisma.dailyMetric.findMany.mockResolvedValue([]);
  mocks.prisma.monthlyKeyword.findMany.mockResolvedValue([]);
  mocks.prisma.review.findMany.mockResolvedValue([]);
  mocks.prisma.post.count.mockResolvedValue(0);
  mocks.prisma.post.findMany.mockResolvedValue([]);
  mocks.prisma.reviewResponse.findMany.mockResolvedValue([]);
  mocks.prisma.profileDescription.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('generateDashboardReport: All Profiles charts', () => {
  // Without a profile filter the range holds one DailyMetric row per profile
  // per day. Charted as-is that is N points per date, a sawtooth, instead of
  // the day's total across the book.
  it('charts one point per day, summed across profiles', async () => {
    mocks.prisma.dailyMetric.findMany
      .mockResolvedValueOnce([
        metricRow('p1', '2026-03-01', 1),
        metricRow('p2', '2026-03-01', 10),
        metricRow('p1', '2026-03-02', 2),
        metricRow('p2', '2026-03-02', 20),
      ])
      .mockResolvedValueOnce([]);

    await generateDashboardReport(null, utc('2026-03-01'), utc('2026-03-31'), null);

    expect(mocks.renderImpressionsChart).toHaveBeenCalledTimes(1);
    expect(mocks.renderImpressionsChart.mock.calls[0][0]).toEqual([
      { date: '2026-03-01', search: 22, maps: 22 },
      { date: '2026-03-02', search: 44, maps: 44 },
    ]);
  });

  it('sums each sparkline per day too', async () => {
    mocks.prisma.dailyMetric.findMany
      .mockResolvedValueOnce([
        metricRow('p1', '2026-03-01', 1),
        metricRow('p2', '2026-03-01', 10),
        metricRow('p1', '2026-03-02', 2),
        metricRow('p2', '2026-03-02', 20),
      ])
      .mockResolvedValueOnce([]);

    await generateDashboardReport(null, utc('2026-03-01'), utc('2026-03-31'), null);

    // callClicks, websiteClicks, directionRequests, in that order.
    expect(mocks.renderSparklineChart).toHaveBeenCalledTimes(3);
    for (const [series] of mocks.renderSparklineChart.mock.calls) {
      expect(series).toEqual([
        { date: '2026-03-01', value: 11 },
        { date: '2026-03-02', value: 22 },
      ]);
    }
  });

  it('leaves the headline totals unchanged', async () => {
    mocks.prisma.dailyMetric.findMany
      .mockResolvedValueOnce([
        metricRow('p1', '2026-03-01', 1),
        metricRow('p2', '2026-03-01', 10),
      ])
      .mockResolvedValueOnce([]);

    await generateDashboardReport(null, utc('2026-03-01'), utc('2026-03-31'), null);

    const data = renderedData<DashboardReportData>();
    expect(data.currentMetrics.searchImpressions).toBe(22);
    expect(data.currentMetrics.callClicks).toBe(11);
  });
});

describe('generateDashboardReport: review replies in the actions log', () => {
  it('queries replies by publishedAt, with createdAt only for rows missing it', async () => {
    const from = utc('2026-03-01');
    const to = utc('2026-03-31');
    await generateDashboardReport('p1', from, to, null);

    const args = mocks.prisma.reviewResponse.findMany.mock.calls[0][0];
    const end = utc('2026-04-01'); // the whole of Mar 31 counts
    expect(args.where).toMatchObject({
      status: 'PUBLISHED',
      review: { profileId: 'p1' },
      OR: [
        { publishedAt: { gte: from, lt: end } },
        { publishedAt: null, createdAt: { gte: from, lt: end } },
      ],
    });
    expect(args.where.createdAt).toBeUndefined();
    expect(args.select.publishedAt).toBe(true);
  });

  it('lists a reply drafted last month and published this month, on its publish day', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([
      {
        id: 'r1',
        status: 'PUBLISHED',
        createdAt: new Date('2026-02-26T15:00:00Z'),
        publishedAt: new Date('2026-03-02T15:00:00Z'),
        review: { profile: { name: 'Badger Test Gutters' } },
      },
    ]);

    await generateDashboardReport('p1', utc('2026-03-01'), utc('2026-03-31'), null);

    expect(renderedData<DashboardReportData>().actions).toEqual([
      {
        label: 'Published review reply',
        profileName: 'Badger Test Gutters',
        date: 'Mar 2, 2026',
      },
    ]);
  });
});

describe('generateDashboardReport: dates print in UTC', () => {
  // from/to are UTC midnights and action times are filtered against them, so
  // they print in UTC too. Read in a US zone, a UTC midnight is the evening
  // before: a local formatter labelled March as "Feb 28 - Mar 30".
  let previousTz: string | undefined;
  beforeEach(() => {
    previousTz = process.env.TZ;
    process.env.TZ = 'America/Denver';
  });
  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it('the zone is really in effect (guards the cases below)', () => {
    expect(utc('2026-03-01').getDate()).toBe(28);
  });

  it('labels the period by its UTC dates', async () => {
    await generateDashboardReport('p1', utc('2026-03-01'), utc('2026-03-31'), null);
    expect(renderedData<DashboardReportData>().periodLabel).toBe(
      'Mar 1, 2026 - Mar 31, 2026'
    );
  });

  it('dates an action by its UTC day', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      {
        id: 'post1',
        status: 'PUBLISHED',
        publishedAt: new Date('2026-03-10T02:00:00Z'), // Mar 9 evening in Denver
        profile: { name: 'Badger Test Gutters' },
      },
    ]);
    await generateDashboardReport('p1', utc('2026-03-01'), utc('2026-03-31'), null);
    expect(renderedData<DashboardReportData>().actions[0].date).toBe('Mar 10, 2026');
  });
});

describe('generateReport: response rate', () => {
  it('counts reviews the owner answered outside RankMaps as responded', async () => {
    mocks.prisma.review.findMany.mockResolvedValue([
      { id: 'a', rating: 5, repliedExternally: true, response: null },
      { id: 'b', rating: 4, repliedExternally: false, response: { status: 'PUBLISHED' } },
      { id: 'c', rating: 3, repliedExternally: false, response: { status: 'DRAFTED' } },
      { id: 'd', rating: 5, repliedExternally: false, response: null },
    ]);

    await generateReport('p1', utc('2026-03-01'));

    const data = renderedData<ReportData>();
    expect(data.reviewCount).toBe(4);
    expect(data.responseRate).toBe(50);
  });
});

describe('generateReport: a month still in progress', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'));
  });

  // Google's performance data lags the calendar by a few days, so a report
  // generated on the 21st holds data through the 18th or 19th. "As of" the
  // generation date claimed days the numbers don't cover.
  it('marks the current month as partial, as of the last day with data', async () => {
    mocks.prisma.dailyMetric.findMany.mockResolvedValueOnce([
      metricRow('p1', '2026-10-01', 1),
      metricRow('p1', '2026-10-18', 1),
      metricRow('p1', '2026-10-19', 1),
    ]);
    await generateReport('p1', utc('2026-10-01'));
    const data = renderedData<ReportData>();
    expect(data.month).toBe('October 2026');
    expect(data.partialMonth).toEqual({ asOf: 'Oct 19, 2026', ended: false });
  });

  // The metrics sync asks Google for every day through today and stores a row
  // of zeros for each day Google hasn't reported yet, so the last row is not
  // the last day with data.
  it("skips the zero rows the sync stores for days Google hasn't reported", async () => {
    mocks.prisma.dailyMetric.findMany.mockResolvedValueOnce([
      metricRow('p1', '2026-10-16', 3),
      metricRow('p1', '2026-10-17', 2),
      metricRow('p1', '2026-10-18', 0),
      metricRow('p1', '2026-10-19', 0),
      metricRow('p1', '2026-10-20', 0),
      metricRow('p1', '2026-10-21', 0),
    ]);
    await generateReport('p1', utc('2026-10-01'));
    expect(renderedData<ReportData>().partialMonth).toEqual({ asOf: 'Oct 17, 2026', ended: false });
  });

  it('says so when a month in progress has no data yet', async () => {
    mocks.prisma.dailyMetric.findMany.mockResolvedValueOnce([
      metricRow('p1', '2026-10-01', 0),
      metricRow('p1', '2026-10-02', 0),
    ]);
    await generateReport('p1', utc('2026-10-01'));
    expect(renderedData<ReportData>().partialMonth).toEqual({ asOf: null, ended: false });
  });

  it('leaves a finished month unmarked', async () => {
    await generateReport('p1', utc('2026-09-01'));
    expect(renderedData<ReportData>().partialMonth).toBeNull();
  });
});

// The default report is last month's, and it is usually generated in the
// first days of the next month, while Google is still posting the last few
// days. Shown as complete, those empty days read as a drop against the month
// before.
describe('generateReport: a month that just ended, still filling in', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
  });

  const october = (lastReported: number) =>
    Array.from({ length: 31 }, (_, i) =>
      metricRow('p1', `2026-10-${String(i + 1).padStart(2, '0')}`, i + 1 <= lastReported ? 5 : 0)
    );

  it('is marked partial, through the last reported day', async () => {
    mocks.prisma.dailyMetric.findMany.mockResolvedValueOnce(october(28));
    await generateReport('p1', utc('2026-10-01'));
    expect(renderedData<ReportData>().partialMonth).toEqual({ asOf: 'Oct 28, 2026', ended: true });
  });

  it('is complete once its last day has data', async () => {
    mocks.prisma.dailyMetric.findMany.mockResolvedValueOnce(october(31));
    await generateReport('p1', utc('2026-10-01'));
    expect(renderedData<ReportData>().partialMonth).toBeNull();
  });

  it('is complete once the reporting lag has passed, whatever its last days hold', async () => {
    vi.setSystemTime(new Date('2026-11-09T15:00:00Z'));
    mocks.prisma.dailyMetric.findMany.mockResolvedValueOnce(october(28));
    await generateReport('p1', utc('2026-10-01'));
    expect(renderedData<ReportData>().partialMonth).toBeNull();
  });
});

// Ranges run from UTC midnight on the first day to UTC midnight on the last
// day. For DailyMetric (one row per date) that's right; for timestamps,
// `lte: <last day 00:00>` dropped everything after midnight on the month's
// last day: reviews, posts and replies from the 31st went missing.
describe('generateReport: the whole last day counts', () => {
  it('counts reviews and posts up to midnight after the last day', async () => {
    await generateReport('p1', utc('2026-03-01'));

    const range = { gte: utc('2026-03-01'), lt: utc('2026-04-01') };
    expect(mocks.prisma.review.findMany.mock.calls[0][0].where.reviewDate).toEqual(range);
    expect(mocks.prisma.post.count.mock.calls[0][0].where.publishedAt).toEqual(range);
    // Daily metrics are dates, not timestamps: the last day's row is dated 00:00.
    expect(mocks.prisma.dailyMetric.findMany.mock.calls[0][0].where.date).toEqual({
      gte: utc('2026-03-01'),
      lte: utc('2026-03-31'),
    });
  });
});

describe('generateDashboardReport: All Profiles means onboarded profiles', () => {
  // ~225 connected locations were never onboarded; summed in they tripled
  // the agency-wide impressions.
  it('scopes every query to onboarded profiles', async () => {
    await generateDashboardReport(null, utc('2026-09-01'), utc('2026-09-30'), null);

    const onboarded = { profile: { isOnboarded: true } };
    expect(mocks.prisma.dailyMetric.findMany).toHaveBeenCalledTimes(2);
    for (const [args] of mocks.prisma.dailyMetric.findMany.mock.calls) {
      expect(args.where).toMatchObject(onboarded);
    }
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where).toMatchObject(onboarded);
    expect(mocks.prisma.profileDescription.findMany.mock.calls[0][0].where).toMatchObject(onboarded);
    expect(mocks.prisma.reviewResponse.findMany.mock.calls[0][0].where).toMatchObject({
      review: onboarded,
    });
  });
});

describe('generateDashboardReport: the whole last day counts', () => {
  it('queries posts and descriptions up to midnight after the last day', async () => {
    await generateDashboardReport('p1', utc('2026-03-01'), utc('2026-03-31'), null);

    const range = { gte: utc('2026-03-01'), lt: utc('2026-04-01') };
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where.publishedAt).toEqual(range);
    expect(mocks.prisma.profileDescription.findMany.mock.calls[0][0].where.pushedAt).toEqual(range);
  });

  it('lists an action from the evening of the last day', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      {
        id: 'late',
        status: 'PUBLISHED',
        publishedAt: new Date('2026-03-31T18:00:00Z'),
        profile: { name: 'Badger Test Gutters' },
      },
    ]);
    await generateDashboardReport('p1', utc('2026-03-01'), utc('2026-03-31'), null);
    expect(renderedData<DashboardReportData>().actions).toEqual([
      { label: 'Published post', profileName: 'Badger Test Gutters', date: 'Mar 31, 2026' },
    ]);
  });
});

describe('ReportDocument', () => {
  const base: ReportData = {
    businessName: 'Badger Test Gutters',
    address: null,
    category: null,
    month: 'October 2026',
    partialMonth: null,
    currentMetrics: { totalImpressions: 600, websiteClicks: 6, callClicks: 6, directionRequests: 6 },
    previousMetrics: { totalImpressions: 1000, websiteClicks: 10, callClicks: 10, directionRequests: 10 },
    chartImageUri: null,
    keywords: [],
    reviewCount: 0,
    averageRating: 0,
    responseRate: 0,
    postsCount: 0,
  };

  it('compares a full month with the month before', () => {
    const texts = textsOf(ReportDocument({ data: base }));
    expect(texts).toContain('Performance Report - October 2026');
    expect(texts.filter((t) => t === '-40.0% vs prev month')).toHaveLength(4);
  });

  // Month-to-date against a whole previous month always reads as a drop, so
  // a partial month says so in the header and makes no comparison.
  it('labels a partial month and drops the month-over-month comparison', () => {
    const texts = textsOf(
      ReportDocument({ data: { ...base, partialMonth: { asOf: 'Oct 19, 2026', ended: false } } })
    );
    expect(texts).toContain(
      'Performance Report - October 2026 (partial month, as of Oct 19, 2026)'
    );
    expect(texts.some((t) => t.includes('vs prev month'))).toBe(false);
    expect(texts.filter((t) => t === 'Month in progress')).toHaveLength(4);
  });

  it('labels a partial month with no data yet', () => {
    const texts = textsOf(
      ReportDocument({ data: { ...base, partialMonth: { asOf: null, ended: false } } })
    );
    expect(texts).toContain('Performance Report - October 2026 (partial month, no data yet)');
    expect(texts.filter((t) => t === 'Month in progress')).toHaveLength(4);
  });

  it('labels a finished month whose last days Google has not posted yet', () => {
    const texts = textsOf(
      ReportDocument({ data: { ...base, partialMonth: { asOf: 'Oct 28, 2026', ended: true } } })
    );
    expect(texts).toContain(
      'Performance Report - October 2026 (Google data through Oct 28, 2026; final numbers in a few days)'
    );
    expect(texts.some((t) => t.includes('vs prev month'))).toBe(false);
    expect(texts.filter((t) => t === 'Data still arriving')).toHaveLength(4);
  });
});
