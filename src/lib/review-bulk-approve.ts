import { ratingNotIgnoredFilter } from "./review-reply-mode";

/**
 * The reviews Approve all publishes for one profile: live drafts only.
 * Reviews already replied to outside RankMaps, reviews removed on Google,
 * and ratings set to Ignore are left out (Ignore drafts are hidden from
 * the pending queue, so Approve all must not publish them behind the
 * operator's back).
 *
 * The dashboard counts with this same filter, so the number the operator
 * types to confirm is the number the route will approve.
 */
export function bulkApprovableReviewsWhere(profileId: string) {
  return {
    profileId,
    repliedExternally: false,
    removedAt: null,
    response: { status: "DRAFTED" as const },
    ...ratingNotIgnoredFilter(),
  };
}
