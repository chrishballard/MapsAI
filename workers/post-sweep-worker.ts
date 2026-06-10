import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { schedulePostPublish } from "../src/lib/queue/publish-queue";
import { prisma } from "../src/lib/prisma";

/**
 * Reconciliation sweep: finds SCHEDULED posts whose publish time has passed
 * and re-enqueues their publish jobs. One-shot delayed BullMQ jobs live only
 * in Redis — a restart/eviction or worker downtime can lose them and strand
 * posts in SCHEDULED forever. Re-enqueueing is safe because
 * schedulePostPublish is idempotent (jobId = publish-<postId>).
 */
export const worker = new Worker(
  "post-sweep",
  async (job: Job) => {
    console.log(`[post-sweep] Starting post sweep job ${job.id}`);

    const now = new Date();
    const overduePosts = await prisma.post.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { lte: now },
      },
      select: { id: true, scheduledAt: true },
    });

    if (overduePosts.length === 0) {
      console.log("[post-sweep] No overdue scheduled posts found");
      return;
    }

    let reEnqueued = 0;
    for (const post of overduePosts) {
      try {
        await schedulePostPublish(post.id, post.scheduledAt!);
        reEnqueued++;
      } catch (err) {
        console.error(`[post-sweep] Failed to re-enqueue post ${post.id}:`, err);
        // Continue with next post
      }
    }

    console.log(
      `[post-sweep] Re-enqueued ${reEnqueued}/${overduePosts.length} overdue scheduled posts`
    );
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  console.log(`[post-sweep] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[post-sweep] Job ${job?.id} failed: ${err.message}`);
});

console.log("Post sweep worker started, waiting for jobs...");
