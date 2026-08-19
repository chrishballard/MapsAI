/**
 * One-time backfill: attach library images to unpublished text-only posts
 * (future SCHEDULED + DRAFT) across all connected profiles, using the same
 * rotation as post generation. Profiles with an empty library are seeded
 * from their existing GBP photos first (pickImagesForPosts auto-sync).
 *
 * Safe to re-run: only posts still text-only and unpublished are touched.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/backfill-post-images.ts [--dry-run]
 *
 * Requires DATABASE_URL; a live run also needs GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI for the empty-library GBP sync.
 */
import { prisma } from "../src/lib/prisma";
import { backfillPostImages } from "../src/lib/backfill-post-images";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(
    dryRun
      ? "Dry run — counting what would change, writing nothing."
      : "Backfilling images onto text-only posts..."
  );

  const summary = await backfillPostImages({ dryRun });

  const verb = dryRun ? "would get" : "got";
  const profilesTouched = summary.results.filter((r) => r.assigned > 0).length;
  console.log("");
  console.log(
    `Done: ${summary.postsAssigned} post${summary.postsAssigned === 1 ? "" : "s"} ` +
      `${verb} an image across ${profilesTouched} of ` +
      `${summary.profilesChecked} profiles.`
  );
  if (summary.postsSkipped > 0) {
    console.log(
      `Skipped ${summary.postsSkipped} posts (changed concurrently or the ` +
        `image pick transiently failed — safe to re-run).`
    );
  }
  const noneApproved = summary.results
    .filter((r) => r.emptyReason === "NONE_APPROVED")
    .map((r) => r.name);
  const noImages = summary.results
    .filter((r) => r.emptyReason === "NO_IMAGES")
    .map((r) => r.name);
  if (noneApproved.length > 0) {
    console.log(
      `Images exist but none are approved for: ${noneApproved.join(", ")} — ` +
        `approve them on the Images page` +
        (dryRun ? " (a live run may also seed these from Google)." : ".")
    );
  }
  if (noImages.length > 0) {
    console.log(
      `No images at all for: ${noImages.join(", ")}` +
        (dryRun
          ? " — a live run will try seeding these from their Google photos first."
          : " — Google had none (or the sync was unavailable); add photos on the Images page.")
    );
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
