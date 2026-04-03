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

/**
 * Returns resolved { from, to } date strings in YYYY-MM-DD format.
 * Per D-03: defaults to last 30 days when params are undefined.
 */
export function computeDateRange(
  from?: string,
  to?: string
): { from: string; to: string } {
  if (from && to) {
    return { from, to };
  }
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromStr = thirtyDaysAgo.toISOString().slice(0, 10);
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
      date: (m.date as Date).toISOString().slice(0, 10),
      value: m[field] as number,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Builds action log items from Post, ReviewResponse, and ProfileDescription arrays,
 * filtered to the given date range.
 * Per D-14 and research: services and attributes are NOT trackable (no timestamp fields).
 * NO .slice() limit — returns all items in range, sorted newest-first.
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
  const postItems: ActionLogItem[] = posts
    .filter(
      (p) =>
        p.status === "PUBLISHED" &&
        p.publishedAt !== null &&
        p.publishedAt >= from &&
        p.publishedAt <= to
    )
    .map((p) => ({
      id: p.id,
      label: "Published post",
      profileName: p.profile.name,
      time: p.publishedAt!,
      type: "post" as const,
    }));

  const responseItems: ActionLogItem[] = responses
    .filter(
      (r) =>
        r.status === "PUBLISHED" &&
        r.createdAt >= from &&
        r.createdAt <= to
    )
    .map((r) => ({
      id: r.id,
      label: "Published review reply",
      profileName: r.review.profile.name,
      time: r.createdAt,
      type: "review_reply" as const,
    }));

  const descriptionItems: ActionLogItem[] = descriptions
    .filter(
      (d) =>
        d.pushedAt !== null &&
        d.pushedAt >= from &&
        d.pushedAt <= to
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
