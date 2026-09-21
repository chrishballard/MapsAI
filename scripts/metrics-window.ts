/**
 * Which days a DailyMetric rollup actually covers.
 *
 * The vault renders `metrics30d` under the heading "Last 30 days (totals)" and
 * nothing in the export said which days those rows were. A claim that they
 * were monthly aggregates was checked on 2026-09-15 and is false: 73,266
 * DailyMetric rows, 2,504 of them dated the 1st, one row per profile per day.
 * Wilson Dentistry's 69 calls, for instance, is a real daily sum. So the
 * window is carried out of the exporter as data rather than left for the next
 * reader to re-derive from the row count.
 *
 * This lives in its own module rather than beside the export in
 * scripts/export-profile.ts because that script calls main() at import time,
 * so a test cannot reach a helper defined next to it.
 */
import { formatDateISO } from "../src/lib/dates";

export type MetricsGranularity = "daily" | "monthly" | "mixed" | "none";

export interface MetricsWindow {
  /** Lower bound of the query. Not the first row found: there may be none. */
  since: string;
  /** Today, the implicit upper bound of the query. */
  until: string;
  /** Rows inside the window. The DB holds at most one per profile per day. */
  rows: number;
  firstRow: string | null;
  lastRow: string | null;
  granularity: MetricsGranularity;
}

/**
 * The three dates here are formatted by two different rules, and the split is
 * deliberate. All of it was probed against Wilson Dentistry on 2026-09-15.
 *
 * ROW DATES, and SINCE, are UTC (formatDateISO).
 *
 * Rows come out of a `@db.Date` column as midnight UTC, so a row dated
 * 2026-09-15 would print as the 14th if it were read through a US-local
 * calendar. `since` is UTC for a different reason: it is a query bound, and
 * Prisma compares it against that same `@db.Date` column by truncating the
 * instant to its UTC DATE and dropping the time. `date >= 2026-08-17T23:59:59Z`
 * still returns the row dated 2026-08-17, and `>= 2026-09-16T00:00:00Z`
 * returns nothing. So the floor the query really applied is the UTC date of
 * since30, and printing it in local time would name a day the query did not
 * actually reach, making a row that was excluded by the bound read as a day
 * with no data.
 *
 * UNTIL is local (formatLocalDate).
 *
 * It is not a bound; the query has no upper limit. It is a label for the day
 * the export ran, which is the operator's calendar day. In UTC it would read
 * 2026-09-16 for any run after 18:00 MDT, a day past the newest row that can
 * exist.
 *
 * A consequence worth knowing before reading a window: how far back the
 * exporter's "last 30 days" reaches depends on the time of day it runs. The
 * floor is the UTC date of (now minus 30 days), and since30 keeps the current
 * clock time, so in Mountain time a run before 18:00 MDT (17:00 MST) floors on
 * the date 30 days back and a run after it floors on the date 29 days back.
 * A morning run therefore covers 30 days plus today, and only an evening run
 * covers 29 plus today. Wilson has 31 rows, 2026-08-16 to 2026-09-15, and the
 * 18:27 MDT run that this key was built from summed 30 of them. That is the
 * exporter's existing behaviour, left alone on purpose; this key is what makes
 * it visible.
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A daily series can skip days. A profile Google reported nothing for, or a
 * sync that missed a night, leaves a hole, and a week of holes is still a
 * daily series rather than a new shape.
 */
const DAILY_MAX_GAP_DAYS = 7;

/**
 * The shortest possible distance between two month starts (Feb 1 to Mar 1 in a
 * common year). Anything shorter than this cannot be two consecutive monthly
 * aggregates.
 */
const MONTHLY_MIN_GAP_DAYS = 28;

const MS_PER_DAY = 86_400_000;

/** Whole days between two "YYYY-MM-DD" strings, read as UTC dates. */
function daysBetween(earlier: string, later: string): number {
  const utc = (day: string): number => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return (utc(later) - utc(earlier)) / MS_PER_DAY;
}

/**
 * Daily rows and month-start aggregates, told apart by the gaps between the
 * days present rather than by how many rows a calendar month holds.
 *
 * "some rows are dated the 1st" cannot be the test: every daily window that
 * crosses a month boundary contains one, so Wilson's Aug 16 to Sep 15 would
 * read as mixed. Neither can "a month holding exactly one row, and that row
 * its 1st", which is what this used to do: a nightly export fires once a month
 * on a day whose window ends on the 1st (Aug 3 to Sep 1), September then holds
 * exactly one row, it is the 1st, and a plainly daily window came back mixed.
 * The same misread hit Feb 1 to Mar 1 and the two-row pair Aug 31 plus Sep 1.
 *
 * What actually separates the two shapes is spacing. Daily rows sit a day or a
 * few apart; monthly aggregates sit a month apart and always land on a 1st. So
 * the verdict reads the gaps between neighbouring days:
 *
 *   daily    every gap is DAILY_MAX_GAP_DAYS or fewer
 *   monthly  every row is dated the 1st and every gap is at least
 *            MONTHLY_MIN_GAP_DAYS
 *   mixed    anything else, which is what a history that was aggregated once
 *            and is now collected daily looks like
 *
 * One row, dated the 1st, is genuinely ambiguous: it is both the first day of
 * a daily series and a whole-month aggregate, it has no gaps to judge, and the
 * data cannot say which. Both tests pass on it vacuously, so the order of the
 * two below is the tie-break: monthly is asked first, and monthly is the
 * documented answer. A lone row on any other day is daily.
 */
function classify(days: string[]): MetricsGranularity {
  const distinct = [...new Set(days)].sort();
  if (distinct.length === 0) return "none";

  const gaps: number[] = [];
  for (let i = 1; i < distinct.length; i++) {
    gaps.push(daysBetween(distinct[i - 1], distinct[i]));
  }

  const everyRowIsAMonthStart = distinct.every((day) => day.endsWith("-01"));
  if (everyRowIsAMonthStart && gaps.every((gap) => gap >= MONTHLY_MIN_GAP_DAYS)) {
    return "monthly";
  }

  if (gaps.every((gap) => gap <= DAILY_MAX_GAP_DAYS)) return "daily";

  return "mixed";
}

/**
 * The window a set of DailyMetric rows covers, for the `metricsWindow` key of
 * the profile export.
 *
 * `dates` are the `date` values of the rows the query returned, in any order.
 * `since` is the query's lower bound and `until` is today; both are instants
 * off the local clock, not row dates, and they format by different rules (see
 * above). Pure: no clock of its own, so a test can pin every value.
 */
export function describeMetricsWindow(
  dates: Date[],
  since: Date,
  until: Date
): MetricsWindow {
  const bounds = {
    since: formatDateISO(since),
    until: formatLocalDate(until),
    rows: dates.length,
  };

  if (dates.length === 0) {
    return { ...bounds, firstRow: null, lastRow: null, granularity: "none" };
  }

  // Formatted first, then sorted: the strings are what the caller will read,
  // so classifying and ordering them keeps display and verdict from drifting.
  const days = dates.map(formatDateISO).sort();

  return {
    ...bounds,
    firstRow: days[0],
    lastRow: days[days.length - 1],
    granularity: classify(days),
  };
}
