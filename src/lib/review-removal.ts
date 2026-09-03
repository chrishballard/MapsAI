/**
 * Marker written to ReviewResponse.errorMessage when the publish worker
 * skips a reply because Google no longer has the review. The review sync
 * looks for exactly this text when a review reappears, so it can put the
 * reply back on the approved track — a skip for any other reason (someone
 * else replied first, for instance) is left alone.
 */
export const REVIEW_REMOVED_SKIP_MESSAGE =
  "Review no longer exists on Google — skipped";
