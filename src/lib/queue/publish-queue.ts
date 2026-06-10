import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export interface PublishJobData {
  postId: string;
}

export const publishQueue = new Queue<PublishJobData>("post-publish", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 60_000, // 60 seconds
    },
    // BullMQ dedupes on jobId, and a completed/failed job's id stays in Redis
    // until the job record is removed. Age-based cleanup (rather than keeping
    // jobs forever) means a post that gets re-scheduled weeks later isn't
    // silently blocked by a stale completed job with the same `publish-<id>`
    // jobId — while still deduping within the window that matters.
    removeOnComplete: { age: 86_400 }, // keep completed jobs 1 day
    removeOnFail: { age: 7 * 86_400 }, // keep failed jobs 7 days for debugging
  },
});

/**
 * Schedule a post for publishing at a specific time.
 * If publishAt is in the past, the job runs immediately.
 *
 * Idempotent: the jobId is derived from the post id, so calling this
 * multiple times for the same post (e.g. from the reconciliation sweep)
 * never enqueues duplicate publish jobs.
 */
export async function schedulePostPublish(
  postId: string,
  publishAt: Date
): Promise<void> {
  const delay = Math.max(0, publishAt.getTime() - Date.now());

  await publishQueue.add(
    `publish-${postId}`,
    { postId },
    { delay, jobId: `publish-${postId}` }
  );
}
