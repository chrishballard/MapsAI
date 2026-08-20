/**
 * READ-ONLY diagnostic for permanently skipped caption images: breaks the
 * skips down by reason, prints sample rows, and live-tests candidate CDN
 * size-variant URL forms for TOO_LARGE rows (headers only, bodies
 * discarded) so the captioner's downscale logic can be fixed empirically.
 *
 * Writes NOTHING to the database and calls no AI.
 *
 * Usage:
 *   node --env-file=<.env> --env-file=<prod.env> --import tsx scripts/caption-skip-report.ts
 */
import { prisma } from "../src/lib/prisma";

const SAMPLE_SIZE = 5;

async function probe(url: string): Promise<string> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const type = response.headers.get("content-type") ?? "?";
    const length = response.headers.get("content-length") ?? "?";
    await response.body?.cancel();
    return `HTTP ${response.status}, type=${type}, bytes=${length}`;
  } catch (err) {
    return `error (${err instanceof Error ? err.message : String(err)})`;
  }
}

function candidateUrls(url: string): { label: string; url: string }[] {
  const candidates: { label: string; url: string }[] = [
    { label: "raw", url },
  ];
  if (url.includes("=")) {
    candidates.push({
      label: "tail-replaced =s512",
      url: url.replace(/=[^/=]*$/, "=s512"),
    });
  } else {
    candidates.push(
      { label: "appended =s512", url: `${url}=s512` },
      { label: "appended =w512-h512-k-no", url: `${url}=w512-h512-k-no` }
    );
  }
  return candidates;
}

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

  const tooLarge = await prisma.profileImage.findMany({
    where: { captionSkipReason: "TOO_LARGE", googleUrl: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: SAMPLE_SIZE,
    select: {
      id: true,
      googleUrl: true,
      width: true,
      height: true,
      byteSize: true,
      profile: { select: { name: true } },
    },
  });

  for (const row of tooLarge) {
    console.log(`\n${row.profile.name} ${row.id}`);
    console.log(`  stored dimensions: ${row.width}x${row.height}`);
    console.log(`  googleUrl: ${row.googleUrl}`);
    for (const candidate of candidateUrls(row.googleUrl!)) {
      const result = await probe(candidate.url);
      console.log(`  [${candidate.label}] ${result}`);
      if (candidate.label !== "raw") {
        console.log(`    -> ${candidate.url}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
