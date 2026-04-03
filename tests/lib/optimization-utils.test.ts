import { describe, it, expect } from 'vitest';
import {
  sortByStatusPriority,
  STATUS_COLORS,
  isPending,
  getPendingCount,
} from '@/lib/optimization-utils';
import type { ScoreCheck } from '@/lib/optimization-score';

// Helpers
function makeCheck(status: 'good' | 'warning' | 'critical', signal = 'Test'): ScoreCheck {
  return {
    signal,
    score: 10,
    max: 20,
    status,
    value: 'test',
    benchmark: 'test benchmark',
    recommendation: 'do something',
  };
}

describe('sortByStatusPriority', () => {
  it('returns empty array for empty input', () => {
    expect(sortByStatusPriority([])).toEqual([]);
  });

  it('sorts critical first, warning second, good last', () => {
    const input = [
      makeCheck('good', 'A'),
      makeCheck('critical', 'B'),
      makeCheck('warning', 'C'),
    ];
    const result = sortByStatusPriority(input);
    expect(result[0].status).toBe('critical');
    expect(result[1].status).toBe('warning');
    expect(result[2].status).toBe('good');
  });

  it('preserves original order for checks with the same status', () => {
    const input = [
      makeCheck('critical', 'First'),
      makeCheck('critical', 'Second'),
      makeCheck('good', 'Third'),
    ];
    const result = sortByStatusPriority(input);
    expect(result[0].signal).toBe('First');
    expect(result[1].signal).toBe('Second');
    expect(result[2].signal).toBe('Third');
  });

  it('does not mutate the original array', () => {
    const input = [makeCheck('good'), makeCheck('critical')];
    const original = [...input];
    sortByStatusPriority(input);
    expect(input[0].status).toBe(original[0].status);
    expect(input[1].status).toBe(original[1].status);
  });
});

describe('STATUS_COLORS', () => {
  it('has correct border color for good', () => {
    expect(STATUS_COLORS.good.border).toBe('border-l-emerald-500');
  });

  it('has correct border color for warning', () => {
    expect(STATUS_COLORS.warning.border).toBe('border-l-amber-500');
  });

  it('has correct border color for critical', () => {
    expect(STATUS_COLORS.critical.border).toBe('border-l-red-500');
  });

  it('has correct badge classes for good', () => {
    expect(STATUS_COLORS.good.badge).toBe('bg-emerald-100 text-emerald-700');
  });

  it('has correct badge classes for warning', () => {
    expect(STATUS_COLORS.warning.badge).toBe('bg-yellow-100 text-yellow-700');
  });

  it('has correct badge classes for critical', () => {
    expect(STATUS_COLORS.critical.badge).toBe('bg-red-100 text-red-700');
  });
});

describe('isPending', () => {
  it('returns true when not approved and not pushed', () => {
    expect(isPending({ isApproved: false, isPushed: false })).toBe(true);
  });

  it('returns false when approved but not pushed', () => {
    expect(isPending({ isApproved: true, isPushed: false })).toBe(false);
  });

  it('returns false when pushed but not approved', () => {
    expect(isPending({ isApproved: false, isPushed: true })).toBe(false);
  });

  it('returns false when both approved and pushed', () => {
    expect(isPending({ isApproved: true, isPushed: true })).toBe(false);
  });
});

describe('getPendingCount', () => {
  it('returns 0 for empty array', () => {
    expect(getPendingCount([])).toBe(0);
  });

  it('counts items where isPending is true', () => {
    const items = [
      { isApproved: false, isPushed: false }, // pending
      { isApproved: true, isPushed: false },  // not pending
      { isApproved: false, isPushed: false }, // pending
      { isApproved: true, isPushed: true },   // not pending
    ];
    expect(getPendingCount(items)).toBe(2);
  });

  it('returns 1 for mixed set with one pending', () => {
    const items = [
      { isApproved: false, isPushed: false },
      { isApproved: true, isPushed: false },
    ];
    expect(getPendingCount(items)).toBe(1);
  });

  it('returns 0 when all items are approved or pushed', () => {
    const items = [
      { isApproved: true, isPushed: false },
      { isApproved: false, isPushed: true },
      { isApproved: true, isPushed: true },
    ];
    expect(getPendingCount(items)).toBe(0);
  });
});
