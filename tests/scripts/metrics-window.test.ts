import { describe, it, expect } from 'vitest';
import { describeMetricsWindow } from '../../scripts/metrics-window';

// The `metricsWindow` key of scripts/export-profile.ts, which the vault's
// sync-rankmaps renderer codes against. Row dates arrive out of a @db.Date
// column as midnight UTC, and `since` is truncated to its UTC date by Prisma
// before it ever reaches that column, so both format in UTC; `until` is a
// label for the operator's own day and formats locally. Getting any of them
// the wrong way round moves a date by a day, which is the confusion this key
// exists to end.

/** A DailyMetric.date as Prisma hands it back: midnight UTC. */
const row = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/** An instant on the local clock, the way `new Date()` produces one. */
const localNoon = (ymd: string) => {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

// Pinned so the expected strings hold in any timezone the suite runs in:
// `since` is read as a UTC date, `until` off the local calendar, so each is
// built the way it will be read. Noon local is the same calendar day in every
// zone, and a UTC instant formats the same everywhere. The zone-sensitive
// cases set process.env.TZ themselves and build their own dates.
const since = new Date('2026-08-17T06:00:00.000Z');
const until = localNoon('2026-09-15');

/** Every day from `from` to `to` inclusive, as UTC row dates. */
function everyDay(from: string, to: string): Date[] {
  const out: Date[] = [];
  for (let d = row(from); d <= row(to); d = new Date(d.getTime() + 86400000)) {
    out.push(new Date(d));
  }
  return out;
}

const granularityOf = (dates: Date[]) =>
  describeMetricsWindow(dates, since, until).granularity;

describe('describeMetricsWindow: the output contract', () => {
  it('always answers with the same six keys', () => {
    // The vault renderer codes against this shape. A key added or dropped is
    // a breaking change to a file nobody in this repo can see.
    const keys = ['since', 'until', 'rows', 'firstRow', 'lastRow', 'granularity'];
    expect(Object.keys(describeMetricsWindow([], since, until)).sort()).toEqual(
      [...keys].sort()
    );
    expect(
      Object.keys(describeMetricsWindow([row('2026-09-01')], since, until)).sort()
    ).toEqual([...keys].sort());
  });

  it('reports a row per day as daily, spanning a month boundary', () => {
    // Wilson Dentistry's real export on 2026-09-15: 30 rows, Aug 17 to
    // Sep 15. It contains Sep 1, so "any row on the 1st" would misread it as
    // monthly or mixed.
    const dates = everyDay('2026-08-17', '2026-09-15');
    expect(dates).toHaveLength(30);

    expect(describeMetricsWindow(dates, since, until)).toEqual({
      since: '2026-08-17',
      until: '2026-09-15',
      rows: 30,
      firstRow: '2026-08-17',
      lastRow: '2026-09-15',
      granularity: 'daily',
    });
  });

  it('reports an empty window as none, with null row bounds', () => {
    expect(describeMetricsWindow([], since, until)).toEqual({
      since: '2026-08-17',
      until: '2026-09-15',
      rows: 0,
      firstRow: null,
      lastRow: null,
      granularity: 'none',
    });
  });

  it('sorts unordered rows before reporting first and last', () => {
    // The exporter queries date desc, so the helper is never handed them in
    // ascending order in production.
    const dates = [row('2026-09-15'), row('2026-08-17'), row('2026-09-02')];

    expect(describeMetricsWindow(dates, since, until)).toMatchObject({
      firstRow: '2026-08-17',
      lastRow: '2026-09-15',
    });
  });

  it('counts rows, not distinct days, so a duplicated day is still reported', () => {
    // The DB holds at most one row per profile per day, so this should not
    // happen; `rows` is a count of what the query returned either way, and
    // only the verdict dedupes.
    const dates = [row('2026-09-14'), row('2026-09-14'), row('2026-09-15')];

    expect(describeMetricsWindow(dates, since, until)).toMatchObject({
      rows: 3,
      firstRow: '2026-09-14',
      lastRow: '2026-09-15',
      granularity: 'daily',
    });
  });
});

describe('describeMetricsWindow: daily windows that end on a 1st', () => {
  // The whole reason the verdict was rewritten. The rule used to be "a month
  // holding exactly one row, and that row its 1st, is an aggregate", and a
  // nightly export fires on a day whose 30-day window ends on the 1st about
  // once a month per profile. September then holds exactly one row, it is the
  // 1st, and a plainly daily window came back "mixed".

  it('reports a 30-day daily window ending on the 1st as daily', () => {
    const dates = everyDay('2026-08-03', '2026-09-01');
    expect(dates).toHaveLength(30);

    expect(describeMetricsWindow(dates, since, until)).toMatchObject({
      rows: 30,
      firstRow: '2026-08-03',
      lastRow: '2026-09-01',
      granularity: 'daily',
    });
  });

  it('reports Feb 1 to Mar 1 as daily, short month and all', () => {
    // February contributes 28 rows and March exactly one, dated the 1st.
    const dates = everyDay('2026-02-01', '2026-03-01');
    expect(dates).toHaveLength(29);

    expect(granularityOf(dates)).toBe('daily');
  });

  it('reports the two-row pair Aug 31 plus Sep 1 as daily', () => {
    // The smallest form of the same trap: September holds one row and it is
    // the 1st, but it sits one day after its neighbour.
    expect(granularityOf([row('2026-08-31'), row('2026-09-01')])).toBe('daily');
  });

  it('reports a single row that is not the 1st as daily', () => {
    expect(describeMetricsWindow([row('2026-09-15')], since, until)).toMatchObject({
      rows: 1,
      firstRow: '2026-09-15',
      lastRow: '2026-09-15',
      granularity: 'daily',
    });
  });

  it('reads a few missing days as holes in a daily series, not a new shape', () => {
    // Google reports nothing for some profiles on some days, and a sync can
    // miss a night. A week of holes is still daily.
    const dates = [
      ...everyDay('2026-09-01', '2026-09-04'),
      ...everyDay('2026-09-11', '2026-09-15'),
    ];

    expect(granularityOf(dates)).toBe('daily');
  });
});

describe('describeMetricsWindow: month-start aggregates', () => {
  it('reports the 1sts of three months as monthly', () => {
    const dates = [row('2026-07-01'), row('2026-08-01'), row('2026-09-01')];

    expect(describeMetricsWindow(dates, since, until)).toMatchObject({
      rows: 3,
      firstRow: '2026-07-01',
      lastRow: '2026-09-01',
      granularity: 'monthly',
    });
  });

  it('reports a single row dated the 1st as monthly, the documented tie', () => {
    // Ambiguous by nature: one row on a 1st is both a month aggregate and the
    // first day of a daily series, and with no gaps there is nothing to judge
    // it by. Both tests pass on it, monthly is asked first, so monthly is the
    // answer the contract gives.
    expect(describeMetricsWindow([row('2026-09-01')], since, until)).toMatchObject({
      rows: 1,
      granularity: 'monthly',
    });
  });

  it('counts Feb 1 to Mar 1 as a monthly gap, the shortest one there is', () => {
    // 28 days in a common year, which is why the floor is 28 and not 30.
    expect(granularityOf([row('2026-02-01'), row('2026-03-01')])).toBe('monthly');
  });
});

describe('describeMetricsWindow: mixed', () => {
  it('reports daily rows next to an isolated 1st two months earlier as mixed', () => {
    const dates = [row('2026-07-01'), ...everyDay('2026-09-10', '2026-09-15')];

    expect(describeMetricsWindow(dates, since, until)).toMatchObject({
      rows: 7,
      firstRow: '2026-07-01',
      lastRow: '2026-09-15',
      granularity: 'mixed',
    });
  });

  it('reports several month starts followed by a daily run as mixed', () => {
    // What a history that was aggregated once and is now collected daily
    // looks like.
    const dates = [
      row('2026-06-01'),
      row('2026-07-01'),
      ...everyDay('2026-09-10', '2026-09-15'),
    ];

    expect(describeMetricsWindow(dates, since, until)).toMatchObject({
      rows: 8,
      granularity: 'mixed',
    });
  });

  it('reports a month-long hole inside an otherwise daily run as mixed', () => {
    // Too wide to be a missed night, and the rows around it are not month
    // starts, so neither verdict fits and the honest answer is mixed.
    const dates = [
      ...everyDay('2026-07-10', '2026-07-15'),
      ...everyDay('2026-09-10', '2026-09-15'),
    ];

    expect(granularityOf(dates)).toBe('mixed');
  });
});

// The three dates this key reports are formatted by two different rules, and
// under TZ=UTC every one of those rules collapses onto the same answer. So the
// zone is set here rather than inherited from the machine: each block below
// builds its dates and reads its result inside a fixed zone, which is what
// makes these assertions able to fail.
//
// America/Denver is west of UTC, so a UTC-midnight instant is the previous
// evening there. Pacific/Kiritimati is UTC+14, so a local morning is the
// previous day in UTC. Between them they catch a date moved either way, and
// UTC is the control that must agree with both.
const ZONES = ['America/Denver', 'UTC', 'Pacific/Kiritimati'];

function withTimeZone<T>(timeZone: string, body: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe.each(ZONES)('describeMetricsWindow under TZ=%s', (timeZone) => {
  it('formats row dates in UTC, so a UTC-midnight row keeps its own day', () => {
    // Read through a US-local calendar, 2026-09-15T00:00Z is the evening of
    // the 14th. In Denver a local reading answers 2026-09-14 here.
    withTimeZone(timeZone, () => {
      const window = describeMetricsWindow(
        [row('2026-09-14'), row('2026-09-15')],
        new Date('2026-08-17T06:00:00.000Z'),
        new Date(2026, 8, 15, 12, 0, 0)
      );
      expect(window.firstRow).toBe('2026-09-14');
      expect(window.lastRow).toBe('2026-09-15');
    });
  });

  it('reports since as its UTC date, which is the floor the query applied', () => {
    // The real since30 from the 2026-09-15 18:27 MDT run. Its LOCAL date in
    // Denver is the 16th of August, but Prisma truncates the bound to its UTC
    // date before comparing against a @db.Date column, so the query floor was
    // the 17th and the row dated 2026-08-16 was excluded. Printing the local
    // date would claim a day the query never reached.
    withTimeZone(timeZone, () => {
      const since30 = new Date('2026-08-17T00:27:18.515Z');
      const window = describeMetricsWindow([], since30, new Date(2026, 8, 15, 12, 0, 0));
      expect(window.since).toBe('2026-08-17');
    });
  });

  it('reports until on the local clock for an evening run', () => {
    // 18:23 local on 2026-09-15 is already 2026-09-16 in UTC in Denver, a day
    // past the newest row that can exist. until is a label for the operator's
    // day, so it stays on the 15th.
    withTimeZone(timeZone, () => {
      const evening = new Date(2026, 8, 15, 18, 23, 0);
      expect(describeMetricsWindow([], since, evening).until).toBe('2026-09-15');
    });
  });

  it('reports until on the local clock for a morning run', () => {
    // The mirror of the case above, and the one that catches a UTC reading in
    // a zone east of UTC: 06:00 on 2026-09-15 in Kiritimati is 2026-09-14 in
    // UTC.
    withTimeZone(timeZone, () => {
      const morning = new Date(2026, 8, 15, 6, 0, 0);
      expect(describeMetricsWindow([], since, morning).until).toBe('2026-09-15');
    });
  });
});

describe('describeMetricsWindow: the zone assertions can actually fail', () => {
  // Guards the guards. If setting process.env.TZ ever stopped taking effect,
  // every assertion above would pass in any zone for the wrong reason, and
  // the suite would go back to proving nothing about which clock is used.
  it('sees a different local calendar day in Denver and Kiritimati', () => {
    const utcMidnight = new Date('2026-09-15T00:00:00.000Z');

    expect(withTimeZone('America/Denver', () => utcMidnight.getDate())).toBe(14);
    expect(withTimeZone('Pacific/Kiritimati', () => utcMidnight.getDate())).toBe(15);
    expect(
      withTimeZone('Pacific/Kiritimati', () =>
        new Date(2026, 8, 15, 6, 0, 0).toISOString().slice(0, 10)
      )
    ).toBe('2026-09-14');
  });

  it('puts the timezone back when a body throws', () => {
    const before = process.env.TZ;
    expect(() =>
      withTimeZone('Pacific/Kiritimati', () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(process.env.TZ).toBe(before);
  });
});
