/**
 * Re-match photos on unpublished, not-yet-due posts so no post/photo pair
 * looks nonsensical (the original image backfill assigned photos blind).
 * Coherent pairings — including manually picked photos — are KEPT; only
 * clashes are rewritten to a fitting photo, a generic, or no photo.
 *
 * Run scripts/backfill-image-captions.ts FIRST: profiles without captioned
 * images are skipped and reported.
 *
 * Safe to re-run: a second pass is all-KEEP. Concurrent publishes and
 * manual edits always win (guarded writes).
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/rematch-post-images.ts [--dry-run] [--profile=<name,name,...>]
 *
 * --profile limits the run to profiles whose name contains any of the
 * comma-separated substrings (case-insensitive) — targeted re-runs
 * shouldn't re-bill matcher calls for profiles already done.
 *
 * NOTE: --dry-run writes NOTHING to the database but DOES call the Claude
 * matcher (and bills for it) — the preview is meaningless without it.
 *
 * Requires DATABASE_URL and ANTHROPIC_API_KEY (dry run included).
 */
import { prisma } from "../src/lib/prisma";
import { rematchPostImages } from "../src/lib/rematch-post-images";

const dryRun = process.argv.includes("--dry-run");
const profileFilter = process.argv
  .filter((arg) => arg.startsWith("--profile="))
  .flatMap((arg) => arg.slice("--profile=".length).split(","))
  .map((name) => name.trim())
  .filter(Boolean);

async function main() {
  console.log(
    dryRun
      ? "Dry run — no database writes. Claude matcher calls WILL run and be billed."
      : "Re-matching photos on unpublished posts..."
  );

  const summary = await rematchPostImages({ dryRun, profileFilter });

  const verb = dryRun ? "proposed" : "changed";
  console.log("");
  console.log(
    `Done: ${summary.postsKept} kept, ${summary.postsChanged} ${verb}, ` +
      `${summary.postsSkipped} skipped across ${summary.profilesChecked} profiles.`
  );

  const proposals = summary.results.flatMap((r) =>
    r.proposals.map(
      (p) =>
        `  ${r.name} ${p.postId}: ${p.from ?? "(no photo)"} -> ${p.to ?? "(no photo)"} — ${p.reason}`
    )
  );
  if (proposals.length > 0) {
    console.log("");
    console.log(dryRun ? "Proposed changes:" : "Changes made:");
    for (const line of proposals) console.log(line);
  }

  if (summary.postsUnknownImage > 0) {
    console.log(
      `${summary.postsUnknownImage} post(s) skipped: their current photo has ` +
        `no caption yet — run scripts/backfill-image-captions.ts, then re-run.`
    );
  }
  if (summary.profilesZeroCaptioned.length > 0) {
    console.log(
      `No captioned images yet for: ${summary.profilesZeroCaptioned.join(", ")} — ` +
        `run scripts/backfill-image-captions.ts first.`
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
