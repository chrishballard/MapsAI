import { Queue } from "bullmq";
import { redisConnection, defaultJobRetention } from "./connection";

export interface OnboardingSyncJobData {
  profileId: string;
}

export const onboardingSyncQueue = new Queue<OnboardingSyncJobData>(
  "onboarding-sync",
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 60_000, // 60 seconds
      },
      ...defaultJobRetention,
    },
  }
);

/**
 * Enqueue the initial data sync for a freshly onboarded profile.
 *
 * The jobId is derived from the profile id so a double-submit of the
 * completion endpoint can't run two syncs concurrently. A finished
 * (completed or failed) job with the same id is removed first so
 * re-onboarding a profile — or re-hitting the endpoint after a permanent
 * failure — enqueues a fresh sync instead of being silently deduped
 * against a stale job record.
 */
export async function enqueueOnboardingSync(profileId: string): Promise<void> {
  const jobId = `onboarding-sync-${profileId}`;

  const existing = await onboardingSyncQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove();
    }
  }

  await onboardingSyncQueue.add("initial-sync", { profileId }, { jobId });
}
