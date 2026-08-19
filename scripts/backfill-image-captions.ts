/**
 * One-time caption backfill: run Claude vision over every APPROVED library
 * image that has no caption yet, so post/photo matching has data to work
 * with. Safe to re-run: already-captioned images are excluded, and
 * transient per-image failures are retried on the next run.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/backfill-image-captions.ts [--dry-run] [--retry-too-large]
 *
 * Dry run is fully inert — no DB writes, no Claude calls. It prints the
 * per-profile image counts and the estimated Claude spend so the live run
 * can be approved knowingly.
 *
 * --retry-too-large clears TOO_LARGE skips first so the run retries them
 * (for after the sized-CDN-variant fix made oversized originals work).
 *
 * Requires DATABASE_URL; a live run also needs ANTHROPIC_API_KEY.
 */
import { prisma } from "../src/lib/prisma";
import { backfillImageCaptions } from "../src/lib/backfill-image-captions";

const dryRun = process.argv.includes("--dry-run");
const retryTooLarge = process.argv.includes("--retry-too-large");

async function main() {
  console.log(
    dryRun
      ? "Dry run — counting uncaptioned images and estimating cost; no writes, no Claude calls."
      : "Captioning library images with Claude vision..."
  );

  const summary = await backfillImageCaptions({ dryRun, retryTooLarge });

  console.log("");
  if (dryRun) {
    console.log(
      `Found ${summary.imagesUncaptioned} uncaptioned image(s) across ` +
        `${summary.results.length} of ${summary.profilesChecked} profiles.`
    );
    console.log(
      `Estimated one-time cost to caption them: ~$${summary.estimatedCostUsd.toFixed(2)}.`
    );
  } else {
    console.log(
      `Done: ${summary.imagesCaptioned}/${summary.imagesUncaptioned} image(s) ` +
        `captioned across ${summary.results.length} of ` +
        `${summary.profilesChecked} profiles.`
    );
    if (summary.imagesSkipped > 0) {
      console.log(
        `Skipped ${summary.imagesSkipped} image(s) permanently (no usable ` +
          `input — e.g. stale Google URL or unsupported format).`
      );
    }
    if (summary.imagesFailed > 0) {
      console.log(
        `${summary.imagesFailed} image(s) failed transiently — re-run this ` +
          `script to retry them.`
      );
      process.exitCode = 1;
    }
  }
  if (summary.profilesErrored.length > 0) {
    console.log(
      `FAILED for ${summary.profilesErrored.length} profile(s): ` +
        summary.profilesErrored.join(", ")
    );
    process.exitCode = 1;
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
