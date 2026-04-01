import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { fetchReviews, STAR_RATING_MAP } from "../src/lib/google-reviews";
import { generateReviewResponse } from "../src/lib/review-responder";
import { scheduleReviewPublish } from "../src/lib/queue/review-publish-queue";
import { prisma } from "../src/lib/prisma";

const worker = new Worker(
  "review-sync",
  async (job: Job) => {
    console.log(`Starting review sync job ${job.id}`);

    // Fetch all connected profiles with accountResourceName
    const profiles = await prisma.profile.findMany({
      where: {
        isConnected: true,
        isOnboarded: true,
        accountResourceName: { not: null },
      },
      include: {
        googleAccount: true,
      },
    });

    console.log(`Found ${profiles.length} profiles to sync reviews for`);

    for (const profile of profiles) {
      try {
        console.log(`Syncing reviews for profile: ${profile.name}`);

        let pageToken: string | undefined;
        let totalSynced = 0;

        do {
          const result = await fetchReviews(
            profile.googleAccountId,
            profile.accountResourceName!,
            profile.locationName,
            pageToken
          );

          for (const gbpReview of result.reviews) {
            // Check if review already exists
            const existing = await prisma.review.findUnique({
              where: { googleReviewId: gbpReview.name },
            });

            if (existing) {
              // Already synced, skip
              continue;
            }

            // Skip reviews that already have a reply on Google
            if (gbpReview.reviewReply) {
              continue;
            }

            // Map star rating string to int
            const rating = STAR_RATING_MAP[gbpReview.starRating] ?? 3;

            // Create Review record
            const review = await prisma.review.create({
              data: {
                profileId: profile.id,
                googleReviewId: gbpReview.name,
                reviewerName: gbpReview.reviewer.isAnonymous
                  ? null
                  : gbpReview.reviewer.displayName,
                rating,
                comment: gbpReview.comment || null,
                reviewDate: new Date(gbpReview.createTime),
              },
            });

            // Generate AI response
            try {
              const aiResponse = await generateReviewResponse({
                businessName: profile.name,
                businessCategory: profile.category,
                reviewerName: review.reviewerName,
                starRating: rating,
                reviewComment: review.comment,
              });

              const responseStatus = profile.autoApproveReviews
                ? "APPROVED"
                : "DRAFTED";

              const reviewResponse = await prisma.reviewResponse.create({
                data: {
                  reviewId: review.id,
                  content: aiResponse.response,
                  status: responseStatus,
                },
              });

              // If auto-approve, queue for publishing
              if (profile.autoApproveReviews) {
                try {
                  await scheduleReviewPublish(reviewResponse.id);
                } catch (queueErr) {
                  console.warn(
                    `Failed to queue review response ${reviewResponse.id} for publishing:`,
                    queueErr
                  );
                }
              }

              totalSynced++;
            } catch (aiErr) {
              console.error(
                `Failed to generate AI response for review ${review.id}:`,
                aiErr
              );
              // Review is created but without a response -- can be regenerated later
            }
          }

          pageToken = result.nextPageToken;
        } while (pageToken);

        console.log(
          `Synced ${totalSynced} new reviews for profile: ${profile.name}`
        );
      } catch (profileErr) {
        console.error(
          `Failed to sync reviews for profile ${profile.name}:`,
          profileErr
        );
        // Continue with next profile
      }
    }

    console.log("Review sync job complete");
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  console.log(`Review sync job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Review sync job ${job?.id} failed: ${err.message}`);
});

console.log("Review sync worker started, waiting for jobs...");
