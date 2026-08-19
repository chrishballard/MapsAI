/**
 * Per-star review reply handling ("star reply modes").
 *
 * Each Profile carries one mode per star rating (reviewReplyMode1..5)
 * deciding what happens when a new review comes in at that rating:
 *
 * - IGNORE: store the review only — never draft or publish a reply
 * - DRAFT:  draft an AI reply that waits for the operator's approval
 * - AUTO:   draft, auto-approve, and publish without waiting
 *
 * Profile.reviewsEnabled=false overrides all five — with reviews off,
 * nothing is synced, drafted, or published at any rating.
 *
 * Kept free of server-only imports so client components can share the
 * constants and labels.
 */

export const REVIEW_REPLY_MODES = ["IGNORE", "DRAFT", "AUTO"] as const;
export type ReviewReplyMode = (typeof REVIEW_REPLY_MODES)[number];

export const STAR_RATINGS = [1, 2, 3, 4, 5] as const;
export type StarRating = (typeof STAR_RATINGS)[number];

/** The Profile column holding the mode for each star rating. */
export const REPLY_MODE_FIELDS = {
  1: "reviewReplyMode1",
  2: "reviewReplyMode2",
  3: "reviewReplyMode3",
  4: "reviewReplyMode4",
  5: "reviewReplyMode5",
} as const satisfies Record<StarRating, string>;

/** The five per-star mode columns as they appear on Profile. */
export interface StarReplyModes {
  reviewReplyMode1: ReviewReplyMode;
  reviewReplyMode2: ReviewReplyMode;
  reviewReplyMode3: ReviewReplyMode;
  reviewReplyMode4: ReviewReplyMode;
  reviewReplyMode5: ReviewReplyMode;
}

/** Operator-facing dropdown labels for the three modes. */
export const REVIEW_REPLY_MODE_LABELS: Record<ReviewReplyMode, string> = {
  IGNORE: "Ignore — no reply",
  DRAFT: "Draft a reply for your approval",
  AUTO: "Reply automatically",
};

/**
 * The mode that applies to a review at the given star rating. Ratings are
 * clamped into 1-5 so a malformed value can never crash the pipeline.
 */
export function replyModeForRating(
  profile: StarReplyModes,
  rating: number
): ReviewReplyMode {
  const clamped = Math.min(5, Math.max(1, Math.round(rating))) as StarRating;
  return profile[REPLY_MODE_FIELDS[clamped]];
}

/** The five modes as a record keyed by star rating, for UI state. */
export function replyModesRecord(
  profile: StarReplyModes
): Record<StarRating, ReviewReplyMode> {
  return {
    1: profile.reviewReplyMode1,
    2: profile.reviewReplyMode2,
    3: profile.reviewReplyMode3,
    4: profile.reviewReplyMode4,
    5: profile.reviewReplyMode5,
  };
}

/**
 * Prisma where-fragment for Review queries: excludes reviews whose star
 * rating is set to IGNORE on their profile. Spread into a ReviewWhereInput
 * wherever "pending" review work is listed or counted, so ignored ratings
 * never surface as work to do.
 */
export function ratingNotIgnoredFilter() {
  return {
    NOT: {
      OR: [
        { rating: 1, profile: { reviewReplyMode1: "IGNORE" as const } },
        { rating: 2, profile: { reviewReplyMode2: "IGNORE" as const } },
        { rating: 3, profile: { reviewReplyMode3: "IGNORE" as const } },
        { rating: 4, profile: { reviewReplyMode4: "IGNORE" as const } },
        { rating: 5, profile: { reviewReplyMode5: "IGNORE" as const } },
      ],
    },
  };
}
