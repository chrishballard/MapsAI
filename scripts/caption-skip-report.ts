/**
 * READ-ONLY diagnostic for permanently skipped caption images: breaks the
 * skips down by reason, and live-tests a sample of FETCH_DENIED googleUrls
 * to distinguish genuinely stale URLs (still 4xx) from a rate-limit burst
 * during the backfill (now 200 — recoverable by clearing the skip).
 *
 * Writes NOTHING to the database and calls no AI.
 *
 * Usage:
 *   node --env-file=<.env> --env-file=<prod.env> --import tsx scripts/caption-skip-report.ts
 */
import { prisma } from "../src/lib/prisma";

const SAMPLE_SIZE = 20;

async function main() {
  const byReason = await prisma.profileImage.groupBy({
    by: ["captionSkipReason"],
    where: { captionSkipReason: { not: null } },
    _count: { _all: true },
  });

  console.log("Permanent caption skips by reason:");
  for (const row of byReason) {
    console.log(`  ${row.captionSkipReason}: ${row._count._all}`);
  }
  if (byReason.length === 0) {
    console.log("  (none)");
    await prisma.$disconnect();
    return;
  }

  const denied = await prisma.profileImage.findMany({
    where: { captionSkipReason: "FETCH_DENIED", googleUrl: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: SAMPLE_SIZE,
    select: { id: true, googleUrl: true, profile: { select: { name: true } } },
  });

  if (denied.length === 0) {
    console.log("\nNo FETCH_DENIED rows to sample.");
    await prisma.$disconnect();
    return;
  }

  console.log(
    `\nLive-testing ${denied.length} sampled FETCH_DENIED URLs (read-only):`
  );
  const statusTally = new Map<string, number>();
  for (const row of denied) {
    let status: string;
    try {
      const response = await fetch(row.googleUrl!, {
        signal: AbortSignal.timeout(8000),
      });
      status = String(response.status);
      // Discard the body — only the status matters.
      await response.body?.cancel();
    } catch (err) {
      status = `error (${err instanceof Error ? err.message : String(err)})`;
    }
    statusTally.set(status, (statusTally.get(status) ?? 0) + 1);
    console.log(`  [${status}] ${row.profile.name} ${row.id}`);
  }

  console.log("\nSample status tally:");
  for (const [status, count] of statusTally) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(
    "\nInterpretation: mostly 200 = the backfill got rate-limited and these " +
      "are recoverable (skips can be cleared and re-run); mostly 4xx = the " +
      "URLs really are stale/denied and the skips are correct."
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
