#!/usr/bin/env tsx
/**
 * 6-month performance snapshot of a GBP profile, optimised for Claude
 * to consume while drafting client update emails.
 *
 * Usage:
 *   pnpm tsx scripts/client-perf.ts "<client name>"
 *   pnpm tsx scripts/client-perf.ts --id <profileId>
 *   pnpm tsx scripts/client-perf.ts "<client name>" --id <profileId>
 *   pnpm tsx scripts/client-perf.ts --list           # list all profiles
 *
 * --id and --list are recognised anywhere in argv, not just as the first
 * argument: the disambiguation message tells you to "re-run with --id", and
 * the natural way to do that is to append it to the command you just typed.
 * When both a name and --id are given the id wins and the name is ignored.
 *
 * Emits one JSON object to stdout with:
 *   - profile basics
 *   - 6 calendar months of metrics, broken out by month
 *   - 6-month totals
 *   - last complete month vs the average of the prior fully synced months
 *     (up to 4; % change per metric, and a note when the history is shorter)
 *   - top keywords aggregated over the period
 *   - review summary
 *   - human-readable summary lines
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { resolveReviewStats } from "../src/lib/review-stats";
import { buildPerfSnapshot, perfWindow } from "./perf-snapshot";

async function resolveProfile(arg: string, isId: boolean) {
  if (isId) {
    return prisma.profile.findUnique({ where: { id: arg } });
  }
  const matches = await prisma.profile.findMany({
    where: {
      isConnected: true,
      name: { contains: arg, mode: "insensitive" },
    },
    orderBy: { name: "asc" },
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.error(`multiple profiles match "${arg}":`);
    for (const m of matches) console.error(`  ${m.id}  ${m.name}`);
    console.error(`re-run with --id <profileId> to disambiguate`);
    process.exit(3);
  }
  return matches[0];
}

/**
 * Positional name plus --id/--list in any order. --id consumes the following
 * argument; anything else that is not a flag is the (optional) name.
 */
function parseArgs(argv: string[]): { list: boolean; id: string | null; name: string | null } {
  let list = false;
  let id: string | null = null;
  let name: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") {
      list = true;
    } else if (arg === "--id") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error("--id requires a profileId");
        process.exit(1);
      }
      id = value;
      i++;
    } else if (arg.startsWith("--id=")) {
      id = arg.slice("--id=".length);
    } else if (arg.startsWith("--")) {
      console.error(`unknown flag: ${arg}`);
      process.exit(1);
    } else if (name === null) {
      name = arg;
    }
  }

  return { list, id, name };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const profiles = await prisma.profile.findMany({
      where: { isConnected: true },
      select: { id: true, name: true, address: true },
      orderBy: { name: "asc" },
    });
    process.stdout.write(JSON.stringify(profiles, null, 2));
    await prisma.$disconnect();
    return;
  }

  // An explicit id always wins: the name is only a lookup key for the id, so
  // when both are present the caller has already resolved the ambiguity.
  const isId = args.id !== null;
  const profileArg = args.id ?? args.name;

  if (!profileArg) {
    console.error('usage: client-perf.ts "<client name>" [--id <profileId>] | --id <profileId> | --list');
    process.exit(1);
  }

  const profile = await resolveProfile(profileArg, isId);
  if (!profile) {
    console.error(`profile not found: ${profileArg}`);
    process.exit(2);
  }

  const now = new Date();
  const { windowStart } = perfWindow(now);

  const [dailyMetrics, monthlyKeywords, liveAgg, recentReviewCount] = await Promise.all([
    prisma.dailyMetric.findMany({
      where: { profileId: profile.id, date: { gte: windowStart } },
      orderBy: { date: "asc" },
    }),
    prisma.monthlyKeyword.findMany({
      where: { profileId: profile.id, month: { gte: windowStart } },
      orderBy: [{ month: "desc" }, { impressions: "desc" }],
    }),
    prisma.review.aggregate({
      where: { profileId: profile.id, removedAt: null },
      _count: true,
      _avg: { rating: true },
    }),
    prisma.review.count({
      where: { profileId: profile.id, removedAt: null, reviewDate: { gte: windowStart } },
    }),
  ]);

  // Google's own count/rating for the location — what Maps and Search show
  // and what clients recognise. Stored rows are only the fallback before
  // the first sync lands a Google figure.
  const reviewStats = resolveReviewStats({
    googleReviewCount: profile.googleReviewCount,
    googleAverageRating: profile.googleAverageRating,
    liveSummary: { count: liveAgg._count, averageRating: liveAgg._avg.rating },
  });

  const snapshot = buildPerfSnapshot(dailyMetrics, now);

  const keywordTotals: Map<string, number> = new Map();
  for (const k of monthlyKeywords) {
    keywordTotals.set(k.keyword, (keywordTotals.get(k.keyword) ?? 0) + k.impressions);
  }
  const topKeywords = Array.from(keywordTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([keyword, impressions]) => ({ keyword, impressions }));

  const highlights = [...snapshot.highlights];
  if (recentReviewCount > 0 && reviewStats.averageRating !== null) {
    highlights.push(
      `${recentReviewCount} new review${recentReviewCount === 1 ? "" : "s"} in the last 6 months. All-time avg rating: ${reviewStats.averageRating.toFixed(2)}.`
    );
  }

  const out = {
    profile: {
      id: profile.id,
      name: profile.name,
      address: profile.address,
      phone: profile.phone,
      category: profile.category,
      websiteUrl: profile.websiteUrl,
    },
    window: snapshot.window,
    months: snapshot.months,
    totals6mo: snapshot.totals,
    trend: snapshot.trend,
    trendUnavailable: snapshot.trendUnavailable,
    topKeywords,
    reviews: {
      totalAllTime: reviewStats.count,
      avgRatingAllTime:
        reviewStats.averageRating === null ? null : Number(reviewStats.averageRating.toFixed(2)),
      newInWindow: recentReviewCount,
      // "google" = Google's own count for the location (matches Maps/Search).
      // "rankmaps" = fallback count of stored reviews, only before the first sync.
      source: reviewStats.source,
      googleSyncedAt: profile.reviewStatsSyncedAt?.toISOString() ?? null,
    },
    highlights,
    generatedAt: new Date().toISOString(),
  };

  process.stdout.write(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
