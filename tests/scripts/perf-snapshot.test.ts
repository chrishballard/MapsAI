import { describe, it, expect, afterEach } from 'vitest';
import { buildPerfSnapshot, type DailyMetricRow } from '../../scripts/perf-snapshot';

// `rankmaps perf` output gets pasted into client emails, so each of these was
// a wrong sentence in front of a client:
//   M9  months before the metrics history were zeros, dragging the baseline
//       down (fake +100%) and getting named the "Lowest" month
//   M10 a rise from an average of 0 read "flat"
//   M11 "last complete month" came from the UTC month, so an evening run on
//       the last day of a month treated that unfinished month as complete

const ZERO = {
  callClicks: 0,
  websiteClicks: 0,
  directionRequests: 0,
  conversations: 0,
  impressionsSearchDesktop: 0,
  impressionsSearchMobile: 0,
  impressionsMapsDesktop: 0,
  impressionsMapsMobile: 0,
};

/** One row per day of a UTC month, each day carrying `perDay`. */
function month(ym: string, perDay: Partial<DailyMetricRow>, fromDay = 1): DailyMetricRow[] {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: DailyMetricRow[] = [];
  for (let d = fromDay; d <= last; d++) {
    out.push({ ...ZERO, ...perDay, date: new Date(Date.UTC(y, m - 1, d)) });
  }
  return out;
}

const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

// Mid-month, mid-day in every US zone: the window is May..October 2026.
const OCT_21 = new Date('2026-10-21T18:00:00Z');

describe('baseline only averages months that have data (M9)', () => {
  // History starts in August: May, June, July hold nothing.
  const rows = [
    ...month('2026-08', { callClicks: 2 }),
    ...month('2026-09', { callClicks: 2 }),
    ...month('2026-10', { callClicks: 2 }, 1).slice(0, 20),
  ];

  it('does not report a flat month as a rise because of empty months', () => {
    const snap = buildPerfSnapshot(rows, OCT_21);
    // September (60 calls) vs August (62 calls): a small dip, not +100%.
    expect(snap.trend).not.toBeNull();
    expect(snap.trend!.comparing).toBe('September 2026');
    expect(snap.trend!.vsAvgOfPrior).toBe('August 2026');
    expect(snap.trend!.callClicks).toBeCloseTo(-3.2, 1);
  });

  it('says the baseline is short and lists what it left out', () => {
    const snap = buildPerfSnapshot(rows, OCT_21);
    expect(snap.trend!.baselineMonths).toBe(1);
    expect(snap.trend!.baselineNote).toMatch(/Baseline is 1 month, not 4/);
    expect(snap.trend!.excludedFromBaseline.map((e) => e.month)).toEqual([
      'May 2026',
      'June 2026',
      'July 2026',
    ]);
    expect(snap.highlights.join(' ')).toContain('vs prior 1-month avg');
    expect(snap.highlights.join(' ')).not.toContain('4-month');
  });

  it('never names a month with no data as the lowest', () => {
    const snap = buildPerfSnapshot(
      [...month('2026-08', { callClicks: 3 }), ...month('2026-09', { callClicks: 2 })],
      OCT_21
    );
    const line = snap.highlights.find((h) => h.startsWith('Best month'));
    expect(line).toBeDefined();
    expect(line).toContain('Lowest: September 2026');
    expect(line).not.toMatch(/May|June|July/);
  });

  it('leaves out a month the history only partly covers', () => {
    const snap = buildPerfSnapshot(
      [
        ...month('2026-07', { callClicks: 2 }, 25), // 7 of 31 days
        ...month('2026-08', { callClicks: 2 }),
        ...month('2026-09', { callClicks: 2 }),
      ],
      OCT_21
    );
    const july = snap.months.find((m) => m.month === '2026-07')!;
    expect(july.daysWithData).toBe(7);
    expect(snap.trend!.vsAvgOfPrior).toBe('August 2026');
    expect(snap.trend!.excludedFromBaseline).toContainEqual({
      month: 'July 2026',
      reason: 'only 7 of 31 days synced',
    });
  });

  it('has no trend, and says why, when the compared month has no data', () => {
    const snap = buildPerfSnapshot([], OCT_21);
    expect(snap.trend).toBeNull();
    expect(snap.trendUnavailable).toMatch(/no data synced for September 2026/);
  });

  it('keeps the full four-month baseline when the history covers it', () => {
    const snap = buildPerfSnapshot(
      ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].flatMap((m) =>
        month(m, { callClicks: 1 })
      ),
      OCT_21
    );
    expect(snap.trend!.baselineMonths).toBe(4);
    expect(snap.trend!.baselineNote).toBeNull();
    expect(snap.highlights[0]).toContain('vs prior 4-month avg');
  });
});

describe('a rise from zero is not "flat" (M10)', () => {
  it('reads "up from 0"', () => {
    const snap = buildPerfSnapshot(
      [
        ...month('2026-08', { callClicks: 1 }),
        ...month('2026-09', { callClicks: 1, websiteClicks: 1 }),
      ],
      OCT_21
    );
    expect(snap.trend!.websiteClicks).toBeNull();
    expect(snap.trend!.changes.websiteClicks).toBe('up from 0');
    expect(snap.highlights[0]).toContain('30 website clicks (up from 0)');
  });

  it('still reads "flat" for zero against zero', () => {
    const snap = buildPerfSnapshot(
      [...month('2026-08', { callClicks: 1 }), ...month('2026-09', { callClicks: 1 })],
      OCT_21
    );
    expect(snap.trend!.changes.directionRequests).toBe('flat');
  });
});

describe('the current month comes from the operator calendar (M11)', () => {
  // 19:30 MDT on Oct 31 is already Nov 1 in UTC.
  const OCT_31_EVENING_DENVER = new Date('2026-11-01T01:30:00Z');

  it('treats October as unfinished on the evening of Oct 31 in Denver', () => {
    process.env.TZ = 'America/Denver';
    const snap = buildPerfSnapshot(
      [...month('2026-09', { callClicks: 1 }), ...month('2026-10', { callClicks: 1 })],
      OCT_31_EVENING_DENVER
    );
    const october = snap.months.find((m) => m.month === '2026-10')!;
    expect(october.isPartial).toBe(true);
    expect(snap.trend?.comparing ?? null).not.toBe('October 2026');
    expect(snap.window.to).toBe('2026-10-31');
    expect(snap.months.map((m) => m.month)).toEqual([
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
  });

  it('moves to November once it is November locally', () => {
    process.env.TZ = 'America/Denver';
    const snap = buildPerfSnapshot(
      [...month('2026-09', { callClicks: 1 }), ...month('2026-10', { callClicks: 1 })],
      new Date('2026-11-01T15:00:00Z')
    );
    expect(snap.trend!.comparing).toBe('October 2026');
  });
});
