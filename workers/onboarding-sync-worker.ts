import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { runInitialSync } from "../src/lib/onboarding-sync";

interface OnboardingSyncJobData {
  profileId: string;
}

/**
 * Runs the post-onboarding initial data sync (first month of posts, review
 * sync, metrics sync, scheduler init). Previously this ran as a
 * fire-and-forget promise inside the completion API route — a mid-sync
 * restart left the profile marked onboarded with no data and nothing ever
 * retried. As a BullMQ job it survives restarts and retries with backoff;
 * runInitialSync is safe to re-run.
 */
export const worker = new Worker<OnboardingSyncJobData>(
  "onboarding-sync",
  async (job: Job<OnboardingSyncJobData>) => {
    const { profileId } = job.data;
    console.log(
      `[onboarding-sync] Starting initial sync for profile ${profileId} (attempt ${job.attemptsMade + 1})`
    );
    await runInitialSync(profileId);
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

worker.on("completed", (job) => {
  console.log(
    `[onboarding-sync] Job ${job.id} completed for profile ${job.data.profileId}`
  );
});

worker.on("failed", (job, err) => {
  console.error(
    `[onboarding-sync] Job ${job?.id} failed for profile ${job?.data.profileId}: ${err.message}`
  );
});

worker.on("error", (err) => {
  console.error(`[onboarding-sync-worker] Worker error: ${err.message}`);
});

console.log("Onboarding sync worker started, waiting for jobs...");
