import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { fetchSingleReview, publishReviewReply } from "../src/lib/google-reviews";
import { prisma } from "../src/lib/prisma";

interface ReviewPublishJobData {
  reviewResponseId: string;
}

export const worker = new Worker<ReviewPublishJobData>(
  "review-publish",
  async (job: Job<ReviewPublishJobData>) => {
    const { reviewResponseId } = job.data;

    console.log(`Processing review publish job for response ${reviewResponseId}`);

    const reviewResponse = await prisma.reviewResponse.findUniqueOrThrow({
      where: { id: reviewResponseId },
      include: {
        review: {
          include: {
            profile: {
              include: {
                googleAccount: true,
              },
            },
          },
        },
      },
    });

    // Skip if already published or previously skipped
    if (reviewResponse.status === "PUBLISHED" || reviewResponse.status === "SKIPPED") {
      console.log(`Review response ${reviewResponseId} already ${reviewResponse.status.toLowerCase()}, skipping`);
      return;
    }

    const { review } = reviewResponse;

    // Safety check: fetch the live review from Google before publishing.
    // If this fetch fails we throw (BullMQ retries) — never publish blind.
    const liveReview = await fetchSingleReview(
      review.profile.googleAccountId,
      review.googleReviewId
    );

    if (liveReview.reviewReply) {
      if (liveReview.reviewReply.comment === reviewResponse.content) {
        // The existing reply is our own content — idempotent retry.
        // Mark published without re-PUTting.
        console.log(
          `Review response ${reviewResponseId} already live on Google with matching content, marking PUBLISHED`
        );
        await prisma.reviewResponse.update({
          where: { id: reviewResponseId },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
          },
        });
        return;
      }

      // Someone else (e.g. the client) replied — never overwrite.
      console.warn(
        `Review ${review.id} already has a different reply on Google, skipping publish for response ${reviewResponseId}`
      );
      await prisma.reviewResponse.update({
        where: { id: reviewResponseId },
        data: {
          status: "SKIPPED",
          errorMessage:
            "Review already has a reply on Google — skipped to avoid overwriting",
        },
      });
      return;
    }

    await publishReviewReply(
      review.profile.googleAccountId,
      review.googleReviewId,
      reviewResponse.content
    );

    // Update response as published
    await prisma.reviewResponse.update({
      where: { id: reviewResponseId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    console.log(`Review response ${reviewResponseId} published successfully`);
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

worker.on("completed", (job) => {
  console.log(
    `Job ${job.id} completed for review response ${job.data.reviewResponseId}`
  );
});

worker.on("failed", async (job, err) => {
  if (!job) return;

  console.error(
    `Job ${job.id} failed for review response ${job.data.reviewResponseId}: ${err.message}`
  );

  // On final attempt, mark response as FAILED
  const maxAttempts = job.opts.attempts ?? 3;
  if (job.attemptsMade >= maxAttempts) {
    console.error(
      `Review response ${job.data.reviewResponseId} permanently failed after ${job.attemptsMade} attempts`
    );
    try {
      await prisma.reviewResponse.update({
        where: { id: job.data.reviewResponseId },
        data: {
          status: "FAILED",
          errorMessage: err.message,
        },
      });
    } catch (updateErr) {
      console.error(`Failed to update review response status: ${updateErr}`);
    }
  }
});

console.log("Review publish worker started, waiting for jobs...");
