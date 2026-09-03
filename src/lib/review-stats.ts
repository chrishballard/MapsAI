/**
 * The review count and rating we show or cite for a profile.
 *
 * Google reports its own `totalReviewCount` / `averageRating` for a location
 * on every reviews-list call, and that figure is what Maps and Search show
 * the public. It is the number clients recognize. Our stored rows are a
 * history, not a count: they lag Google's removals and, historically,
 * carried duplicates. So: Google's number whenever the profile has synced
 * one, stored live rows only as a fallback.
 */
export interface ReviewStatsInput {
  googleReviewCount: number | null | undefined;
  googleAverageRating: number | null | undefined;
  /** Stored reviews that Google still returns (removedAt is null). */
  liveReviews: ReadonlyArray<{ rating: number }>;
}

export interface ReviewStats {
  count: number;
  averageRating: number | null;
  source: "google" | "rankmaps";
}

export function resolveReviewStats(input: ReviewStatsInput): ReviewStats {
  if (typeof input.googleReviewCount === "number") {
    return {
      count: input.googleReviewCount,
      averageRating:
        typeof input.googleAverageRating === "number"
          ? input.googleAverageRating
          : null,
      source: "google",
    };
  }
  const count = input.liveReviews.length;
  const averageRating =
    count > 0
      ? input.liveReviews.reduce((sum, r) => sum + r.rating, 0) / count
      : null;
  return { count, averageRating, source: "rankmaps" };
}
