import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const postGenerationQueue = new Queue("post-generation", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 60_000, // 60 seconds
    },
  },
});

/**
 * Initialize the repeatable post generation scheduler.
 * Runs daily at 06:00 UTC (a quiet hour) to generate the next month of posts
 * for any onboarded profile that has run out of future scheduled posts —
 * keeping posts going out indefinitely after the initial onboarding batch.
 */
export async function initPostGenerationScheduler(): Promise<void> {
  await postGenerationQueue.upsertJobScheduler(
    "post-generation-scheduler",
    { pattern: "0 6 * * *", tz: "UTC" }, // daily at 06:00 UTC
    { name: "generate-posts", data: {} }
  );
}
