import { prisma } from "./prisma";
import { captionImages, type CaptionSkipReason } from "./image-captioner";

// Rough per-image cost at the pinned Sonnet model ($3/M input, $15/M output).
// GBP-hosted photos are fetched full-size (the API downscales to ~1,600
// image tokens); uploads are captioned from the ~480px thumbnail (~250
// tokens). Both add ~400 prompt tokens in and ~150 out.
const EST_COST_GBP_IMAGE_USD = (2000 * 3 + 150 * 15) / 1_000_000; // ~$0.0083
const EST_COST_UPLOAD_IMAGE_USD = (650 * 3 + 150 * 15) / 1_000_000; // ~$0.0042

const CAPTION_CONCURRENCY = 3;

export interface ProfileCaptionResult {
  profileId: string;
  name: string;
  /** APPROVED images without captions at scan time. */
  uncaptioned: number;
  /** Of those, hosted by Google (URL fetch, higher token cost). */
  gbp: number;
  uploads: number;
  captioned: number;
  /** Permanent skips (no usable input) — never retried. */
  skipped: number;
  /** Transient failures — a re-run retries these. */
  failed: number;
  skipReasons: Partial<Record<CaptionSkipReason, number>>;
}

export interface CaptionBackfillSummary {
  dryRun: boolean;
  profilesChecked: number;
  imagesUncaptioned: number;
  imagesCaptioned: number;
  imagesSkipped: number;
  imagesFailed: number;
  /** Estimated Claude spend for captioning every uncaptioned image found. */
  estimatedCostUsd: number;
  profilesErrored: string[];
  /** Per-profile detail, only for profiles that had uncaptioned images. */
  results: ProfileCaptionResult[];
}

/**
 * One-time caption backfill: run Claude vision over every APPROVED library
 * image that has no caption yet, so post/photo matching has data to work
 * with (uncaptioned pools fall back to the old blind rotation).
 *
 * A dry run is fully inert — no DB writes AND no Claude calls; it counts
 * the uncaptioned images and estimates the spend so the live run can be
 * approved knowingly. Live runs are idempotent (captionedAt-null filter),
 * process profiles sequentially with bounded per-profile concurrency, and
 * tolerate per-image failures (re-run to retry transient ones).
 */
export async function backfillImageCaptions(
  options: { dryRun?: boolean; log?: (message: string) => void } = {}
): Promise<CaptionBackfillSummary> {
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

  const summary: CaptionBackfillSummary = {
    dryRun,
    profilesChecked: 0,
    imagesUncaptioned: 0,
    imagesCaptioned: 0,
    imagesSkipped: 0,
    imagesFailed: 0,
    estimatedCostUsd: 0,
    profilesErrored: [],
    results: [],
  };

  for (const profile of profiles) {
    summary.profilesChecked++;

    try {
      const images = await prisma.profileImage.findMany({
        where: {
          profileId: profile.id,
          status: "APPROVED",
          captionedAt: null,
          // Permanent skips are recorded on the row and never retried.
          captionSkipReason: null,
        },
        orderBy: { createdAt: "asc" },
        // Never pull image bytes just to count rows.
        select: { id: true, source: true },
      });

      if (images.length === 0) continue;

      const gbp = images.filter((img) => img.source === "GBP").length;
      const uploads = images.length - gbp;
      const result: ProfileCaptionResult = {
        profileId: profile.id,
        name: profile.name,
        uncaptioned: images.length,
        gbp,
        uploads,
        captioned: 0,
        skipped: 0,
        failed: 0,
        skipReasons: {},
      };

      summary.imagesUncaptioned += images.length;
      summary.estimatedCostUsd +=
        gbp * EST_COST_GBP_IMAGE_USD + uploads * EST_COST_UPLOAD_IMAGE_USD;

      if (!dryRun) {
        const outcomes = await captionImages(
          images.map((img) => img.id),
          { concurrency: CAPTION_CONCURRENCY, log }
        );
        for (const outcome of outcomes) {
          if (outcome.ok) {
            result.captioned++;
          } else if (outcome.skipped) {
            result.skipped++;
            result.skipReasons[outcome.skipped] =
              (result.skipReasons[outcome.skipped] ?? 0) + 1;
          } else {
            result.failed++;
          }
        }
      }

      summary.imagesCaptioned += result.captioned;
      summary.imagesSkipped += result.skipped;
      summary.imagesFailed += result.failed;
      summary.results.push(result);

      log(
        `[caption-backfill] ${profile.name}: ${result.uncaptioned} uncaptioned` +
          ` (${result.gbp} Google-hosted, ${result.uploads} uploaded)` +
          (dryRun
            ? " [dry run]"
            : ` — ${result.captioned} captioned` +
              (result.skipped > 0 ? `, ${result.skipped} skipped` : "") +
              (result.failed > 0 ? `, ${result.failed} failed` : ""))
      );
    } catch (err) {
      summary.profilesErrored.push(profile.name);
      log(`[caption-backfill] FAILED for ${profile.name}: ${err}`);
    }
  }

  return summary;
}
