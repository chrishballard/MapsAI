import { prisma } from "./prisma";
import {
  pickImagesForPosts,
  markImagesUsed,
  isImageFkViolation,
} from "./post-images";

export interface ProfileBackfillResult {
  profileId: string;
  name: string;
  /** Text-only unpublished posts found (scheduled + drafts + legacy approved). */
  candidates: number;
  scheduled: number;
  drafts: number;
  approvedLegacy: number;
  /** Posts that got an image (or would, on a dry run). */
  assigned: number;
  /** Candidates passed over: became due/published, got an image concurrently,
   *  the picked image vanished, or the pick transiently failed. */
  skipped: number;
  /** No approved images even after the pick's auto-sync attempt. */
  libraryEmpty: boolean;
  /** Why the library is empty: no images at all, or none approved yet. */
  emptyReason?: "NO_IMAGES" | "NONE_APPROVED";
}

export interface BackfillSummary {
  dryRun: boolean;
  profilesChecked: number;
  postsAssigned: number;
  postsSkipped: number;
  profilesWithoutImages: string[];
  profilesErrored: string[];
  /** Per-profile detail, only for profiles that had candidate posts. */
  results: ProfileBackfillResult[];
}

/** The same criteria the candidate query uses, re-evaluated atomically at
 *  write time: a post that was published, became due, or got an image since
 *  the candidate query ran must be left alone (the publish worker may be
 *  processing it right now). */
function stillBackfillable() {
  return [
    { status: "SCHEDULED" as const, scheduledAt: { gt: new Date() } },
    { status: "DRAFT" as const },
    { status: "APPROVED" as const },
  ];
}

/**
 * One-time backfill for posts generated before the image library existed:
 * attach a library image to every unpublished text-only post, profile by
 * profile, using the same LRU rotation as the generation pipeline
 * (pickImagesForPosts — which also seeds an empty library from the profile's
 * existing GBP photos, so most profiles need no manual sync first).
 *
 * Scope: future SCHEDULED posts, DRAFTs, and legacy APPROVED posts — the
 * unpublished statuses. Published posts and posts already due are never
 * touched, and every write re-checks that atomically, so re-running is safe
 * and concurrent publishes or manual edits always win.
 *
 * A dry run stays strictly read-only: it counts candidates and approved
 * images but never writes and never triggers the GBP auto-sync.
 */
export async function backfillPostImages(
  options: { dryRun?: boolean; log?: (message: string) => void } = {}
): Promise<BackfillSummary> {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? console.log;

  // Same population the daily generation worker serves.
  const profiles = await prisma.profile.findMany({
    where: {
      isConnected: true,
      isOnboarded: true,
      accountResourceName: { not: null },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const summary: BackfillSummary = {
    dryRun,
    profilesChecked: 0,
    postsAssigned: 0,
    postsSkipped: 0,
    profilesWithoutImages: [],
    profilesErrored: [],
    results: [],
  };

  // Sequential on purpose: the empty-library auto-sync inside
  // pickImagesForPosts calls the GBP media API, and parallel profiles would
  // hammer it (same reason the generation worker runs profiles one at a time).
  for (const profile of profiles) {
    summary.profilesChecked++;
    let result: ProfileBackfillResult | null = null;
    let failed = false;
    const landed: string[] = [];

    try {
      const candidates = await prisma.post.findMany({
        where: {
          profileId: profile.id,
          imageId: null,
          OR: stillBackfillable(),
        },
        // Publish order first so the rotation lands on the soonest posts;
        // undated drafts trail behind.
        orderBy: [
          { scheduledAt: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
        ],
        select: { id: true, status: true },
      });

      if (candidates.length === 0) continue;

      result = {
        profileId: profile.id,
        name: profile.name,
        candidates: candidates.length,
        scheduled: candidates.filter((p) => p.status === "SCHEDULED").length,
        drafts: candidates.filter((p) => p.status === "DRAFT").length,
        approvedLegacy: candidates.filter((p) => p.status === "APPROVED")
          .length,
        assigned: 0,
        skipped: 0,
        libraryEmpty: false,
      };

      if (dryRun) {
        const approved = await prisma.profileImage.count({
          where: { profileId: profile.id, status: "APPROVED" },
        });
        if (approved > 0) {
          result.assigned = candidates.length;
        } else {
          await classifyEmptyLibrary(profile.id, result);
        }
      } else {
        const picks = await pickImagesForPosts(profile.id, candidates.length);

        if (picks.every((p) => p === null)) {
          const approved = await prisma.profileImage.count({
            where: { profileId: profile.id, status: "APPROVED" },
          });
          if (approved > 0) {
            // pickImagesForPosts swallows internal errors into all-nulls;
            // approved images exist, so this was transient — a re-run fixes it.
            result.skipped = candidates.length;
            log(
              `[backfill] ${profile.name}: image pick returned nothing despite ` +
                `${approved} approved image(s) — transient failure, re-run to retry`
            );
          } else {
            await classifyEmptyLibrary(profile.id, result);
          }
        } else {
          for (let i = 0; i < candidates.length; i++) {
            const imageId = picks[i];
            if (!imageId) continue;
            try {
              const updated = await prisma.post.updateMany({
                where: {
                  id: candidates[i].id,
                  imageId: null,
                  OR: stillBackfillable(),
                },
                data: { imageId },
              });
              if (updated.count === 1) {
                result.assigned++;
                landed.push(imageId);
              } else {
                result.skipped++;
              }
            } catch (err) {
              if (isImageFkViolation(err)) {
                result.skipped++;
                continue;
              }
              // Unexpected write error: stop this profile, but fall through
              // so the assignments that already landed are still accounted
              // for and marked used.
              failed = true;
              log(
                `[backfill] Write failed for ${profile.name}, stopping this profile: ${err}`
              );
              break;
            }
          }
        }
      }
    } catch (err) {
      failed = true;
      log(`[backfill] FAILED for ${profile.name}: ${err}`);
    }

    if (failed) summary.profilesErrored.push(profile.name);
    if (!result) continue;

    if (landed.length > 0) {
      await markImagesUsed(landed).catch((err) =>
        log(
          `[backfill] Failed to record image usage for ${profile.name}: ${err}`
        )
      );
    }

    summary.postsAssigned += result.assigned;
    summary.postsSkipped += result.skipped;
    if (result.libraryEmpty) summary.profilesWithoutImages.push(profile.name);
    summary.results.push(result);

    log(
      `[backfill] ${profile.name}: ${result.assigned}/${result.candidates}` +
        ` post${result.candidates === 1 ? "" : "s"}` +
        ` (${result.scheduled} scheduled, ${result.drafts} draft` +
        (result.approvedLegacy > 0
          ? `, ${result.approvedLegacy} legacy-approved`
          : "") +
        `)` +
        (result.emptyReason === "NONE_APPROVED"
          ? " — images exist but none are approved"
          : result.libraryEmpty
            ? " — no images in library"
            : "") +
        (result.skipped > 0 ? ` — ${result.skipped} skipped` : "") +
        (dryRun ? " [dry run]" : "")
    );
  }

  return summary;
}

async function classifyEmptyLibrary(
  profileId: string,
  result: ProfileBackfillResult
): Promise<void> {
  result.libraryEmpty = true;
  const total = await prisma.profileImage.count({ where: { profileId } });
  result.emptyReason = total > 0 ? "NONE_APPROVED" : "NO_IMAGES";
}
