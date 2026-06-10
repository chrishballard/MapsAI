import { prisma } from "./prisma";
import { generateMonthlyPosts } from "./post-generator";
import { calculateRollingScheduleDates } from "./scheduling";
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
 * 3. Calculate schedule dates at the profile's selected cadence (postFrequency
 *    posts spread over a rolling ~30-day window, anchored to the profile's
 *    most recent post so cadence is seamless across batches — never bunched
 *    into a calendar month's remaining days). `takenDates` (YYYY-MM-DD) are
 *    excluded so new posts never collide with already-scheduled ones.
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

  // Anchor the new batch to the profile's most recent post so the selected
  // cadence (e.g. weekly) continues seamlessly instead of restarting.
  const lastPost = await prisma.post.aggregate({
    where: { profileId },
    _max: { scheduledAt: true, publishedAt: true },
  });
  const anchorTs = Math.max(
    lastPost._max.scheduledAt?.getTime() ?? 0,
    lastPost._max.publishedAt?.getTime() ?? 0
  );
  const anchor = anchorTs > 0 ? new Date(anchorTs) : null;

  const scheduleDates = calculateRollingScheduleDates(
    generated.posts.length,
    anchor,
    options.takenDates
  );

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
