import { Queue } from "bullmq";
import { redisConnection, defaultJobRetention } from "./connection";
import { logRedisErrors, redisErrorMessage } from "./redis-errors";
import { prisma } from "../prisma";
import { awaitingCaption } from "../caption-state";

export interface ImageCaptionJobData {
  imageId: string;
  /** Attempts earlier jobs for this image already spent (and failed). The
   *  worker stops at MAX_CAPTION_ATTEMPTS across all of them. */
  priorAttempts?: number;
}

export const imageCaptionQueue = new Queue<ImageCaptionJobData>(
  "image-caption",
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30_000, // 30 seconds
      },
      ...defaultJobRetention,
    },
  }
);
logRedisErrors(imageCaptionQueue, "image-caption");

/**
 * Enqueue a caption job for one library image.
 *
 * Idempotent: the jobId is derived from the image id, so pending jobs
 * dedupe. Throws on redis failure — callers that must not fail (ingestion
 * hooks) go through enqueueCaptionsForProfile or add their own catch.
 */
export async function enqueueImageCaption(imageId: string): Promise<void> {
  const jobId = `caption-${imageId}`;

  // A finished job record with this id (retained for debugging) would dedupe
  // the add() below and silently block re-captioning — e.g. an image whose
  // caption failed transiently would stay uncaptioned until retention
  // expires. Clear completed/failed records; pending jobs (delayed/waiting/
  // active, including retries awaiting backoff) still dedupe as intended.
  const existing = await imageCaptionQueue.getJob(jobId);
  let priorAttempts = 0;
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      // A failed record's attempts move into its replacement. Each one may
      // have been a billed Claude call, and without the carry-over every
      // sync, upload and generation batch bought the image 3 more, forever.
      if (state === "failed") {
        priorAttempts =
          (existing.data?.priorAttempts ?? 0) + (existing.attemptsMade ?? 0);
      }
      await existing.remove().catch(() => {
        // Lost a race with retention cleanup or another enqueuer — either
        // way the record is gone or being handled; the add() below decides.
      });
    }
  }

  await imageCaptionQueue.add(
    jobId,
    priorAttempts > 0 ? { imageId, priorAttempts } : { imageId },
    { jobId }
  );
}

/**
 * Enqueue captions for every APPROVED-but-uncaptioned image of a profile.
 *
 * Never throws — this backs the ingestion hooks (GBP sync, uploads,
 * approvals), and a caption problem must never fail the operation that
 * brought the images in. Returns how many jobs were enqueued.
 */
export async function enqueueCaptionsForProfile(
  profileId: string
): Promise<number> {
  try {
    const rows = await prisma.profileImage.findMany({
      where: {
        profileId,
        status: "APPROVED",
        // Permanently skipped images (no usable input) must never be
        // re-enqueued — without this they'd be reprocessed on every sync
        // and every generation batch, forever.
        ...awaitingCaption(),
      },
      select: { id: true },
    });

    let enqueued = 0;
    for (const row of rows) {
      try {
        await enqueueImageCaption(row.id);
        enqueued++;
      } catch (err) {
        console.warn(
          `[image-caption-queue] Failed to enqueue caption for image ${row.id}:`,
          redisErrorMessage(err)
        );
      }
    }
    return enqueued;
  } catch (err) {
    console.warn(
      `[image-caption-queue] Failed to enqueue captions for profile ${profileId}:`,
      redisErrorMessage(err)
    );
    return 0;
  }
}
