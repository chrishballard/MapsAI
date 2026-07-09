/**
 * Backfill MonthlyKeyword from the GBP Business Profile Performance API.
 *
 * Fetches search-keyword impressions for the last N completed months for
 * every connected profile and inserts them with createMany(skipDuplicates),
 * so it is safe to re-run and safe to run alongside the daily sync worker.
 *
 * Usage:
 *   node --import tsx scripts/backfill-keywords.ts [monthsBack] [concurrency]
 *
 * Requires DATABASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REDIRECT_URI in the environment.
 */
import { prisma } from "../src/lib/prisma";
import { fetchSearchKeywords } from "../src/lib/google-keywords";

const monthsBack = parseInt(process.argv[2] ?? "12", 10);
const concurrency = parseInt(process.argv[3] ?? "4", 10);

function completedMonths(n: number): Date[] {
  const now = new Date();
  const months: Date[] = [];
  for (let back = 1; back <= n; back++) {
    months.push(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    );
  }
  return months;
}

async function fetchWithRetry(
  googleAccountId: string,
  locationId: string,
  month: Date,
  attempts = 4
) {
  for (let i = 1; ; i++) {
    try {
      return await fetchSearchKeywords(googleAccountId, locationId, month, month);
    } catch (err: any) {
      const status = err?.response?.status ?? err?.code;
      const retryable = status === 429 || (typeof status === "number" && status >= 500);
      if (!retryable || i >= attempts) throw err;
      const delay = 2000 * 2 ** (i - 1);
      console.log(`  retry ${i} after ${status}, waiting ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function main() {
  const months = completedMonths(monthsBack);
  console.log(
    `Backfilling ${months.length} months (${months[months.length - 1].toISOString().slice(0, 7)} … ${months[0].toISOString().slice(0, 7)})`
  );

  const profiles = await prisma.profile.findMany({
    where: { isConnected: true, googleAccount: { isNot: undefined } },
    orderBy: { name: "asc" },
  });
  console.log(`${profiles.length} connected profiles`);

  let done = 0;
  let inserted = 0;
  let failedCalls = 0;
  const queue = [...profiles];

  async function runOne() {
    for (;;) {
      const profile = queue.shift();
      if (!profile) return;
      const locationId = profile.locationName.split("/").pop()!;
      let profileRows = 0;

      for (const month of months) {
        try {
          const keywords = await fetchWithRetry(
            profile.googleAccountId,
            locationId,
            month
          );
          if (keywords.length === 0) continue;
          const res = await prisma.monthlyKeyword.createMany({
            data: keywords.map((kw) => ({
              profileId: profile.id,
              month,
              keyword: kw.keyword,
              impressions: kw.impressions,
            })),
            skipDuplicates: true,
          });
          profileRows += res.count;
        } catch (err: any) {
          failedCalls++;
          console.error(
            `FAILED ${profile.name} ${month.toISOString().slice(0, 7)}: ${err?.message}`
          );
        }
      }

      done++;
      inserted += profileRows;
      console.log(
        `[${done}/${profiles.length}] ${profile.name}: +${profileRows} rows (total ${inserted})`
      );
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runOne));

  console.log(
    `Backfill complete: ${inserted} rows inserted, ${failedCalls} failed profile-month fetches`
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
