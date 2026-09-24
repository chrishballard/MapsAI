/**
 * Shared message for every review action refused because the profile has
 * review management turned off (Profile.reviewsEnabled = false).
 */
export const REVIEWS_DISABLED_ERROR =
  "Review management is turned off for this business. Turn Reviews back on to draft, approve, or publish replies.";

/** HTTP status used when a review action is refused for that reason. */
export const REVIEWS_DISABLED_STATUS = 409;

/**
 * Cap on the operator's "Train RankMaps" instructions.
 *
 * Lives here rather than next to the prompt so the settings route can
 * validate against it without pulling in the Anthropic client.
 */
export const MAX_REVIEW_INSTRUCTIONS_CHARS = 2000;

/**
 * Google Business Profile caps a review reply at 4096 bytes (UTF-8). Lives
 * here so the edit route and the dashboard editor can check it without
 * pulling in the Anthropic client.
 */
export const GBP_REPLY_MAX_BYTES = 4096;
