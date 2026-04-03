import type { ScoreCheck, ScoreStatus } from '@/lib/optimization-score';

// D-05: priority order for sorting checks — critical first, warning second, good last
const STATUS_PRIORITY: Record<ScoreStatus, number> = {
  critical: 0,
  warning: 1,
  good: 2,
};

/**
 * Sort ScoreCheck[] by status priority: critical → warning → good.
 * Stable sort — checks with the same status preserve their original order.
 * Does not mutate the input array.
 */
export function sortByStatusPriority(checks: ScoreCheck[]): ScoreCheck[] {
  return [...checks].sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
  );
}

/**
 * Tailwind class mappings per ScoreStatus — used by audit cards and badges.
 * border-l-* classes apply to left-border accent on card rows.
 * badge classes apply to status pills.
 */
export const STATUS_COLORS = {
  good: { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  warning: { border: 'border-l-amber-500', badge: 'bg-yellow-100 text-yellow-700' },
  critical: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700' },
} as const;

/**
 * Returns true when an item has neither been approved nor pushed to GBP.
 * Used to identify items that still need action.
 */
export function isPending(item: { isApproved: boolean; isPushed: boolean }): boolean {
  return !item.isApproved && !item.isPushed;
}

/**
 * Returns the count of items where isPending is true.
 */
export function getPendingCount(
  items: Array<{ isApproved: boolean; isPushed: boolean }>
): number {
  return items.filter(isPending).length;
}

/**
 * Hex color values for SVG/chart fills, keyed by ScoreGrade.
 * Use these for recharts or any context where Tailwind classes won't work.
 */
export const GRADE_COLORS = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
} as const;
