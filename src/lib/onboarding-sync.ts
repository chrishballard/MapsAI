import { prisma } from "./prisma";
import { generateAndSchedulePosts } from "./post-generation-pipeline";
import { syncProfileReviews } from "./sync/reviews";
import { syncProfileMetrics } from "./sync/metrics";
import { initReviewSyncScheduler } from "./queue/review-sync-queue";
import { initMetricsSyncScheduler } from "./queue/metrics-sync-queue";

const LOG_PREFIX = "[onboarding-sync]";

/**
 * Initial data sync after onboarding completes: generate the first month of
 * posts, sync reviews (with AI response drafts), sync metrics + search
 * keywords, and ensure the recurring schedulers exist.
 *
 * Runs as a BullMQ job (onboarding-sync queue) so a mid-sync crash or deploy
 * restart retries instead of silently leaving an onboarded profile with no
 * data. Every section is safe to re-run: post generation is skipped when
 * future scheduled posts already exist, review sync skips already-stored
 * reviews, metrics/keywords upsert, and scheduler init is idempotent.
 *
 * Throws if any section fails so the job is retried; sections that already
 * succeeded are no-ops on the next attempt.
 */
export async function runInitialSync(profileId: string): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      googleAccount: true,
      promptTemplate: true,
    },
  });

  if (!profile) {
    console.warn(`${LOG_PREFIX} Profile ${profileId} not found, skipping`);
    return;
  }

  if (!profile.isOnboarded || !profile.isConnected) {
    console.warn(
      `${LOG_PREFIX} Profile ${profile.name} is no longer active, skipping`
    );
    return;
  }

  const failures: string[] = [];

  // --- Generate initial monthly posts ---
  try {
    // A retried job must not double-generate: skip when a previous attempt
    // (or the daily generation worker) already scheduled future posts.
    const futureScheduledCount = await prisma.post.count({
      where: {
        profileId,
        status: "SCHEDULED",
        scheduledAt: { gt: new Date() },
      },
    });

    if (futureScheduledCount > 0) {
      console.log(
        `${LOG_PREFIX} ${profile.name} already has ${futureScheduledCount} future scheduled posts, skipping generation`
      );
    } else {
      console.log(`${LOG_PREFIX} Generating posts for ${profile.name}`);
      await generateAndSchedulePosts(profile, { logPrefix: LOG_PREFIX });
    }
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Post generation failed for ${profile.name}:`,
      err
    );
    failures.push("post generation");
  }

  // --- Sync reviews ---
  try {
    console.log(`${LOG_PREFIX} Syncing reviews for ${profile.name}`);
    await syncProfileReviews(profile, { logPrefix: LOG_PREFIX });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Review sync failed for ${profile.name}:`,
      err
    );
    failures.push("review sync");
  }

  // --- Sync metrics ---
  try {
    console.log(`${LOG_PREFIX} Syncing metrics for ${profile.name}`);
    await syncProfileMetrics(profile, {
      days: 30, // Last 30 days for initial sync
      logPrefix: LOG_PREFIX,
    });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Metrics sync failed for ${profile.name}:`,
      err
    );
    failures.push("metrics sync");
  }

  // --- Initialize recurring schedulers (idempotent — safe to call multiple times) ---
  try {
    await initReviewSyncScheduler();
    console.log(
      `${LOG_PREFIX} Review sync scheduler initialized (every 30 min)`
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to init review sync scheduler:`, err);
    failures.push("review sync scheduler");
  }

  try {
    await initMetricsSyncScheduler();
    console.log(
      `${LOG_PREFIX} Metrics sync scheduler initialized (every 24h)`
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to init metrics sync scheduler:`, err);
    failures.push("metrics sync scheduler");
  }

  if (failures.length > 0) {
    throw new Error(
      `Initial sync incomplete for ${profile.name}: ${failures.join(", ")} failed`
    );
  }
}
