/**
 * The month buckets, trend and highlight lines behind `rankmaps perf`
 * (scripts/client-perf.ts), whose highlights get pasted into client emails.
 *
 * Kept out of client-perf.ts because that script calls main() at import time,
 * so a test cannot reach a helper defined next to it (same reason as
 * metrics-window.ts). Pure: the clock comes in as `now`.
 *
 * Three things this used to get wrong, each of which put a wrong number in
 * front of a client:
 *
 * - Every month was pre-filled with zeros, so a month from before the
 *   profile's metrics history began counted as a real month of nothing. It
 *   dragged the "prior 4-month average" down (a flat month read as +100%) and
 *   could be named the "Lowest" month. Each month now says how many days of
 *   data it holds, and only fully synced months are averaged or ranked.
 * - A rise from an average of zero came out as "flat". It now reads "up from 0".
 * - "Last complete month" came from the UTC month, so an evening run on the
 *   last day of a month (after 18:00 MDT) treated that unfinished month as
 *   complete. The month is now read off the operator's calendar, as
 *   metrics-window.ts reads `until`.
 */
import { formatLocalDate } from "./metrics-window";

export interface DailyMetricRow {
  date: Date;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
  impressionsSearchDesktop: number;
  impressionsSearchMobile: number;
  impressionsMapsDesktop: number;
  impressionsMapsMobile: number;
}

export type Metric = {
  month: string;
  monthLabel: string;
  isPartial: boolean;
  /** Distinct days in this month with a synced row. 0 = no data at all. */
  daysWithData: number;
  daysInMonth: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
  searchImpressions: number;
  mapsImpressions: number;
  totalImpressions: number;
};

const TREND_METRICS = [
  "callClicks",
  "websiteClicks",
  "directionRequests",
  "totalImpressions",
] as const;
type TrendMetric = (typeof TREND_METRICS)[number];

export type Trend = {
  comparing: string;
  /** The months actually averaged, oldest first. */
  vsAvgOfPrior: string;
  baselineMonths: number;
  /** Set when the baseline is under 4 months or the compared month is short. */
  baselineNote: string | null;
  excludedFromBaseline: { month: string; reason: string }[];
  /** Plain-English change per metric: "up 12%", "down 3%", "flat", "up from 0". */
  changes: Record<TrendMetric, string>;
} & Record<TrendMetric, number | null>;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Months the trend wants as a baseline. */
const BASELINE_TARGET = 4;

/**
 * A month counts as fully synced at 90% of its days (28 of 31, 27 of 30):
 * a daily series can miss a night, but a month missing more than that was
 * cut by the start of the sync history and would read low.
 */
const FULL_MONTH_SHARE = 0.9;

/**
 * Google posts performance numbers a few days late, and the metrics sync
 * stores a row of zeros for a day it hasn't reported yet. So a month that
 * ended this recently can look fully synced and still read low.
 */
const REPORTING_LAG_DAYS = 5;
const DAY_MS = 86_400_000;

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function daysInUtcMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * The six month window ending in the operator's current month. Returned as
 * midnight-UTC month starts, which is what DailyMetric.date (a @db.Date) is
 * compared and bucketed by.
 */
export function perfWindow(now: Date): { currentMonthStart: Date; windowStart: Date } {
  const currentMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  return { currentMonthStart, windowStart: addMonths(currentMonthStart, -5) };
}

/** null when the baseline is 0 and the month isn't (see describeChange). */
function pct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function describeChange(curr: number, baseline: number): string {
  if (baseline === 0) return curr === 0 ? "flat" : "up from 0";
  const n = pct(curr, baseline)!;
  return n > 0 ? `up ${n}%` : n < 0 ? `down ${Math.abs(n)}%` : "flat";
}

function isFullySynced(m: Metric): boolean {
  return m.daysWithData >= Math.ceil(m.daysInMonth * FULL_MONTH_SHARE);
}

export interface PerfSnapshot {
  window: { from: string; to: string; months: number };
  months: Metric[];
  totals: Omit<Metric, "month" | "monthLabel" | "isPartial" | "daysWithData" | "daysInMonth">;
  trend: Trend | null;
  /** Why there is no trend, when there isn't one. */
  trendUnavailable: string | null;
  highlights: string[];
}

export function buildPerfSnapshot(rows: DailyMetricRow[], now: Date): PerfSnapshot {
  const { currentMonthStart, windowStart } = perfWindow(now);
  const currentKey = currentMonthStart.toISOString().slice(0, 7);

  const buckets = new Map<string, Metric>();
  const days = new Map<string, Set<string>>();
  for (let i = 0; i < 6; i++) {
    const m = addMonths(windowStart, i);
    const key = m.toISOString().slice(0, 7);
    buckets.set(key, {
      month: key,
      monthLabel: `${MONTH_NAMES[m.getUTCMonth()]} ${m.getUTCFullYear()}`,
      isPartial: key === currentKey,
      daysWithData: 0,
      daysInMonth: daysInUtcMonth(m),
      callClicks: 0,
      websiteClicks: 0,
      directionRequests: 0,
      conversations: 0,
      searchImpressions: 0,
      mapsImpressions: 0,
      totalImpressions: 0,
    });
    days.set(key, new Set());
  }

  for (const d of rows) {
    const iso = d.date.toISOString();
    const key = iso.slice(0, 7);
    const b = buckets.get(key);
    if (!b) continue;
    days.get(key)!.add(iso.slice(0, 10));
    b.callClicks += d.callClicks;
    b.websiteClicks += d.websiteClicks;
    b.directionRequests += d.directionRequests;
    b.conversations += d.conversations;
    const search = d.impressionsSearchDesktop + d.impressionsSearchMobile;
    const maps = d.impressionsMapsDesktop + d.impressionsMapsMobile;
    b.searchImpressions += search;
    b.mapsImpressions += maps;
    b.totalImpressions += search + maps;
  }
  for (const [key, set] of days) buckets.get(key)!.daysWithData = set.size;

  const months = Array.from(buckets.values());
  const totals = months.reduce(
    (acc, m) => ({
      callClicks: acc.callClicks + m.callClicks,
      websiteClicks: acc.websiteClicks + m.websiteClicks,
      directionRequests: acc.directionRequests + m.directionRequests,
      conversations: acc.conversations + m.conversations,
      searchImpressions: acc.searchImpressions + m.searchImpressions,
      mapsImpressions: acc.mapsImpressions + m.mapsImpressions,
      totalImpressions: acc.totalImpressions + m.totalImpressions,
    }),
    {
      callClicks: 0, websiteClicks: 0, directionRequests: 0, conversations: 0,
      searchImpressions: 0, mapsImpressions: 0, totalImpressions: 0,
    }
  );

  const completeMonths = months.filter((m) => !m.isPartial);
  const lastComplete = completeMonths[completeMonths.length - 1];
  const priorComplete = completeMonths.slice(0, -1);
  const baseline = priorComplete.filter(isFullySynced);
  const excludedFromBaseline = priorComplete
    .filter((m) => !isFullySynced(m))
    .map((m) => ({
      month: m.monthLabel,
      reason:
        m.daysWithData === 0
          ? "no data synced (before the metrics history starts)"
          : `only ${m.daysWithData} of ${m.daysInMonth} days synced`,
    }));

  let trend: Trend | null = null;
  let trendUnavailable: string | null = null;
  // Anything that undercuts the headline number, said inside that same line:
  // it's the line that gets pasted into a client email.
  const headlineCaveats: string[] = [];
  if (!lastComplete || lastComplete.daysWithData === 0) {
    trendUnavailable = lastComplete
      ? `no data synced for ${lastComplete.monthLabel}`
      : "no complete month in the window";
  } else if (baseline.length === 0) {
    trendUnavailable = `no fully synced month before ${lastComplete.monthLabel} to compare against`;
  } else {
    const notes: string[] = [];
    if (baseline.length < BASELINE_TARGET) {
      notes.push(
        `Baseline is ${baseline.length} month${baseline.length === 1 ? "" : "s"}, not ${BASELINE_TARGET}: the metrics history is shorter than the window.`
      );
    }
    if (!isFullySynced(lastComplete)) {
      notes.push(
        `${lastComplete.monthLabel} has only ${lastComplete.daysWithData} of ${lastComplete.daysInMonth} days synced, so its totals read low.`
      );
      headlineCaveats.push(
        `only ${lastComplete.daysWithData} of ${lastComplete.daysInMonth} days synced`
      );
    }
    // Days from the end of the compared month to today, on the operator's
    // calendar (the same calendar that decided which month is current).
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const monthEnd = Date.UTC(
      Number(lastComplete.month.slice(0, 4)),
      Number(lastComplete.month.slice(5, 7)),
      1
    );
    if ((today - monthEnd) / DAY_MS < REPORTING_LAG_DAYS) {
      notes.push(
        `${lastComplete.monthLabel} only just ended and Google reports a few days late, so its last days may still rise.`
      );
      headlineCaveats.push("numbers may still rise: Google reports a few days late");
    }
    const avg = (metric: TrendMetric) =>
      baseline.reduce((a, m) => a + m[metric], 0) / baseline.length;
    const values = {} as Record<TrendMetric, number | null>;
    const changes = {} as Record<TrendMetric, string>;
    for (const metric of TREND_METRICS) {
      values[metric] = pct(lastComplete[metric], avg(metric));
      changes[metric] = describeChange(lastComplete[metric], avg(metric));
    }
    trend = {
      comparing: lastComplete.monthLabel,
      vsAvgOfPrior: baseline.map((m) => m.monthLabel).join(", "),
      baselineMonths: baseline.length,
      baselineNote: notes.length ? notes.join(" ") : null,
      excludedFromBaseline,
      ...values,
      changes,
    };
  }

  const highlights: string[] = [];
  if (lastComplete && trend) {
    const vs = `vs prior ${trend.baselineMonths}-month avg`;
    const caveat = headlineCaveats.length ? ` (${headlineCaveats.join("; ")})` : "";
    highlights.push(
      `${lastComplete.monthLabel}${caveat}: ${lastComplete.callClicks} calls (${trend.changes.callClicks} ${vs}), ${lastComplete.directionRequests} direction requests (${trend.changes.directionRequests}), ${lastComplete.websiteClicks} website clicks (${trend.changes.websiteClicks}).`
    );
    highlights.push(
      `Total impressions in ${lastComplete.monthLabel}: ${lastComplete.totalImpressions.toLocaleString("en-US")} (${trend.changes.totalImpressions} ${vs}).`
    );
    if (trend.baselineNote) highlights.push(trend.baselineNote);
  }
  // Ranked over fully synced months only: a month before the history began
  // is not the client's lowest month.
  const rankable = completeMonths.filter(isFullySynced);
  if (rankable.length > 1) {
    const best = rankable.reduce((a, b) => (b.callClicks > a.callClicks ? b : a));
    const worst = rankable.reduce((a, b) => (b.callClicks < a.callClicks ? b : a));
    if (best.callClicks !== worst.callClicks) {
      highlights.push(
        `Best month for calls: ${best.monthLabel} (${best.callClicks}). Lowest: ${worst.monthLabel} (${worst.callClicks}).`
      );
    }
  }

  return {
    window: {
      from: windowStart.toISOString().slice(0, 10),
      to: formatLocalDate(now),
      months: months.length,
    },
    months,
    totals,
    trend,
    trendUnavailable,
    highlights,
  };
}
