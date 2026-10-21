import { describe, it, expect } from 'vitest';
import {
  deleteGroups,
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
    // Each planned row carries the value it was planned at, so apply can
    // refuse a row the sync has since rewritten with a real count.
    expect(plan.rows).toEqual([{ id: 'k2', impressions: 15 }]);
  });

  it('treats a keyword Google lists twice for the month as unverified', () => {
    const plan = planThresholdCleanup(
      [{ id: 'k2', keyword: 'gutter guards near me', impressions: 15 }],
      [
        { keyword: 'gutter guards near me', value: 15, threshold: null },
        { keyword: 'gutter guards near me', value: null, threshold: 15 },
      ]
    );
    expect(plan.deleteIds).toEqual([]);
    expect(plan.unverified).toBe(1);
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

describe('deleteGroups', () => {
  it('groups planned rows by the value they must still hold', () => {
    expect(
      deleteGroups([
        { id: 'a', impressions: 15 },
        { id: 'b', impressions: 15 },
        { id: 'c', impressions: 10 },
      ])
    ).toEqual([
      { impressions: 15, ids: ['a', 'b'] },
      { impressions: 10, ids: ['c'] },
    ]);
  });
});

describe('renderDeleteSql', () => {
  it('names every id, quoted, with the value each must still hold', () => {
    expect(renderDeleteSql([{ id: 'k2', impressions: 15 }, { id: "o'k", impressions: 15 }])).toBe(
      `DELETE FROM "MonthlyKeyword" WHERE "impressions" = 15 AND "id" IN ('k2', 'o''k');`
    );
  });

  it('renders nothing to run for an empty plan', () => {
    expect(renderDeleteSql([])).toBe('-- nothing to delete');
  });
});
