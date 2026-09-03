import { prisma } from "../prisma";
import { fetchReviews, STAR_RATING_MAP } from "../google-reviews";
import { generateReviewResponse } from "../review-responder";
import { scheduleReviewPublish } from "../queue/review-publish-queue";
import { normalizeReviewKey } from "../review-key";
import {
  replyModeForRating,
  type StarReplyModes,
} from "../review-reply-mode";

interface ReviewSyncProfile extends StarReplyModes {
  id: string;
  name: string;
  category: string | null;
  googleAccountId: string;
  accountResourceName: string | null;
  locationName: string;
  reviewsEnabled: boolean;
  reviewInstructions: string | null;
}

export interface SyncProfileReviewsOptions {
  logPrefix?: string;
}

/**
 * Fetch all reviews from the GBP API for one profile, store new ones, and
 * handle each per the profile's star reply mode: IGNORE stores the review
 * only, DRAFT adds an AI reply awaiting approval, AUTO approves and queues
 * publishing. Reviews that already have a reply on Google were answered
 * outside RankMaps — they're stored so the dashboard shows them, but never
 * get a generated or published response.
 *
 * Reviews are matched on their normalized key (see review-key.ts), so the
 * same review coming back under a different account segment is never
 * stored twice. Google's own totalReviewCount / averageRating for the
 * location are persisted on the profile each sync — that is the count the
 * public sees and the one to cite. After a complete pass, stored reviews
 * Google no longer returns are stamped removedAt (and un-stamped if they
 * reappear).
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
  let statsPersisted = false;
  // Every key Google returned this pass. Only trustworthy for the removal
  // sweep if pagination ran to completion.
  const seenKeys: string[] = [];
  let pagesComplete = false;

  do {
    const result = await fetchReviews(
      profile.googleAccountId,
      profile.accountResourceName,
      profile.locationName,
      pageToken
    );

    if (!statsPersisted && typeof result.totalReviewCount === "number") {
      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          googleReviewCount: result.totalReviewCount,
          googleAverageRating:
            typeof result.averageRating === "number"
              ? result.averageRating
              : null,
          reviewStatsSyncedAt: new Date(),
        },
      });
      statsPersisted = true;
    }

    for (const gbpReview of result.reviews) {
      const googleReviewKey = normalizeReviewKey(gbpReview.name);
      seenKeys.push(googleReviewKey);

      const existing = await prisma.review.findUnique({
        where: {
          profileId_googleReviewKey: {
            profileId: profile.id,
            googleReviewKey,
          },
        },
      });
      if (existing) {
        if (existing.removedAt) {
          // Google is returning it again — it was never really gone.
          await prisma.review.update({
            where: { id: existing.id },
            data: { removedAt: null },
          });
        }
        continue;
      }

      const rating = STAR_RATING_MAP[gbpReview.starRating] ?? 3;
      const repliedExternally = Boolean(gbpReview.reviewReply);

      const review = await prisma.review.create({
        data: {
          profileId: profile.id,
          googleReviewId: gbpReview.name,
          googleReviewKey,
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

      const mode = replyModeForRating(profile, rating);
      if (mode === "IGNORE") {
        // This star rating is set to Ignore: the review is stored so the
        // dashboard shows it, but RankMaps never drafts or publishes a
        // reply. (The operator can still generate one manually.)
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

        const autoApprove = mode === "AUTO";

        const reviewResponse = await prisma.reviewResponse.create({
          data: {
            reviewId: review.id,
            content: aiResponse.response,
            status: autoApprove ? "APPROVED" : "DRAFTED",
            autoApproved: autoApprove,
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
    if (!pageToken) pagesComplete = true;
  } while (pageToken);

  // Removal sweep: anything we hold that Google didn't return this pass is
  // no longer public (spam filter, reviewer deleted it). Only after a
  // complete pass — a failed or truncated page throws/breaks above — and
  // never on an empty list, which is indistinguishable from an API hiccup
  // and must not wipe a whole profile.
  if (pagesComplete && seenKeys.length > 0) {
    const removed = await prisma.review.updateMany({
      where: {
        profileId: profile.id,
        removedAt: null,
        googleReviewKey: { notIn: seenKeys },
      },
      data: { removedAt: new Date() },
    });
    if (removed.count > 0) {
      console.log(
        `${logPrefix} Marked ${removed.count} review(s) removed on Google for ${profile.name}`
      );
    }
  }

  console.log(
    `${logPrefix} Synced ${totalSynced} new reviews for ${profile.name}`
  );

  return totalSynced;
}
