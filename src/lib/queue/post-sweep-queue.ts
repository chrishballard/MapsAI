import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const postSweepQueue = new Queue("post-sweep", {
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
 * Initialize the repeatable post sweep scheduler.
 * Runs every 15 minutes to re-enqueue publish jobs for any SCHEDULED posts
 * that are past due — rescuing posts whose one-shot delayed jobs were lost
 * (Redis restart/eviction, worker downtime). Safe because schedulePostPublish
 * is idempotent via jobId.
 */
export async function initPostSweepScheduler(): Promise<void> {
  await postSweepQueue.upsertJobScheduler(
    "post-sweep-scheduler",
    { every: 15 * 60 * 1000 }, // 15 minutes
    { name: "sweep-posts", data: {} }
  );
}
