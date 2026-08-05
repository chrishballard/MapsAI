/**
 * Shared date helpers. All month math uses UTC — DailyMetric.date,
 * MonthlyKeyword.month, and Report.month are stored as UTC dates, so
 * month boundaries computed in local time silently miss rows.
 */

/** First of the month (UTC midnight). `offsetMonths` shifts the month, e.g. -1 for the previous month. */
export function getMonthStart(date: Date = new Date(), offsetMonths = 0): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1)
  );
}

/** Last day of the month (UTC midnight). */
export function getMonthEnd(date: Date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  );
}

/** "2026-07-09" */
export function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "2026-07" */
export function formatMonthISO(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** "July 2026" — UTC, so UTC month-start dates render as the right month in every timezone. */
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Jul 2026" — UTC, for month-bucket labels. */
export function formatShortMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Jul 9, 2026" — local time, for timestamps (createdAt etc.). */
export function formatMediumDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
