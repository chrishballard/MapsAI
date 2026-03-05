import { Queue } from "bullmq";
import { redisConnection } from "./connection";

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
    },
  }
);

/**
 * Schedule an approved review response for immediate publishing.
 */
export async function scheduleReviewPublish(
  reviewResponseId: string
): Promise<void> {
  await reviewPublishQueue.add(
    `publish-review-${reviewResponseId}`,
    { reviewResponseId },
    { delay: 0 }
  );
}
