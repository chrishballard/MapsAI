/**
 * Marker written to ReviewResponse.errorMessage when the publish worker
 * skips a reply because Google no longer has the review. The review sync
 * looks for exactly this text when a review reappears, so it can put the
 * reply back on the approved track — a skip for any other reason (someone
 * else replied first, for instance) is left alone.
 */
export const REVIEW_REMOVED_SKIP_MESSAGE =
  "Review no longer exists on Google — skipped";

/**
 * Thrown by fetchSingleReview when *every* endpoint it tried answered 404.
 * A 404 from only one of them (the other 403/5xx) is not proof the review
 * is gone, so it is rethrown as an ordinary error and the job retries.
 */
export class ReviewNotFoundError extends Error {
  readonly notFound = true as const;
  constructor(reviewResourceName: string) {
    super(`Review not found on Google: ${reviewResourceName}`);
    this.name = "ReviewNotFoundError";
  }
}

export function isReviewNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { notFound?: unknown }).notFound === true
  );
}
