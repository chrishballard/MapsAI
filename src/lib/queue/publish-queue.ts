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
  },
});

/**
 * Schedule a post for publishing at a specific time.
 * If publishAt is in the past, the job runs immediately.
 */
export async function schedulePostPublish(
  postId: string,
  publishAt: Date
): Promise<void> {
  const delay = Math.max(0, publishAt.getTime() - Date.now());

  await publishQueue.add(
    `publish-${postId}`,
    { postId },
    { delay }
  );
}
