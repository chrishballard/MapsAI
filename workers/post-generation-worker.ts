import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { generateAndSchedulePosts } from "../src/lib/post-generation-pipeline";
import { prisma } from "../src/lib/prisma";

/**
 * Continuous post generation: runs daily and generates a fresh month of
 * posts for any onboarded profile that has no future SCHEDULED posts left.
 * This keeps posts going out indefinitely after the initial onboarding batch
 * (which previously was the only time posts were ever generated).
 */
export const worker = new Worker(
  "post-generation",
  async (job: Job) => {
    console.log(`[post-generation] Starting post generation job ${job.id}`);

    const profiles = await prisma.profile.findMany({
      where: {
        isConnected: true,
        isOnboarded: true,
        accountResourceName: { not: null },
      },
      include: {
        promptTemplate: true,
      },
    });

    console.log(
      `[post-generation] Checking ${profiles.length} profiles for post generation`
    );

    const now = new Date();
    let generatedFor = 0;

    // Process sequentially — Claude + GBP rate limits make parallel
    // generation across many profiles risky.
    for (const profile of profiles) {
      try {
        const futureScheduledCount = await prisma.post.count({
          where: {
            profileId: profile.id,
            status: "SCHEDULED",
            scheduledAt: { gt: now },
          },
        });

        if (futureScheduledCount > 0) {
          // Profile still has posts queued up — nothing to do.
          continue;
        }

        console.log(
          `[post-generation] Generating new month of posts for ${profile.name}`
        );

        // Exclude dates already taken by other future-dated posts (e.g.
        // manually scheduled drafts) so new posts never collide.
        const futurePosts = await prisma.post.findMany({
          where: {
            profileId: profile.id,
            scheduledAt: { gt: now },
          },
          select: { scheduledAt: true },
        });
        const takenDates = new Set(
          futurePosts
            .filter((p) => p.scheduledAt)
            .map((p) => p.scheduledAt!.toISOString().slice(0, 10))
        );

        await generateAndSchedulePosts(profile, {
          takenDates,
          logPrefix: "[post-generation]",
        });

        generatedFor++;
      } catch (profileErr) {
        console.error(
          `[post-generation] Failed to generate posts for profile ${profile.name}:`,
          profileErr
        );
        // Continue with next profile
      }
    }

    console.log(
      `[post-generation] Post generation job complete — generated posts for ${generatedFor}/${profiles.length} profiles`
    );
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  console.log(`[post-generation] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[post-generation] Job ${job?.id} failed: ${err.message}`);
});

console.log("Post generation worker started, waiting for jobs...");
