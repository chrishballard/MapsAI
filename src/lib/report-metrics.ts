import { formatDateISO, getNextDayStart } from "./dates";
// All date math uses UTC to match PostgreSQL datetime storage
// D-03: Defaults to last 30 days when no params
// D-04: Prior period = preceding equal-length period

export interface AggregatedMetrics {
  searchImpressions: number;
  mapsImpressions: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
}

export interface SparklinePoint {
  date: string; // "YYYY-MM-DD"
  value: number;
}

export interface ActionLogItem {
  id: string;
  label: string;
  profileName: string;
  time: Date;
  type: "post" | "review_reply" | "description";
}

/** True when s is a YYYY-MM-DD string that parses to a real UTC date. */
function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  // Round-trip: V8 rolls over out-of-range days (2026-02-31 → Mar 3)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Returns resolved { from, to } date strings in YYYY-MM-DD format.
 * Per D-03: defaults to last 30 days when params are undefined.
 * Params come straight from user-controlled searchParams, so anything
 * malformed falls back to the default range instead of crashing downstream.
 */
export function computeDateRange(
  from?: string,
  to?: string
): { from: string; to: string } {
  if (from && to && isValidDateString(from) && isValidDateString(to)) {
    return { from, to };
  }
  const now = new Date();
  const todayStr = formatDateISO(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromStr = formatDateISO(thirtyDaysAgo);
  return { from: fromStr, to: todayStr };
}

/**
 * Returns the preceding equal-length period.
 * Per D-04: priorTo = from - 1 day, priorFrom = priorTo - (to - from)
 */
export function computePriorPeriod(
  from: Date,
  to: Date
): { priorFrom: Date; priorTo: Date } {
  const length = to.getTime() - from.getTime();
  const priorTo = new Date(from.getTime() - 86400000);
  const priorFrom = new Date(priorTo.getTime() - length);
  return { priorFrom, priorTo };
}

/**
 * Aggregates daily metrics by summing desktop+mobile into separate search and maps totals.
 * Extends the sumMetrics pattern from report-generator.ts but keeps search and maps separate.
 */
export function aggregateDailyMetrics(
  metrics: Array<{
    impressionsSearchDesktop: number;
    impressionsSearchMobile: number;
    impressionsMapsDesktop: number;
    impressionsMapsMobile: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
  }>
): AggregatedMetrics {
  return metrics.reduce(
    (acc, m) => ({
      searchImpressions:
        acc.searchImpressions + m.impressionsSearchDesktop + m.impressionsSearchMobile,
      mapsImpressions:
        acc.mapsImpressions + m.impressionsMapsDesktop + m.impressionsMapsMobile,
      websiteClicks: acc.websiteClicks + m.websiteClicks,
      callClicks: acc.callClicks + m.callClicks,
      directionRequests: acc.directionRequests + m.directionRequests,
    }),
    {
      searchImpressions: 0,
      mapsImpressions: 0,
      websiteClicks: 0,
      callClicks: 0,
      directionRequests: 0,
    }
  );
}

// A type alias, not an interface, so it stays assignable to
// computeSparklineData's index-signature parameter.
export type DailyMetricCounts = {
  date: Date;
  impressionsSearchDesktop: number;
  impressionsSearchMobile: number;
  impressionsMapsDesktop: number;
  impressionsMapsMobile: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
};

/**
 * Collapses DailyMetric rows to one per day, summing every count, oldest first.
 * A range across all profiles holds one row per profile per day; charted
 * as-is that draws N points per date instead of the day's total.
 */
export function sumDailyMetricsByDate(
  metrics: DailyMetricCounts[]
): DailyMetricCounts[] {
  const byDate = new Map<string, DailyMetricCounts>();
  for (const m of metrics) {
    const key = formatDateISO(m.date);
    const day = byDate.get(key);
    if (!day) {
      byDate.set(key, {
        date: m.date,
        impressionsSearchDesktop: m.impressionsSearchDesktop,
        impressionsSearchMobile: m.impressionsSearchMobile,
        impressionsMapsDesktop: m.impressionsMapsDesktop,
        impressionsMapsMobile: m.impressionsMapsMobile,
        websiteClicks: m.websiteClicks,
        callClicks: m.callClicks,
        directionRequests: m.directionRequests,
      });
      continue;
    }
    day.impressionsSearchDesktop += m.impressionsSearchDesktop;
    day.impressionsSearchMobile += m.impressionsSearchMobile;
    day.impressionsMapsDesktop += m.impressionsMapsDesktop;
    day.impressionsMapsMobile += m.impressionsMapsMobile;
    day.websiteClicks += m.websiteClicks;
    day.callClicks += m.callClicks;
    day.directionRequests += m.directionRequests;
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, day]) => day);
}

/**
 * Google posts performance numbers a few days late, and the metrics sync
 * stores a row of zeros for each day it hasn't reported yet (the same lag
 * scripts/perf-snapshot.ts allows for).
 */
export const REPORTING_LAG_DAYS = 5;

/**
 * The newest day with any count in it, or null. The trailing all-zero rows
 * are days Google hasn't reported yet, not days with no activity.
 */
export function lastReportedDay(metrics: DailyMetricCounts[]): Date | null {
  const reported = metrics.findLast(
    (m) =>
      m.impressionsSearchDesktop +
        m.impressionsSearchMobile +
        m.impressionsMapsDesktop +
        m.impressionsMapsMobile +
        m.websiteClicks +
        m.callClicks +
        m.directionRequests >
      0
  );
  return reported?.date ?? null;
}

/**
 * Returns Math.round(((current - previous) / previous) * 100) or null if previous === 0.
 */
export function computePctChange(
  current: number,
  previous: number
): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Extracts daily values for a single metric field, sorted by date ascending.
 * Date formatted as YYYY-MM-DD using UTC.
 */
export function computeSparklineData(
  metrics: Array<{ date: Date; [key: string]: unknown }>,
  field: "callClicks" | "websiteClicks" | "directionRequests"
): SparklinePoint[] {
  return metrics
    .map((m) => ({
      date: formatDateISO(m.date as Date),
      value: m[field] as number,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A `where` range for timestamps falling on the days from..to, where both are
 * UTC midnights and `to` is the range's last day. `lte: to` stopped at 00:00
 * on that day and dropped the rest of it: reviews, posts and replies from a
 * month's last day were missing from its report. (DailyMetric.date is a day,
 * not a timestamp; `lte: to` is right for it.)
 */
export function onDays(from: Date, to: Date) {
  return { gte: from, lt: getNextDayStart(to) };
}

/**
 * ReviewResponse `where` for replies that went live on the days from..to, by
 * the same rule buildActionsLog dates them with: publishedAt, or createdAt
 * for a published row that has no publishedAt.
 */
export function replyPublishedBetween(from: Date, to: Date) {
  const days = onDays(from, to);
  return {
    OR: [
      { publishedAt: days },
      { publishedAt: null, createdAt: days },
    ],
  };
}

/**
 * Builds action log items from Post, ReviewResponse, and ProfileDescription arrays,
 * filtered to the days from..to (the whole of the last day, as onDays).
 * Per D-14 and research: services and attributes are NOT trackable (no timestamp fields).
 * NO .slice() limit — returns all items in range, sorted newest-first.
 * A review reply is dated by when it went live (publishedAt), not when it was
 * drafted: a draft can wait days for approval, across a month boundary.
 */
export function buildActionsLog(
  posts: Array<{
    id: string;
    status: string;
    publishedAt: Date | null;
    profile: { name: string };
  }>,
  responses: Array<{
    id: string;
    status: string;
    publishedAt: Date | null;
    createdAt: Date;
    review: { profile: { name: string } };
  }>,
  descriptions: Array<{
    id: string;
    pushedAt: Date | null;
    profile: { name: string };
  }>,
  from: Date,
  to: Date
): ActionLogItem[] {
  const end = getNextDayStart(to);
  const postItems: ActionLogItem[] = posts
    .filter(
      (p) =>
        p.status === "PUBLISHED" &&
        p.publishedAt !== null &&
        p.publishedAt >= from &&
        p.publishedAt < end
    )
    .map((p) => ({
      id: p.id,
      label: "Published post",
      profileName: p.profile.name,
      time: p.publishedAt!,
      type: "post" as const,
    }));

  const responseItems: ActionLogItem[] = responses
    .map((r) => ({ r, time: r.publishedAt ?? r.createdAt }))
    .filter(
      ({ r, time }) => r.status === "PUBLISHED" && time >= from && time < end
    )
    .map(({ r, time }) => ({
      id: r.id,
      label: "Published review reply",
      profileName: r.review.profile.name,
      time,
      type: "review_reply" as const,
    }));

  const descriptionItems: ActionLogItem[] = descriptions
    .filter(
      (d) =>
        d.pushedAt !== null &&
        d.pushedAt >= from &&
        d.pushedAt < end
    )
    .map((d) => ({
      id: d.id,
      label: "Pushed description",
      profileName: d.profile.name,
      time: d.pushedAt!,
      type: "description" as const,
    }));

  return [...postItems, ...responseItems, ...descriptionItems].sort(
    (a, b) => b.time.getTime() - a.time.getTime()
  );
}
