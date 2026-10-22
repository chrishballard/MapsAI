import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { logRedisErrors } from "../src/lib/queue/redis-errors";
import {
  captionImage,
  recordCaptionRetriesExhausted,
} from "../src/lib/image-captioner";
import { MAX_CAPTION_ATTEMPTS } from "../src/lib/caption-state";
import type { ImageCaptionJobData } from "../src/lib/queue/image-caption-queue";

/**
 * Captions library images with Claude vision so post generation can match
 * photos to post subjects. Permanent skips (no usable input, row gone)
 * complete the job — retrying can't help; transient errors (network,
 * Claude, DB) propagate so BullMQ retries with backoff, until the image has
 * had MAX_CAPTION_ATTEMPTS across all its jobs. Then it's recorded as
 * RETRIES_EXHAUSTED so no trigger enqueues it again.
 */
export const worker = new Worker<ImageCaptionJobData>(
  "image-caption",
  async (job: Job<ImageCaptionJobData>) => {
    const imageId = job.data.imageId;
    // Attempts already spent: by the failed jobs this one replaced, and by
    // this job before this try. A job can start at the cap when recording
    // the last give-up failed.
    const spent = (job.data.priorAttempts ?? 0) + job.attemptsMade;
    if (spent >= MAX_CAPTION_ATTEMPTS) {
      await recordCaptionRetriesExhausted(imageId);
      console.warn(
        `[image-caption] Gave up on image ${imageId} after ${spent} attempts`
      );
      return;
    }

    let result;
    try {
      result = await captionImage(imageId);
    } catch (err) {
      if (spent + 1 < MAX_CAPTION_ATTEMPTS) throw err;
      await recordCaptionRetriesExhausted(imageId);
      console.warn(
        `[image-caption] Gave up on image ${imageId} after ${spent + 1} attempts:`,
        err
      );
      return;
    }
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
logRedisErrors(worker, "image-caption-worker");

worker.on("completed", (job) => {
  console.log(`[image-caption] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[image-caption] Job ${job?.id} failed: ${err.message}`);
});

console.log("Image caption worker started, waiting for jobs...");
