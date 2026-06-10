import { prisma } from "./prisma";
import { generateMonthlyPosts } from "./post-generator";
import { calculateScheduleDates } from "./scheduling";
import { schedulePostPublish } from "./queue/publish-queue";
import { PostType } from "../generated/prisma/client";

export interface PostGenerationProfile {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  postFrequency: number | null;
  promptTemplate?: { prompt: string } | null;
}

export interface PostGenerationResult {
  created: number;
  scheduled: number;
}

/**
 * Generate a month of posts for a profile and schedule them for publishing.
 *
 * Shared by the onboarding completion flow and the daily post-generation
 * worker so the pipeline can't drift between the two:
 * 1. Load the profile's keywords and cities.
 * 2. Generate posts with Claude (custom prompt template if set, postFrequency posts).
 * 3. Calculate schedule dates in the current month, falling back to next month
 *    if no future weekdays remain. `takenDates` (YYYY-MM-DD) are excluded so
 *    new posts never collide with already-scheduled ones.
 * 4. Create posts as SCHEDULED (or DRAFT if no date was available) and queue
 *    each scheduled post for publishing via BullMQ.
 */
export async function generateAndSchedulePosts(
  profile: PostGenerationProfile,
  options: {
    takenDates?: Set<string>;
    logPrefix?: string;
  } = {}
): Promise<PostGenerationResult> {
  const logPrefix = options.logPrefix ?? "[post-generation]";
  const profileId = profile.id;

  const [keywordRecords, cityRecords] = await Promise.all([
    prisma.profileKeyword.findMany({
      where: { profileId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.profileCity.findMany({
      where: { profileId },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const generated = await generateMonthlyPosts(
    {
      name: profile.name,
      category: profile.category,
      address: profile.address,
      keywords: keywordRecords.map((k) => k.keyword),
      cities: cityRecords.map((c) => c.city),
    },
    profile.promptTemplate?.prompt ?? undefined,
    profile.postFrequency ?? 4
  );

  // Create posts and auto-approve them with scheduled dates
  const now = new Date();
  let scheduleDates = calculateScheduleDates(
    generated.posts.length,
    now.getMonth(),
    now.getFullYear(),
    options.takenDates
  );
  if (scheduleDates.length === 0) {
    const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    scheduleDates = calculateScheduleDates(
      generated.posts.length,
      nextMonth,
      nextYear,
      options.takenDates
    );
  }

  const createdPosts = await Promise.all(
    generated.posts.map((post, i) =>
      prisma.post.create({
        data: {
          profileId,
          type: post.suggestedType as PostType,
          content: post.content,
          callToAction: post.callToActionUrl ?? null,
          status: scheduleDates[i] ? "SCHEDULED" : "DRAFT",
          scheduledAt: scheduleDates[i] ?? null,
        },
      })
    )
  );

  // Queue scheduled posts for publishing via BullMQ
  for (const post of createdPosts) {
    if (post.status === "SCHEDULED" && post.scheduledAt) {
      try {
        await schedulePostPublish(post.id, post.scheduledAt);
      } catch (err) {
        console.warn(`${logPrefix} Failed to queue post ${post.id}:`, err);
      }
    }
  }

  const scheduledCount = createdPosts.filter(
    (p) => p.status === "SCHEDULED"
  ).length;
  console.log(
    `${logPrefix} Generated and scheduled ${scheduledCount}/${generated.posts.length} posts for ${profile.name}`
  );

  return { created: createdPosts.length, scheduled: scheduledCount };
}
