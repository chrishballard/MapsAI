/**
 * Stable identity for a Google Business Profile review.
 *
 * The GBP API returns a review's resource name as
 * `accounts/{account}/locations/{location}/reviews/{id}`, but the account
 * segment is mutable: one endpoint fills in the real account id, another
 * returns the `accounts/-` wildcard, and a profile reconnected under a
 * different Google account changes it again. Prod stored the same review
 * twice for exactly that reason. Identity lives in the
 * `locations/.../reviews/...` suffix, so that is the key we match on.
 */
export function normalizeReviewKey(googleReviewId: string): string {
  return googleReviewId.replace(/^accounts\/[^/]+\//, "");
}

/**
 * Rebuild the full resource name Google expects on a call, from the
 * profile's *current* account and the review's normalized key. Falls back
 * to the wildcard account when the profile has none stored.
 */
export function reviewResourceName(
  accountResourceName: string | null | undefined,
  googleReviewKey: string
): string {
  return `${accountResourceName || "accounts/-"}/${googleReviewKey}`;
}
