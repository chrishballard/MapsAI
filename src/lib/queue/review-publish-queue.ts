import { Queue } from "bullmq";
import { redisConnection, defaultJobRetention } from "./connection";

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
 * Schedule an approved review response for publishing.
 *
 * Pass `delayMs` when enqueueing several responses for the same profile
 * (e.g. bulk approve) so publishes are staggered under GBP's
 * 10 edits/min/profile limit rather than landing all at once.
 */
export async function scheduleReviewPublish(
  reviewResponseId: string,
  options: { delayMs?: number } = {}
): Promise<void> {
  await reviewPublishQueue.add(
    `publish-review-${reviewResponseId}`,
    { reviewResponseId },
    { delay: options.delayMs ?? 0 }
  );
}
