import { describe, it, expect } from 'vitest';
import {
  planThresholdCleanup,
  renderDeleteSql,
} from '@/lib/keyword-threshold-cleanup';

// Before #15 the metrics sync stored Google's "fewer than N" threshold as a
// keyword's impression count. The rows can't be told apart from real counts
// in the database alone, so the cleanup re-reads each stored month from
// Google and removes only the rows Google reports as threshold-only, whose
// stored count is exactly that threshold.

const stored = [
  { id: 'k1', keyword: 'gutter cleaning', impressions: 240 },
  { id: 'k2', keyword: 'gutter guards near me', impressions: 15 },
  { id: 'k3', keyword: 'leaf guard install', impressions: 15 },
  { id: 'k4', keyword: 'old keyword', impressions: 15 },
];

describe('planThresholdCleanup', () => {
  it('removes only rows Google reports as threshold-only, stored at that threshold', () => {
    const plan = planThresholdCleanup(stored, [
      { keyword: 'gutter cleaning', value: 240, threshold: null },
      { keyword: 'gutter guards near me', value: null, threshold: 15 },
      // Exact now: an older sync may have stored the threshold, but the row
      // gets the real count on the next sync, so it isn't touched here.
      { keyword: 'leaf guard install', value: 15, threshold: null },
    ]);

    expect(plan.deleteIds).toEqual(['k2']);
  });

  it('leaves a row alone when its stored count is not the threshold', () => {
    const plan = planThresholdCleanup(
      [{ id: 'k9', keyword: 'gutter guards near me', impressions: 22 }],
      [{ keyword: 'gutter guards near me', value: null, threshold: 15 }]
    );
    expect(plan.deleteIds).toEqual([]);
  });

  it('leaves alone a keyword Google no longer returns for the month', () => {
    // Nothing to compare it against; it may be a real count.
    const plan = planThresholdCleanup(
      [{ id: 'k4', keyword: 'old keyword', impressions: 15 }],
      []
    );
    expect(plan.deleteIds).toEqual([]);
    expect(plan.unverified).toBe(1);
  });
});

describe('renderDeleteSql', () => {
  it('names every id, quoted, in one statement', () => {
    expect(renderDeleteSql(['k2', "o'k"])).toBe(
      `DELETE FROM "MonthlyKeyword" WHERE "id" IN ('k2', 'o''k');`
    );
  });

  it('renders nothing to run for an empty plan', () => {
    expect(renderDeleteSql([])).toBe('-- nothing to delete');
  });
});
