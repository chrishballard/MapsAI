import { z } from "zod";
import { prisma } from "./prisma";
import { generate } from "./claude";
import { markImagesUsed, isImageFkViolation } from "./post-images";
import { stillBackfillable } from "./backfill-post-images";
import {
  MATCHER_SYSTEM_PROMPT,
  MAX_SPECIFIC_IMAGES_SENT,
  formatSpecificImageLines,
} from "./post-image-matcher";

/** Posts per matcher call — mirrors the generation batch cap. */
const REMATCH_CHUNK_SIZE = 12;

interface CaptionedImage {
  id: string;
  aiDescription: string | null;
  aiTags: string[];
  aiGeneric: boolean | null;
  captionedAt: Date | null;
}

interface CandidatePost {
  id: string;
  content: string;
  type: string;
  imageId: string | null;
  image: {
    aiDescription: string | null;
    aiTags: string[];
    aiGeneric: boolean | null;
    captionedAt: Date | null;
  } | null;
}

export interface RematchProposal {
  postId: string;
  from: string | null;
  to: string | null;
  reason: string;
}

export interface ProfileRematchResult {
  profileId: string;
  name: string;
  /** Posts the matcher reviewed. */
  candidates: number;
  /** Skipped before the matcher: current photo has no caption to judge. */
  unknownImage: number;
  kept: number;
  /** Pairings rewritten (or proposed, on a dry run). */
  changed: number;
  /** Lost races, invalid/duplicate replacement ids, missing generics. */
  skipped: number;
  proposals: RematchProposal[];
  zeroCaptioned: boolean;
}

export interface RematchSummary {
  dryRun: boolean;
  profilesChecked: number;
  postsKept: number;
  postsChanged: number;
  postsSkipped: number;
  postsUnknownImage: number;
  profilesZeroCaptioned: string[];
  profilesErrored: string[];
  results: ProfileRematchResult[];
}

/**
 * Re-match photos on already-created posts (the 580 blind-assigned by the
 * original backfill, plus anything since): for every unpublished, not-due
 * post, Claude reviews the post text against its current photo's caption
 * and KEEPs it unless the pairing would look nonsensical — so coherent
 * pairs (including manual picks) are never churned. Clashes get a fitting
 * specific photo, a generic, or no photo at all.
 *
 * Safety: writes are guarded updateMany calls re-checking, atomically, that
 * the post is still unpublished/not-due AND still carries exactly the image
 * we read — concurrent publishes and manual edits always win. Idempotent:
 * a second run is all-KEEP. Dry run performs zero DB writes but DOES call
 * the Claude matcher (the preview is meaningless without it).
 *
 * Profiles whose library has no captions yet are skipped and reported —
 * run scripts/backfill-image-captions.ts first.
 */
export async function rematchPostImages(
  options: { dryRun?: boolean; log?: (message: string) => void } = {}
): Promise<RematchSummary> {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? console.log;

  const profiles = await prisma.profile.findMany({
    where: {
      isConnected: true,
      isOnboarded: true,
      accountResourceName: { not: null },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true },
  });

  const summary: RematchSummary = {
    dryRun,
    profilesChecked: 0,
    postsKept: 0,
    postsChanged: 0,
    postsSkipped: 0,
    postsUnknownImage: 0,
    profilesZeroCaptioned: [],
    profilesErrored: [],
    results: [],
  };

  // Sequential on purpose: one profile's matcher calls at a time keeps the
  // Claude rate-limit footprint identical to the generation pipeline's.
  for (const profile of profiles) {
    summary.profilesChecked++;

    try {
      const result = await rematchProfile(profile, dryRun, log);
      if (!result) continue;

      summary.postsKept += result.kept;
      summary.postsChanged += result.changed;
      summary.postsSkipped += result.skipped;
      summary.postsUnknownImage += result.unknownImage;
      if (result.zeroCaptioned) {
        summary.profilesZeroCaptioned.push(profile.name);
      }
      summary.results.push(result);
    } catch (err) {
      summary.profilesErrored.push(profile.name);
      log(`[rematch] FAILED for ${profile.name}: ${err}`);
    }
  }

  return summary;
}

async function rematchProfile(
  profile: { id: string; name: string; category: string | null },
  dryRun: boolean,
  log: (message: string) => void
): Promise<ProfileRematchResult | null> {
  // Approved pool in LRU order — deliberately NO auto-sync here: a one-off
  // maintenance script shouldn't fan out to the GBP API.
  const pool: CaptionedImage[] = await prisma.profileImage.findMany({
    where: { profileId: profile.id, status: "APPROVED" },
    orderBy: [
      { lastUsedAt: { sort: "asc", nulls: "first" } },
      { timesUsed: "asc" },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      aiDescription: true,
      aiTags: true,
      aiGeneric: true,
      captionedAt: true,
    },
  });

  const posts: CandidatePost[] = await prisma.post.findMany({
    where: { profileId: profile.id, OR: stillBackfillable() },
    orderBy: [
      { scheduledAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      content: true,
      type: true,
      imageId: true,
      image: {
        select: {
          aiDescription: true,
          aiTags: true,
          aiGeneric: true,
          captionedAt: true,
        },
      },
    },
  });

  if (posts.length === 0) return null;

  const result: ProfileRematchResult = {
    profileId: profile.id,
    name: profile.name,
    candidates: 0,
    unknownImage: 0,
    kept: 0,
    changed: 0,
    skipped: 0,
    proposals: [],
    zeroCaptioned: false,
  };

  const captioned = pool.filter((img) => img.captionedAt);
  if (captioned.length === 0) {
    result.zeroCaptioned = true;
    log(
      `[rematch] ${profile.name}: no captioned images — run the caption ` +
        `backfill first, skipping ${posts.length} post(s)`
    );
    return result;
  }

  const generics = captioned.filter((img) => img.aiGeneric === true);
  const specifics = captioned.filter((img) => img.aiGeneric === false);
  const sentSpecifics = specifics.slice(0, MAX_SPECIFIC_IMAGES_SENT);
  const specificIds = new Set(sentSpecifics.map((img) => img.id));

  // A post whose current photo has no caption can't be judged — leave it
  // alone rather than second-guess blind.
  const eligible = posts.filter((post) => {
    if (post.imageId && post.image && !post.image.captionedAt) {
      result.unknownImage++;
      return false;
    }
    return true;
  });
  result.candidates = eligible.length;

  const usedSpecifics = new Set<string>();
  let genericCursor = 0;
  const landed: string[] = [];

  for (let start = 0; start < eligible.length; start += REMATCH_CHUNK_SIZE) {
    const chunk = eligible.slice(start, start + REMATCH_CHUNK_SIZE);

    let decisions: { action: string; imageId?: string; reason: string }[];
    try {
      decisions = await matchChunk(profile, chunk, sentSpecifics, generics);
    } catch (err) {
      result.skipped += chunk.length;
      log(
        `[rematch] ${profile.name}: matcher call failed for a chunk of ` +
          `${chunk.length} post(s) — re-run to retry: ${err}`
      );
      continue;
    }

    for (let i = 0; i < chunk.length; i++) {
      const post = chunk[i];
      const decision = decisions[i];

      if (decision.action === "KEEP") {
        result.kept++;
        continue;
      }

      let newImageId: string | null;
      if (decision.action === "DETACH") {
        newImageId = null;
      } else if (decision.action === "ASSIGN_GENERIC") {
        if (generics.length === 0) {
          result.skipped++;
          continue;
        }
        newImageId = generics[genericCursor++ % generics.length].id;
      } else if (decision.action === "ASSIGN") {
        const id = decision.imageId;
        if (!id || !specificIds.has(id) || usedSpecifics.has(id)) {
          result.skipped++;
          continue;
        }
        usedSpecifics.add(id);
        newImageId = id;
      } else {
        result.skipped++;
        continue;
      }

      if (newImageId === post.imageId) {
        result.kept++;
        continue;
      }

      result.proposals.push({
        postId: post.id,
        from: post.imageId,
        to: newImageId,
        reason: decision.reason,
      });

      if (dryRun) {
        result.changed++;
        continue;
      }

      try {
        const updated = await prisma.post.updateMany({
          where: {
            id: post.id,
            // Exactly the pairing we judged — a manual edit or concurrent
            // publish since the read means our verdict no longer applies.
            imageId: post.imageId,
            OR: stillBackfillable(),
          },
          data: { imageId: newImageId },
        });
        if (updated.count === 1) {
          result.changed++;
          if (newImageId) landed.push(newImageId);
        } else {
          result.skipped++;
        }
      } catch (err) {
        if (isImageFkViolation(err)) {
          result.skipped++;
          continue;
        }
        throw err;
      }
    }
  }

  if (!dryRun && landed.length > 0) {
    await markImagesUsed(landed).catch((err) =>
      log(`[rematch] Failed to record image usage for ${profile.name}: ${err}`)
    );
  }

  log(
    `[rematch] ${profile.name}: ${result.kept} kept, ${result.changed} ` +
      `${dryRun ? "proposed" : "changed"}` +
      (result.unknownImage > 0
        ? `, ${result.unknownImage} unknown-photo`
        : "") +
      (result.skipped > 0 ? `, ${result.skipped} skipped` : "") +
      (dryRun ? " [dry run]" : "")
  );

  return result;
}

async function matchChunk(
  profile: { name: string; category: string | null },
  chunk: CandidatePost[],
  sentSpecifics: CaptionedImage[],
  generics: CaptionedImage[]
): Promise<{ action: string; imageId?: string; reason: string }[]> {
  const hasSpecifics = sentSpecifics.length > 0;
  const hasGenerics = generics.length > 0;

  const actionValues = hasSpecifics
    ? (["KEEP", "ASSIGN", "ASSIGN_GENERIC", "DETACH"] as [string, ...string[]])
    : (["KEEP", "ASSIGN_GENERIC", "DETACH"] as [string, ...string[]]);

  const decisionShape: Record<string, z.ZodType> = {
    action: z.enum(actionValues),
    reason: z.string().max(140),
  };
  if (hasSpecifics) {
    decisionShape.imageId = z
      .enum(sentSpecifics.map((img) => img.id) as [string, ...string[]])
      .optional();
  }
  const schema = z.object({
    decisions: z.array(z.object(decisionShape)).length(chunk.length),
  });

  const prompt = [
    `Business: ${profile.name}`,
    profile.category ? `Category: ${profile.category}` : null,
    "",
    "Scheduled posts and their current photos:",
    ...chunk.map((post, i) => {
      const current = post.imageId
        ? (post.image?.aiDescription ?? "(captioned photo)")
        : "no photo";
      return `${i + 1}. [${post.type}] "${post.content}" — current photo: ${current}`;
    }),
    "",
    ...(hasSpecifics
      ? [
          "Available subject-specific photos (least-recently-used first):",
          ...formatSpecificImageLines(
            sentSpecifics.map((img) => ({
              id: img.id,
              description: img.aiDescription,
              tags: img.aiTags,
            }))
          ),
          "",
        ]
      : []),
    hasGenerics
      ? "Generic photos (storefront/team/logo) are also available."
      : "No generic photos are available.",
    "",
    `Return one decision per post, in order (${chunk.length} total):`,
    "- KEEP unless the current pairing would look nonsensical together (a post with no photo may also simply stay photo-less). KEEP is the default.",
    ...(hasSpecifics
      ? [
          "- ASSIGN with a photo id (copied exactly from the list) ONLY when that photo clearly fits the post's subject. Never ASSIGN the same photo to two posts.",
        ]
      : []),
    "- ASSIGN_GENERIC to swap in a generic photo when the current photo clashes and no specific photo fits.",
    "- DETACH when even a generic photo would look odd next to the post.",
    "Give a short reason for every decision.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const result = await generate({
    system: MATCHER_SYSTEM_PROMPT,
    prompt,
    schema,
    maxTokens: 2048,
    errorMessage: "Failed to parse rematch decisions from Claude",
  });

  const decisions = result.decisions as {
    action: string;
    imageId?: string;
    reason: string;
  }[];
  if (decisions.length !== chunk.length) {
    throw new Error(
      `matcher returned ${decisions.length} decisions for ${chunk.length} posts`
    );
  }
  return decisions;
}
