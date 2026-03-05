import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const reviewSyncQueue = new Queue("review-sync", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 30_000, // 30 seconds
    },
  },
});

/**
 * Initialize the repeatable review sync scheduler.
 * Runs every 30 minutes to sync reviews from all connected GBP profiles.
 */
export async function initReviewSyncScheduler(): Promise<void> {
  await reviewSyncQueue.upsertJobScheduler(
    "review-sync-scheduler",
    { every: 30 * 60 * 1000 }, // 30 minutes
    { name: "sync-reviews", data: {} }
  );
}
