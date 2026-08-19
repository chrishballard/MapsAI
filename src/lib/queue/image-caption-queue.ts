import { Queue } from "bullmq";
import { redisConnection, defaultJobRetention } from "./connection";
import { prisma } from "../prisma";

export interface ImageCaptionJobData {
  imageId: string;
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
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove().catch(() => {
        // Lost a race with retention cleanup or another enqueuer — either
        // way the record is gone or being handled; the add() below decides.
      });
    }
  }

  await imageCaptionQueue.add(jobId, { imageId }, { jobId });
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
        captionedAt: null,
        // Permanently skipped images (no usable input) must never be
        // re-enqueued — without this they'd be reprocessed on every sync
        // and every generation batch, forever.
        captionSkipReason: null,
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
          err
        );
      }
    }
    return enqueued;
  } catch (err) {
    console.warn(
      `[image-caption-queue] Failed to enqueue captions for profile ${profileId}:`,
      err
    );
    return 0;
  }
}
