import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { captionImage } from "../src/lib/image-captioner";
import type { ImageCaptionJobData } from "../src/lib/queue/image-caption-queue";

/**
 * Captions library images with Claude vision so post generation can match
 * photos to post subjects. Permanent skips (no usable input, row gone)
 * complete the job — retrying can't help; transient errors (network,
 * Claude, DB) propagate so BullMQ retries with backoff.
 */
export const worker = new Worker<ImageCaptionJobData>(
  "image-caption",
  async (job: Job<ImageCaptionJobData>) => {
    const result = await captionImage(job.data.imageId);
    if (result.skipped) {
      console.log(
        `[image-caption] Skipped image ${job.data.imageId}: ${result.skipped}`
      );
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

worker.on("completed", (job) => {
  console.log(`[image-caption] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[image-caption] Job ${job?.id} failed: ${err.message}`);
});

worker.on("error", (err) => {
  console.error(`[image-caption-worker] Worker error: ${err.message}`);
});

console.log("Image caption worker started, waiting for jobs...");
