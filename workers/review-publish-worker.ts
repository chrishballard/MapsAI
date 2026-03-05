import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { publishReviewReply } from "../src/lib/google-reviews";
import { prisma } from "../src/lib/prisma";

interface ReviewPublishJobData {
  reviewResponseId: string;
}

const worker = new Worker<ReviewPublishJobData>(
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

    // Skip if already published
    if (reviewResponse.status === "PUBLISHED") {
      console.log(`Review response ${reviewResponseId} already published, skipping`);
      return;
    }

    const { review } = reviewResponse;

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
