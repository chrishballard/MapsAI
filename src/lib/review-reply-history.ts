import { prisma } from "./prisma";
import type { EarlierReply } from "./review-reply-repeats";

// Newest first. Plenty for the repeat check on any profile we run, and it keeps
// the query small on the ones with thousands of reviews.
const MAX_EARLIER_REPLIES = 500;

/**
 * What a profile has already said to its reviewers, newest first. Replies that
 * are out or on their way (APPROVED, PUBLISHED); with includeDrafts, waiting
 * drafts too, for writing a new reply that won't collide with them.
 *
 * Reviews removed on Google and reviews answered outside RankMaps are left out:
 * their replies aren't ours to compare against. A reply the office wrote on
 * Google isn't stored at all, so this can't see those.
 */
export async function earlierRepliesForProfile(
  profileId: string,
  options: { excludeReviewId?: string; includeDrafts?: boolean } = {}
): Promise<EarlierReply[]> {
  const rows = await prisma.reviewResponse.findMany({
    where: {
      status: {
        in: options.includeDrafts
          ? ["DRAFTED", "APPROVED", "PUBLISHED"]
          : ["APPROVED", "PUBLISHED"],
      },
      review: {
        profileId,
        removedAt: null,
        repliedExternally: false,
        ...(options.excludeReviewId ? { id: { not: options.excludeReviewId } } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_EARLIER_REPLIES,
    select: {
      content: true,
      review: { select: { reviewerName: true, comment: true } },
    },
  });

  return rows.map((row) => ({
    content: row.content,
    reviewerName: row.review.reviewerName,
    ratingOnly: !row.review.comment,
  }));
}
