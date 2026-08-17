import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { syncProfileReviews } from "../src/lib/sync/reviews";
import { prisma } from "../src/lib/prisma";

export const worker = new Worker(
  "review-sync",
  async (job: Job) => {
    console.log(`Starting review sync job ${job.id}`);

    // Fetch all connected profiles with accountResourceName.
    // Profiles with review management turned off are excluded here (and
    // guarded again inside syncProfileReviews).
    const profiles = await prisma.profile.findMany({
      where: {
        isConnected: true,
        isOnboarded: true,
        reviewsEnabled: true,
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
        await syncProfileReviews(profile);
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
