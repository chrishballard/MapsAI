import { prisma } from "../prisma";
import { fetchReviews, STAR_RATING_MAP } from "../google-reviews";
import { generateReviewResponse } from "../review-responder";
import { scheduleReviewPublish } from "../queue/review-publish-queue";
import { redisErrorMessage } from "../queue/redis-errors";
import { normalizeReviewKey } from "../review-key";
import { REVIEW_REMOVED_SKIP_MESSAGE } from "../review-removal";
import { isHealthcareCategory } from "../healthcare";
import {
  AUTO_REPLY_MAX_REVIEW_AGE_DAYS,
  STAR_RATINGS,
  replyModeForRating,
  type StarReplyModes,
} from "../review-reply-mode";

const DAY_MS = 24 * 60 * 60 * 1000;

// AUTO_REPLY_MAX_REVIEW_AGE_DAYS lives with the reply modes so the publish
// worker can apply it without importing the sync.
export { AUTO_REPLY_MAX_REVIEW_AGE_DAYS };

/**
 * How long after a profile's first review row is stored every sync still
 * counts as its first. A backlog pass makes a Claude call per review and can
 * run for tens of minutes, and the onboarding sync and the 30-minute cron are
 * separate workers: a second pass starting meanwhile (or a retry of a first
 * pass that failed partway) sees stored reviews, and without this would
 * auto-publish the recent ones the first pass hadn't reached yet.
 */
const FIRST_SYNC_WINDOW_MS = 6 * 60 * 60 * 1000;

interface ReviewSyncProfile extends StarReplyModes {
  id: string;
  name: string;
  category: string | null;
  phone?: string | null;
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
 * publishing. Healthcare profiles (see healthcare.ts) never auto-publish:
 * AUTO drafts for approval there, like DRAFT. AUTO drafts instead on any
 * profile's first review sync too, and for reviews older than
 * AUTO_REPLY_MAX_REVIEW_AGE_DAYS. Reviews that already have a reply on
 * Google were answered outside RankMaps — they're stored so the dashboard
 * shows them, but never get a generated or published response. A review
 * Google returns without a star rating is not stored until it has one.
 *
 * Reviews are matched on their normalized key (see review-key.ts), so the
 * same review coming back under a different account segment is never
 * stored twice. Google's own totalReviewCount / averageRating for the
 * location are persisted on the profile each sync — that is the count the
 * public sees and the one to cite. After a complete pass that returned at
 * least as many distinct reviews as Google says exist, stored reviews
 * Google no longer returns are stamped removedAt (and un-stamped if they
 * reappear — with any reply skipped on that basis re-queued).
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
  let googleTotal: number | undefined;
  // Every key Google returned this pass. Only trustworthy for the removal
  // sweep if pagination ran to completion and covered Google's own total.
  const seenKeys: string[] = [];
  let pagesComplete = false;

  // The first sync stores a profile's whole backlog as new reviews, so AUTO
  // never publishes on it: every reply it drafts waits for a person. "First"
  // means nothing was stored for the profile before this pass (removed
  // reviews count), or the first row was stored under FIRST_SYNC_WINDOW_MS
  // ago. Decided once up front so page one's reviews don't turn page two
  // into a later sync. Only asked when AUTO could apply at all.
  const canAutoPublish =
    !isHealthcareCategory(profile.category) &&
    STAR_RATINGS.some((stars) => replyModeForRating(profile, stars) === "AUTO");
  let firstSync = false;
  if (canAutoPublish) {
    const firstStored = await prisma.review.findFirst({
      where: { profileId: profile.id },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    firstSync =
      !firstStored ||
      Date.now() - firstStored.createdAt.getTime() < FIRST_SYNC_WINDOW_MS;
  }
  let heldForApproval = 0;

  do {
    const result = await fetchReviews(
      profile.googleAccountId,
      profile.accountResourceName,
      profile.locationName,
      pageToken
    );

    if (!statsPersisted && typeof result.totalReviewCount === "number") {
      googleTotal = result.totalReviewCount;
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
        include: { response: true },
      });
      if (existing) {
        if (existing.removedAt) {
          // Google is returning it again — it was never really gone.
          await prisma.review.update({
            where: { id: existing.id },
            data: { removedAt: null },
          });
          // A reply the worker skipped *because* the review looked removed
          // had been approved; put it back on the approved track and
          // re-queue it. Skips for any other reason stay skipped.
          if (
            existing.response?.status === "SKIPPED" &&
            existing.response.errorMessage === REVIEW_REMOVED_SKIP_MESSAGE
          ) {
            await prisma.reviewResponse.update({
              where: { id: existing.response.id },
              data: { status: "APPROVED", errorMessage: null },
            });
            try {
              await scheduleReviewPublish(existing.response.id);
            } catch (queueErr) {
              console.warn(
                `${logPrefix} Failed to re-queue review response ${existing.response.id} for publishing:`,
                redisErrorMessage(queueErr)
              );
            }
          }
        }

        // repliedExternally used to be written on create only, so an owner
        // who answered a review in GBP after we first stored it stayed
        // flagged unanswered forever. Re-read it on every pass. Our own
        // published reply comes back as a reviewReply too, so a review with
        // a PUBLISHED RankMaps response is left alone: flagging it external
        // would erase the record of who actually wrote it.
        const answeredOnGoogle = Boolean(gbpReview.reviewReply);
        const ourReplyIsLive = existing.response?.status === "PUBLISHED";
        if (
          !ourReplyIsLive &&
          existing.repliedExternally !== answeredOnGoogle
        ) {
          await prisma.review.update({
            where: { id: existing.id },
            data: { repliedExternally: answeredOnGoogle },
          });
        }
        continue;
      }

      const rating: number | undefined = STAR_RATING_MAP[gbpReview.starRating];
      if (rating === undefined) {
        // Google sent STAR_RATING_UNSPECIFIED, or no rating at all. This used
        // to be stored as 3 stars, which skewed the stored average and ran
        // the 3-star reply mode on a rating nobody gave. Review.rating can't
        // be null, so leave the review out until Google reports a real
        // rating; a later pass then stores it as a new review.
        console.warn(
          `${logPrefix} Review ${googleReviewKey} for ${profile.name} has no star rating (${gbpReview.starRating ?? "missing"}), not storing it yet`
        );
        continue;
      }
      const repliedExternally = Boolean(gbpReview.reviewReply);
      const reviewDate = new Date(gbpReview.createTime);

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
          reviewDate,
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
          businessPhone: profile.phone,
        });

        // A healthcare reply always waits for a person, whatever the star
        // mode says: one that confirms a reviewer is a patient is a HIPAA
        // disclosure the moment it publishes. So does any reply on a first
        // sync, or to a review too old to count as just in (an unparseable
        // date counts as too old).
        const recent =
          Date.now() - reviewDate.getTime() <=
          AUTO_REPLY_MAX_REVIEW_AGE_DAYS * DAY_MS;
        const autoApprove =
          mode === "AUTO" && canAutoPublish && !firstSync && recent;
        if (mode === "AUTO" && canAutoPublish && !autoApprove) {
          heldForApproval++;
        }

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
              redisErrorMessage(queueErr)
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

  // A location with no reviews comes back as an empty object: proto3 JSON
  // drops zero-valued fields, so totalReviewCount is simply absent. After a
  // complete pass that is a real zero and the stored count must say so —
  // but only when we hold no live reviews either. An empty body for a
  // profile with hundreds of stored reviews is an API hiccup, and the
  // cited count must not drop to 0 on that signal.
  if (
    !statsPersisted &&
    pagesComplete &&
    seenKeys.length === 0 &&
    googleTotal === undefined &&
    (await prisma.review.count({
      where: { profileId: profile.id, removedAt: null },
    })) === 0
  ) {
    await prisma.profile.update({
      where: { id: profile.id },
      data: {
        googleReviewCount: 0,
        googleAverageRating: null,
        reviewStatsSyncedAt: new Date(),
      },
    });
  }

  // Removal sweep: anything we hold that Google didn't return this pass is
  // no longer public (spam filter, reviewer deleted it). Only after a
  // complete pass — a failed or truncated page throws/breaks above — and
  // never on an empty list, which is indistinguishable from an API hiccup
  // and must not wipe a whole profile. The list is ordered by updateTime
  // and paginated, so a review whose updateTime moves mid-pass (a reply
  // lands, an edit) can slip between pages: only sweep when the pass
  // covered at least as many distinct reviews as Google's own total. No
  // total at all means no proof, so no sweep.
  const distinctSeen = new Set(seenKeys).size;
  const coveredGoogleTotal =
    googleTotal !== undefined && distinctSeen >= googleTotal;
  if (pagesComplete && distinctSeen > 0 && coveredGoogleTotal) {
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

  if (heldForApproval > 0) {
    console.log(
      `${logPrefix} Drafted ${heldForApproval} AUTO-mode replies for approval instead of publishing them for ${profile.name} (${firstSync ? "first review sync" : `reviews older than ${AUTO_REPLY_MAX_REVIEW_AGE_DAYS} days`})`
    );
  }

  console.log(
    `${logPrefix} Synced ${totalSynced} new reviews for ${profile.name}`
  );

  return totalSynced;
}
