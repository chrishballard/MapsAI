import { Queue } from "bullmq";
import { redisConnection, defaultJobRetention } from "./connection";
import { logRedisErrors } from "./redis-errors";

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
    ...defaultJobRetention,
  },
});
logRedisErrors(publishQueue, "post-publish");

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
  const jobId = `publish-${postId}`;

  // A finished job record with this id (retained for debugging) would dedupe
  // the add() below and silently block re-publishing — e.g. a FAILED post
  // that gets reset and re-approved would stay stuck until retention expires.
  // Clear completed/failed records; pending jobs (delayed/waiting/active,
  // including retries awaiting backoff) still dedupe as intended.
  //
  // One pending case is cleared too: a delayed job that has never run and is
  // set for a different time is left over from an earlier schedule (a post
  // moved back to DRAFT whose job removal failed). Deduping against it would
  // publish the re-approved post on its old date.
  const existing = await publishQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    const staleSchedule =
      state === "delayed" &&
      existing.attemptsMade === 0 &&
      Math.abs(existing.timestamp + existing.delay - publishAt.getTime()) > 1_000;
    if (state === "completed" || state === "failed" || staleSchedule) {
      await existing.remove().catch(() => {
        // Lost a race with retention cleanup or another scheduler — either
        // way the record is gone or being handled; the add() below decides.
      });
    }
  }

  await publishQueue.add(jobId, { postId }, { delay, jobId });
}
