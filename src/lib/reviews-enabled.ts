/**
 * Shared message for every review action refused because the profile has
 * review management turned off (Profile.reviewsEnabled = false).
 */
export const REVIEWS_DISABLED_ERROR =
  "Review management is turned off for this business. Turn Reviews back on to draft, approve, or publish replies.";

/** HTTP status used when a review action is refused for that reason. */
export const REVIEWS_DISABLED_STATUS = 409;
