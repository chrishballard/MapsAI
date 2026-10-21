import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { syncProfileReviews } from "../src/lib/sync/reviews";
import { requeueStrandedReviewReplies } from "../src/lib/queue/review-publish-queue";
import { prisma } from "../src/lib/prisma";

export const worker = new Worker(
  "review-sync",
  async (job: Job) => {
    console.log(`Starting review sync job ${job.id}`);

    // Fetch all connected profiles with accountResourceName.
    // Profiles with review management turned off are excluded here (and
    // guarded again inside syncProfileReviews). An offboarded profile is
    // skipped unless it is marked reviewsOnly: offboarding used to stop
    // review sync silently, which is how Lumos Dental went three months
    // without a stored review (2026-07-10 to 2026-10-19).
    const profiles = await prisma.profile.findMany({
      where: {
        isConnected: true,
        reviewsEnabled: true,
        accountResourceName: { not: null },
        OR: [{ isOnboarded: true }, { reviewsOnly: true }],
      },
      include: {
        googleAccount: true,
      },
    });

    console.log(`Found ${profiles.length} profiles to sync reviews for`);

    for (const profile of profiles) {
      try {
        console.log(`Syncing reviews for profile: ${profile.name}`);
        await syncProfileReviews(profile);
      } catch (profileErr) {
        console.error(
          `Failed to sync reviews for profile ${profile.name}:`,
          profileErr
        );
        // Continue with next profile
      }
    }

    // Approved replies whose publish job never reached Redis (or was
    // evicted) would otherwise sit APPROVED forever.
    try {
      const requeued = await requeueStrandedReviewReplies();
      if (requeued > 0) {
        console.log(`Re-queued ${requeued} approved review replies with no publish job`);
      }
    } catch (sweepErr) {
      console.error("Failed to sweep stranded review replies:", sweepErr);
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
