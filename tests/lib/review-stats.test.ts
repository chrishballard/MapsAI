import { describe, it, expect } from 'vitest';
import { resolveReviewStats } from '@/lib/review-stats';

// Client-facing review counts must come from Google's own number for the
// location (what Maps and Search show), never from a count of the rows we
// happen to have stored. Stored rows are only a fallback for profiles that
// have never synced a Google count.

describe('resolveReviewStats', () => {
  it("prefers Google's count and rating when the profile has synced them", () => {
    const stats = resolveReviewStats({
      googleReviewCount: 581,
      googleAverageRating: 4.96,
      liveReviews: Array.from({ length: 590 }, () => ({ rating: 5 })),
    });
    expect(stats).toEqual({
      count: 581,
      averageRating: 4.96,
      source: 'google',
    });
  });

  it('falls back to stored live reviews when Google has not been synced', () => {
    const stats = resolveReviewStats({
      googleReviewCount: null,
      googleAverageRating: null,
      liveReviews: [{ rating: 5 }, { rating: 4 }, { rating: 3 }],
    });
    expect(stats).toEqual({
      count: 3,
      averageRating: 4,
      source: 'rankmaps',
    });
  });

  it('reports a null rating when nothing is stored either', () => {
    const stats = resolveReviewStats({
      googleReviewCount: null,
      googleAverageRating: null,
      liveReviews: [],
    });
    expect(stats).toEqual({ count: 0, averageRating: null, source: 'rankmaps' });
  });

  it('accepts a precomputed live summary instead of the rows', () => {
    const stats = resolveReviewStats({
      googleReviewCount: null,
      googleAverageRating: null,
      liveSummary: { count: 590, averageRating: 4.9 },
    });
    expect(stats).toEqual({ count: 590, averageRating: 4.9, source: 'rankmaps' });
  });

  it("uses Google's count even when Google reports no rating yet", () => {
    const stats = resolveReviewStats({
      googleReviewCount: 0,
      googleAverageRating: null,
      liveReviews: [],
    });
    expect(stats).toEqual({ count: 0, averageRating: null, source: 'google' });
  });
});
