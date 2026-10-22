import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { logRedisErrors } from "../src/lib/queue/redis-errors";
import { createGBPPost, listGBPPosts, GBPLocalPost } from "../src/lib/google-posts";
import { resolvePostImageSourceUrl } from "../src/lib/image-urls";
import { googleErrorFields, googleErrorSubjects } from "../src/lib/google-errors";
import { prisma } from "../src/lib/prisma";
import { PostType } from "../src/generated/prisma/client";

interface PublishJobData {
  postId: string;
}

const POST_TYPE_TO_GBP: Record<PostType, "STANDARD" | "EVENT" | "OFFER"> = {
  [PostType.WHATS_NEW]: "STANDARD",
  [PostType.EVENT]: "EVENT",
  [PostType.OFFER]: "OFFER",
};

interface PostWithProfile {
  id: string;
  content: string;
  createdAt?: Date | null;
  profile: {
    googleAccountId: string;
    accountResourceName: string | null;
    locationName: string;
  };
}

/**
 * Summary text for comparison only. Google can hand a summary back with
 * \n where we stored \r\n, or without our trailing whitespace; the same
 * words in the same order are the same post.
 */
function normalizeSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Safety check: fetch the live posts from Google and look for one whose
 * summary matches our content. If a previous attempt created the post but
 * crashed before recording it, this finds it — so we never publish twice.
 * If the fetch fails we throw (BullMQ retries) — never publish blind.
 */
async function findLiveMatchingPost(
  post: PostWithProfile
): Promise<GBPLocalPost | undefined> {
  const livePosts = await listGBPPosts({
    googleAccountId: post.profile.googleAccountId,
    accountResourceName: post.profile.accountResourceName!,
    locationName: post.profile.locationName,
  });
  const content = normalizeSummary(post.content);
  // Only a live post created after our row can be an earlier attempt of
  // ours. An older one that happens to say the same thing is someone else's,
  // and taking it for ours would mark this post published unsent.
  const notBefore = post.createdAt?.getTime();
  return livePosts.find((live) => {
    if (typeof live.summary !== "string") return false;
    if (normalizeSummary(live.summary) !== content) return false;
    const created =
      typeof live.createTime === "string" ? Date.parse(live.createTime) : NaN;
    return notBefore === undefined || Number.isNaN(created) || created >= notBefore;
  });
}

async function markPublished(
  postId: string,
  googlePostId: string,
  extra: { mediaUrl?: string | null; note?: string | null } = {}
) {
  await prisma.post.update({
    where: { id: postId },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      googlePostId,
      // Record the image URL that actually went out (or clear a stale one),
      // and clear any error left over from a previous failed attempt. A
      // non-fatal note (e.g. "image skipped") is kept for debugging.
      ...(extra.mediaUrl !== undefined ? { mediaUrl: extra.mediaUrl } : {}),
      errorMessage: extra.note ?? null,
    },
  });
}

/**
 * Resolve the post's attached library image to a URL Google can fetch.
 * When a photo is attached but can't go out (hidden after scheduling, or
 * no public app URL to serve uploaded bytes from), skipNote carries the
 * reason so it lands on the post record instead of only in worker stdout.
 * Post.mediaUrl is a publish-time record, never an input.
 */
function resolvePostMedia(post: {
  image: {
    publicToken: string;
    googleUrl: string | null;
    thumbnailUrl: string | null;
    status: string;
  } | null;
}): { url: string | null; skipNote: string | null } {
  if (!post.image) return { url: null, skipNote: null };

  // An image hidden/unapproved after the post was scheduled must not go out.
  if (post.image.status !== "APPROVED") {
    return {
      url: null,
      skipNote: "Image skipped: photo is no longer approved in the library",
    };
  }

  const url = resolvePostImageSourceUrl(post.image);
  if (!url) {
    return {
      url: null,
      skipNote:
        "Image skipped: no publicly reachable image URL (NEXTAUTH_URL must be a public https URL)",
    };
  }

  return { url, skipNote: null };
}

/**
 * Google rejected the request itself (HTTP 400 INVALID_ARGUMENT). Non-400s
 * (429/5xx/network) are transient and must retry unchanged, photo included.
 */
function isBadRequestError(err: unknown): boolean {
  const e = err as {
    response?: { status?: number };
    status?: number;
    code?: number | string;
  };
  const status =
    e?.response?.status ??
    e?.status ??
    (typeof e?.code === "number" ? e.code : undefined);
  return status === 400;
}

// How Google points at the photo when that is what it rejected: the field
// path (media[0].source_url, sourceUrl) or the rule (image fetch failed).
const MEDIA_ERROR_PATTERN = /media|photo|image|source_?url/i;

/**
 * Whether a 400 is plausibly about the attached photo (unfetchable
 * sourceUrl, unsupported content), so detaching it lets the retry publish
 * text-only. Only when Google names the fields it rejected and none of them
 * is the photo (summary too long, a bad call-to-action URL) is the photo
 * kept: dropping it then would only lose it. With no field named (a bare
 * "Request contains an invalid argument.", or only the generic ErrorInfo
 * and message every error carries), the photo stays the likeliest culprit.
 */
function badRequestConcernsMedia(err: unknown): boolean {
  const subjects = googleErrorSubjects(err);
  const message = err instanceof Error ? err.message : "";
  if ([...subjects, message].some((s) => MEDIA_ERROR_PATTERN.test(s))) {
    return true;
  }
  return googleErrorFields(err).length === 0;
}

/** Clock slack between a delayed job firing and the post's scheduledAt. */
const SCHEDULE_TOLERANCE_MS = 60_000;

export const worker = new Worker<PublishJobData>(
  "post-publish",
  async (job: Job<PublishJobData>) => {
    const { postId } = job.data;

    console.log(`Processing publish job for post ${postId}`);

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
      include: {
        profile: {
          include: {
            googleAccount: true,
          },
        },
        image: {
          select: {
            publicToken: true,
            googleUrl: true,
            thumbnailUrl: true,
            status: true,
          },
        },
      },
    });

    // Offboarded/disconnected profiles must not keep receiving AI posts.
    // The offboard route cancels pending jobs, but a job already in flight —
    // or one re-enqueued by the reconciliation sweep — still lands here.
    if (!post.profile.isOnboarded || !post.profile.isConnected) {
      const demoted = await prisma.post.updateMany({
        where: { id: postId, status: "SCHEDULED" },
        data: { status: "DRAFT", scheduledAt: null },
      });
      console.log(
        `Post ${postId} belongs to inactive profile ${post.profileId}, skipping publish${
          demoted.count === 1 ? " (demoted to DRAFT)" : ""
        }`
      );
      return;
    }

    // A job can outlive its schedule: a post moved back to DRAFT and
    // re-approved for a later date may still have its old delayed job (its
    // removal failed, or it was mid-retry). Only publish once the post's own
    // date has come; the post sweep enqueues it then.
    if (
      post.scheduledAt &&
      post.scheduledAt.getTime() > Date.now() + SCHEDULE_TOLERANCE_MS
    ) {
      console.log(
        `Post ${postId} is scheduled for ${post.scheduledAt.toISOString()}, not yet due — skipping this job`
      );
      return;
    }

    if (!post.profile.accountResourceName) {
      throw new Error(
        `Profile ${post.profileId} is missing accountResourceName`
      );
    }

    // Atomically claim the post. Two jobs can both read SCHEDULED, but only
    // one updateMany can flip it to PUBLISHING — the loser gets count 0.
    const claim = await prisma.post.updateMany({
      where: { id: postId, status: "SCHEDULED" },
      data: { status: "PUBLISHING" },
    });

    if (claim.count !== 1) {
      const current = await prisma.post.findUnique({
        where: { id: postId },
        select: { status: true },
      });

      if (current?.status === "PUBLISHING") {
        // A previous attempt crashed mid-publish (hard process kill), or a
        // concurrent worker is in flight. Check Google before deciding: if
        // our content is live, just record it; otherwise throw so BullMQ
        // retries — never publish on top of an unknown state.
        const live = await findLiveMatchingPost(post);
        if (live) {
          console.log(
            `Post ${postId} already live on Google as ${live.name}, marking PUBLISHED`
          );
          await markPublished(postId, live.name);
          return;
        }
        throw new Error(
          `Post ${postId} is in PUBLISHING but not found on Google — retrying`
        );
      }

      console.log(
        `Post ${postId} is ${current?.status ?? "missing"}, nothing to publish`
      );
      return;
    }

    try {
      // Claimed. Before writing, check Google for an identical live post —
      // an earlier attempt may have created it and died before recording it.
      const live = await findLiveMatchingPost(post);
      if (live) {
        console.log(
          `Post ${postId} already live on Google as ${live.name}, marking PUBLISHED`
        );
        await markPublished(postId, live.name);
        return;
      }

      const topicType = POST_TYPE_TO_GBP[post.type];

      const { url: mediaUrl, skipNote } = resolvePostMedia(post);
      if (skipNote) {
        console.warn(`Post ${postId}: ${skipNote}, publishing text-only`);
      }
      // An earlier attempt may have detached a Google-rejected image and
      // left its reason on the post — keep that note through this publish.
      const priorSkipNote = post.errorMessage?.startsWith("Image skipped:")
        ? post.errorMessage
        : null;

      let result;
      try {
        result = await createGBPPost({
          googleAccountId: post.profile.googleAccountId,
          accountResourceName: post.profile.accountResourceName,
          locationName: post.profile.locationName,
          summary: post.content,
          topicType,
          callToAction:
            post.callToAction && post.callToAction.startsWith("http")
              ? { actionType: "LEARN_MORE", url: post.callToAction }
              : undefined,
          media: mediaUrl
            ? [{ mediaFormat: "PHOTO" as const, sourceUrl: mediaUrl }]
            : undefined,
        });
      } catch (err) {
        // Google rejected the photo: detach it with a note, then rethrow.
        // The normal BullMQ retry publishes text-only through the same
        // claim/dedupe/limiter machinery — never a second GBP write inside
        // this job (the queue limiter is sized for one write per job, and an
        // unchecked second create could duplicate a post that actually
        // committed before the error). A 400 about something else rethrows
        // with the photo still attached.
        if (mediaUrl && isBadRequestError(err) && badRequestConcernsMedia(err)) {
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(
            `Post ${postId}: request with photo rejected (${reason}), detaching the image for the retry`
          );
          await prisma.post
            .update({
              where: { id: postId },
              data: {
                imageId: null,
                errorMessage: `Image skipped: ${reason}`.slice(0, 500),
              },
            })
            .catch((detachErr) =>
              console.error(
                `Failed to detach image on post ${postId}: ${detachErr}`
              )
            );
        }
        throw err;
      }

      await markPublished(postId, result.name, {
        mediaUrl,
        note: skipNote ?? priorSkipNote,
      });

      console.log(
        `Post ${postId} published successfully as ${result.name}` +
          (mediaUrl ? " (with image)" : "")
      );
    } catch (err) {
      // Release the claim so a retry can re-attempt. The live-post check
      // above keeps a timed-out-but-created post from being published twice.
      await prisma.post
        .updateMany({
          where: { id: postId, status: "PUBLISHING" },
          data: { status: "SCHEDULED" },
        })
        .catch((releaseErr) => {
          console.error(
            `Failed to release publish claim for post ${postId}: ${releaseErr}`
          );
        });
      throw err;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
    // GBP allows ~10 edits/min/profile, and bulk enqueues (batch approve,
    // onboarding) typically target a single profile — cap the whole queue
    // at 8 publishes/min so concurrent workers can never trip the limit.
    limiter: { max: 8, duration: 60_000 },
  }
);
logRedisErrors(worker, "post-publish-worker");

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed for post ${job.data.postId}`);
});

worker.on("failed", async (job, err) => {
  if (!job) return;

  console.error(
    `Job ${job.id} failed for post ${job.data.postId}: ${err.message}`
  );

  // On final attempt, mark post as FAILED
  const maxAttempts = job.opts.attempts ?? 3;
  if (job.attemptsMade >= maxAttempts) {
    console.error(`Post ${job.data.postId} permanently failed after ${job.attemptsMade} attempts`);
    try {
      await prisma.post.update({
        where: { id: job.data.postId },
        data: {
          status: "FAILED",
          errorMessage: err.message,
        },
      });
    } catch (updateErr) {
      console.error(`Failed to update post status: ${updateErr}`);
    }
  }
});

console.log("Publish worker started, waiting for jobs...");
