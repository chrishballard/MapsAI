import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { syncProfileMetrics } from "../src/lib/sync/metrics";
import { prisma } from "../src/lib/prisma";

export const worker = new Worker(
  "metrics-sync",
  async (job: Job) => {
    console.log(`Starting metrics sync job ${job.id}`);

    const profiles = await prisma.profile.findMany({
      where: {
        isConnected: true,
        googleAccount: { isNot: undefined },
      },
      include: {
        googleAccount: true,
      },
    });

    console.log(`Found ${profiles.length} profiles to sync metrics for`);

    const jobData = job.data as { days?: number; keywordMonths?: number };

    for (const profile of profiles) {
      try {
        console.log(`Syncing metrics for profile: ${profile.name}`);

        await syncProfileMetrics(profile, {
          days: jobData?.days || 90,
          keywordMonths: jobData?.keywordMonths || 3,
        });
      } catch (profileErr) {
        console.error(
          `Failed to sync metrics for profile ${profile.name}:`,
          profileErr
        );
        // Continue with next profile
      }
    }

    console.log("Metrics sync job complete");
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  console.log(`Metrics sync job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Metrics sync job ${job?.id} failed: ${err.message}`);
});

console.log("Metrics sync worker started, waiting for jobs...");
