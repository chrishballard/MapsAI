import { Queue } from "bullmq";
import { redisConnection, defaultJobRetention } from "./connection";
import { prisma } from "../prisma";

export interface ReviewPublishJobData {
  reviewResponseId: string;
}

export const reviewPublishQueue = new Queue<ReviewPublishJobData>(
  "review-publish",
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 60_000, // 60 seconds
      },
      ...defaultJobRetention,
    },
  }
);

/**
 * Gap between publishes when several go out for one profile (bulk approve,
 * the stranded-reply sweep): 8 a minute, under GBP's 10 edits/min/profile.
 */
const REVIEW_PUBLISH_STAGGER_MS = 7_500;

/**
 * Schedule an approved review response for publishing.
 *
 * Pass `delayMs` when enqueueing several responses for the same profile
 * (e.g. bulk approve) so publishes are staggered under GBP's
 * 10 edits/min/profile limit rather than landing all at once.
 *
 * Idempotent: the jobId is derived from the response id, so a second
 * enqueue while a job is pending (waiting, delayed, active, or in retry
 * backoff) dedupes. A retained completed/failed record would dedupe a
 * legitimate re-queue for the whole retention window (a reply put back on
 * the approved track after its review reappeared), so it is cleared first.
 */
export async function scheduleReviewPublish(
  reviewResponseId: string,
  options: { delayMs?: number } = {}
): Promise<void> {
  const jobId = `publish-review-${reviewResponseId}`;

  const existing = await reviewPublishQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove().catch(() => {
        // Lost a race with retention cleanup; the add() below decides.
      });
    }
  }

  await reviewPublishQueue.add(
    jobId,
    { reviewResponseId },
    { delay: options.delayMs ?? 0, jobId }
  );
}

/**
 * How long an APPROVED reply sits before the sweep assumes its job is gone.
 * Long enough that an approval still on its way into the queue (a bulk
 * approve is staggered over minutes) is never raced.
 */
const STRANDED_AFTER_MS = 15 * 60_000;

/**
 * And how far back it looks. An approval older than this that never went out
 * is left for a person: publishing a weeks-old approval to Google unannounced
 * (on the first run after this sweep shipped, say) is worse than not.
 */
const STRANDED_WITHIN_MS = 7 * 24 * 60 * 60_000;

/**
 * Re-queue APPROVED replies whose publish job never reached Redis: the review
 * sync approves AUTO replies and swallows a failed enqueue, and a Redis
 * eviction can drop a delayed job. Without this they stayed APPROVED forever,
 * unpublished and uneditable. Safe to re-run: a reply that still has a
 * pending job dedupes on its jobId, and the publish worker re-checks every
 * reply (mode, healthcare, live reply on Google) before it publishes.
 *
 * Returns how many were queued.
 */
export async function requeueStrandedReviewReplies(
  now: Date = new Date()
): Promise<number> {
  const stranded = await prisma.reviewResponse.findMany({
    where: {
      status: "APPROVED",
      updatedAt: {
        lt: new Date(now.getTime() - STRANDED_AFTER_MS),
        gte: new Date(now.getTime() - STRANDED_WITHIN_MS),
      },
      // Only profiles the review sync itself still serves, and reviews still
      // live and unanswered as far as we know.
      review: {
        removedAt: null,
        repliedExternally: false,
        profile: {
          isConnected: true,
          reviewsEnabled: true,
          OR: [{ isOnboarded: true }, { reviewsOnly: true }],
        },
      },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
  });

  let queued = 0;
  for (const [i, response] of stranded.entries()) {
    try {
      await scheduleReviewPublish(response.id, {
        delayMs: i * REVIEW_PUBLISH_STAGGER_MS,
      });
      queued++;
    } catch (err) {
      console.warn(
        `[review-publish-sweep] Failed to re-queue review response ${response.id}:`,
        err
      );
    }
  }
  return queued;
}
