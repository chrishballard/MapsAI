// All date math uses UTC to match PostgreSQL datetime storage
// D-08: Rolling 30-day window for trend calculation
// D-09/D-10: Recency thresholds: good 0-14 days, warning 15-30 days, critical 31+

export interface TrendResult {
  current: number;
  prior: number;
  pct: number | null;
}

export interface RatingPoint {
  star: number;
  count: number;
}

export interface MonthlyDataPoint {
  month: string;    // "Jan 2026" — formatted for X-axis display
  sortKey: string;  // "2026-01" — for sorting
  volume: number;
  avgRating: number | null;  // null when no reviews — chart should skip, not drop to 0
}

export interface RecencyStatus {
  status: "good" | "warning" | "critical";
  color: string;
  message: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Computes period-over-period review trend using rolling 30-day windows.
 * current = reviews in last 30 days
 * prior = reviews in 31-60 days ago window
 * pct = null if prior === 0, otherwise Math.round((current - prior) / prior * 100)
 */
export function computeTrend(
  reviews: Array<{ reviewDate: Date }>,
  now: Date
): TrendResult {
  const cutoff = new Date(now.getTime() - THIRTY_DAYS_MS);
  const priorCutoff = new Date(now.getTime() - 2 * THIRTY_DAYS_MS);

  const current = reviews.filter(r => r.reviewDate >= cutoff).length;
  const prior = reviews.filter(
    r => r.reviewDate >= priorCutoff && r.reviewDate < cutoff
  ).length;

  const pct = prior === 0 ? null : Math.round(((current - prior) / prior) * 100);

  return { current, prior, pct };
}

/**
 * Groups reviews by star rating into 5 buckets ordered 5 to 1.
 * Returns array suitable for horizontal bar chart (top-to-bottom per D-05).
 */
export function computeRatingDistribution(
  reviews: Array<{ rating: number }>
): RatingPoint[] {
  const dist = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0], [1, 0]]);
  for (const r of reviews) {
    const rounded = Math.round(r.rating);
    if (rounded >= 1 && rounded <= 5) {
      dist.set(rounded, (dist.get(rounded) ?? 0) + 1);
    }
  }
  return [5, 4, 3, 2, 1].map(star => ({ star, count: dist.get(star) ?? 0 }));
}

/**
 * Groups reviews into 12 monthly UTC buckets for trend visualization.
 * All date operations use UTC to match PostgreSQL storage.
 * Returns buckets sorted oldest to newest (left-to-right for chart).
 */
export function computeMonthlyData(
  reviews: Array<{ reviewDate: Date; rating: number }>,
  now: Date
): MonthlyDataPoint[] {
  // Build 12-month bucket map (UTC) — oldest first
  const buckets = new Map<string, { count: number; ratingSum: number }>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { count: 0, ratingSum: 0 });
  }

  // Bucket each review by UTC year-month
  for (const r of reviews) {
    const y = r.reviewDate.getUTCFullYear();
    const m = String(r.reviewDate.getUTCMonth() + 1).padStart(2, "0");
    const key = `${y}-${m}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.ratingSum += r.rating;
    }
  }

  return Array.from(buckets.entries()).map(([key, b]) => ({
    sortKey: key,
    month: new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
    volume: b.count,
    avgRating: b.count > 0 ? Math.round((b.ratingSum / b.count) * 10) / 10 : null,
  }));
}

/**
 * Returns number of full days between date and now.
 * Returns null if date is null (no reviews yet).
 */
export function computeDaysSince(date: Date | null, now: Date): number | null {
  if (date === null) return null;
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Classifies review recency into good/warning/critical with color and message.
 * Per D-09/D-10:
 *   null         => critical (no reviews ever)
 *   0-14 days    => good (Profile is active)
 *   15-30 days   => warning (Consider requesting reviews)
 *   31+ days     => critical (No reviews in over a month)
 */
export function getRecencyStatus(daysSince: number | null): RecencyStatus {
  if (daysSince === null) {
    return { status: "critical", color: "red", message: "No reviews yet" };
  }
  if (daysSince <= 14) {
    return { status: "good", color: "green", message: "Profile is active" };
  }
  if (daysSince <= 30) {
    return { status: "warning", color: "amber", message: "Consider requesting reviews" };
  }
  return { status: "critical", color: "red", message: "No reviews in over a month" };
}

/**
 * Formats a date as "Data through Mar 31, 2026" for the page-level label.
 * Per D-13: uses UTC timezone to match data storage.
 */
export function formatDataThrough(date: Date): string {
  return "Data through " + date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
