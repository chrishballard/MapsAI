import { prisma } from "../prisma";
import { fetchReviews, STAR_RATING_MAP } from "../google-reviews";
import { generateReviewResponse } from "../review-responder";
import { scheduleReviewPublish } from "../queue/review-publish-queue";

interface ReviewSyncProfile {
  id: string;
  name: string;
  category: string | null;
  googleAccountId: string;
  accountResourceName: string | null;
  locationName: string;
  autoApproveReviews: boolean;
  reviewsEnabled: boolean;
  reviewInstructions: string | null;
}

export interface SyncProfileReviewsOptions {
  logPrefix?: string;
}

/**
 * Fetch all reviews from the GBP API for one profile, store new ones, and
 * draft AI responses. Reviews that already have a reply on Google were
 * answered outside RankMaps — they're stored so the dashboard shows them,
 * but never get a generated or published response.
 *
 * Profiles with review management turned off are skipped entirely: no
 * fetching, no storing, no drafting.
 *
 * Returns the number of new reviews that received an AI response.
 */
export async function syncProfileReviews(
  profile: ReviewSyncProfile,
  options: SyncProfileReviewsOptions = {}
): Promise<number> {
  const { logPrefix = "[review-sync]" } = options;

  if (!profile.reviewsEnabled) {
    console.log(
      `${logPrefix} Review management is off for ${profile.name}, skipping`
    );
    return 0;
  }

  if (!profile.accountResourceName) return 0;

  let pageToken: string | undefined;
  let totalSynced = 0;

  do {
    const result = await fetchReviews(
      profile.googleAccountId,
      profile.accountResourceName,
      profile.locationName,
      pageToken
    );

    for (const gbpReview of result.reviews) {
      const existing = await prisma.review.findUnique({
        where: { googleReviewId: gbpReview.name },
      });
      if (existing) continue;

      const rating = STAR_RATING_MAP[gbpReview.starRating] ?? 3;
      const repliedExternally = Boolean(gbpReview.reviewReply);

      const review = await prisma.review.create({
        data: {
          profileId: profile.id,
          googleReviewId: gbpReview.name,
          reviewerName: gbpReview.reviewer.isAnonymous
            ? null
            : gbpReview.reviewer.displayName,
          rating,
          comment: gbpReview.comment || null,
          reviewDate: new Date(gbpReview.createTime),
          repliedExternally,
        },
      });

      if (repliedExternally) {
        // Off-limits: no AI response, no publishing.
        continue;
      }

      try {
        const aiResponse = await generateReviewResponse({
          businessName: profile.name,
          businessCategory: profile.category,
          reviewerName: review.reviewerName,
          starRating: rating,
          reviewComment: review.comment,
          customInstructions: profile.reviewInstructions,
        });

        // 1-2 star reviews always require human approval — an AI reply to an
        // angry (or adversarial) reviewer is too risky to publish unreviewed,
        // even with auto-approve on.
        const autoApprove = profile.autoApproveReviews && rating >= 3;

        const reviewResponse = await prisma.reviewResponse.create({
          data: {
            reviewId: review.id,
            content: aiResponse.response,
            status: autoApprove ? "APPROVED" : "DRAFTED",
          },
        });

        if (autoApprove) {
          try {
            await scheduleReviewPublish(reviewResponse.id);
          } catch (queueErr) {
            console.warn(
              `${logPrefix} Failed to queue review response ${reviewResponse.id} for publishing:`,
              queueErr
            );
          }
        }

        totalSynced++;
      } catch (aiErr) {
        console.error(
          `${logPrefix} AI response failed for review ${review.id}:`,
          aiErr
        );
        // Review is created but without a response — can be regenerated later
      }
    }

    // Pagination safety: if Google returns the same token we just used,
    // bail out instead of looping forever.
    if (result.nextPageToken && result.nextPageToken === pageToken) {
      console.warn(
        `${logPrefix} Google returned a repeated page token for profile ${profile.name}, stopping pagination`
      );
      break;
    }

    pageToken = result.nextPageToken;
  } while (pageToken);

  console.log(
    `${logPrefix} Synced ${totalSynced} new reviews for ${profile.name}`
  );

  return totalSynced;
}
