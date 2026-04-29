#!/usr/bin/env tsx
/**
 * 6-month performance snapshot of a GBP profile, optimised for Claude
 * to consume while drafting client update emails.
 *
 * Usage:
 *   pnpm tsx scripts/client-perf.ts "<client name>"
 *   pnpm tsx scripts/client-perf.ts --id <profileId>
 *   pnpm tsx scripts/client-perf.ts --list           # list all profiles
 *
 * Emits one JSON object to stdout with:
 *   - profile basics
 *   - 6 calendar months of metrics, broken out by month
 *   - 6-month totals
 *   - last complete month vs prior 4-month average (% change per metric)
 *   - top keywords aggregated over the period
 *   - review summary
 *   - human-readable summary lines
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

type Metric = {
  month: string;
  monthLabel: string;
  isPartial: boolean;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
  searchImpressions: number;
  mapsImpressions: number;
  totalImpressions: number;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function pct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

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

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--list") {
    const profiles = await prisma.profile.findMany({
      where: { isConnected: true },
      select: { id: true, name: true, address: true },
      orderBy: { name: "asc" },
    });
    process.stdout.write(JSON.stringify(profiles, null, 2));
    await prisma.$disconnect();
    return;
  }

  let profileArg: string | null = null;
  let isId = false;
  if (args[0] === "--id" && args[1]) {
    profileArg = args[1];
    isId = true;
  } else if (args[0]) {
    profileArg = args[0];
  }

  if (!profileArg) {
    console.error('usage: client-perf.ts "<client name>" | --id <profileId> | --list');
    process.exit(1);
  }

  const profile = await resolveProfile(profileArg, isId);
  if (!profile) {
    console.error(`profile not found: ${profileArg}`);
    process.exit(2);
  }

  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const windowStart = addMonths(currentMonthStart, -5);

  const [dailyMetrics, monthlyKeywords, reviewCount, avgRating, recentReviewCount] = await Promise.all([
    prisma.dailyMetric.findMany({
      where: { profileId: profile.id, date: { gte: windowStart } },
      orderBy: { date: "asc" },
    }),
    prisma.monthlyKeyword.findMany({
      where: { profileId: profile.id, month: { gte: windowStart } },
      orderBy: [{ month: "desc" }, { impressions: "desc" }],
    }),
    prisma.review.count({ where: { profileId: profile.id } }),
    prisma.review.aggregate({
      where: { profileId: profile.id },
      _avg: { rating: true },
    }),
    prisma.review.count({
      where: { profileId: profile.id, reviewDate: { gte: windowStart } },
    }),
  ]);

  const buckets: Map<string, Metric> = new Map();
  for (let i = 0; i < 6; i++) {
    const m = addMonths(windowStart, i);
    const key = m.toISOString().slice(0, 7);
    buckets.set(key, {
      month: key,
      monthLabel: `${MONTH_NAMES[m.getUTCMonth()]} ${m.getUTCFullYear()}`,
      isPartial: key === currentMonthStart.toISOString().slice(0, 7),
      callClicks: 0,
      websiteClicks: 0,
      directionRequests: 0,
      conversations: 0,
      searchImpressions: 0,
      mapsImpressions: 0,
      totalImpressions: 0,
    });
  }

  for (const d of dailyMetrics) {
    const key = d.date.toISOString().slice(0, 7);
    const b = buckets.get(key);
    if (!b) continue;
    b.callClicks += d.callClicks;
    b.websiteClicks += d.websiteClicks;
    b.directionRequests += d.directionRequests;
    b.conversations += d.conversations;
    const search = d.impressionsSearchDesktop + d.impressionsSearchMobile;
    const maps = d.impressionsMapsDesktop + d.impressionsMapsMobile;
    b.searchImpressions += search;
    b.mapsImpressions += maps;
    b.totalImpressions += search + maps;
  }

  const months = Array.from(buckets.values());
  const totals = months.reduce(
    (acc, m) => ({
      callClicks: acc.callClicks + m.callClicks,
      websiteClicks: acc.websiteClicks + m.websiteClicks,
      directionRequests: acc.directionRequests + m.directionRequests,
      conversations: acc.conversations + m.conversations,
      searchImpressions: acc.searchImpressions + m.searchImpressions,
      mapsImpressions: acc.mapsImpressions + m.mapsImpressions,
      totalImpressions: acc.totalImpressions + m.totalImpressions,
    }),
    {
      callClicks: 0, websiteClicks: 0, directionRequests: 0, conversations: 0,
      searchImpressions: 0, mapsImpressions: 0, totalImpressions: 0,
    }
  );

  const completeMonths = months.filter((m) => !m.isPartial);
  const lastComplete = completeMonths[completeMonths.length - 1];
  const priorComplete = completeMonths.slice(0, -1);

  const trend = lastComplete && priorComplete.length > 0
    ? {
        comparing: lastComplete.monthLabel,
        vsAvgOfPrior: priorComplete.map((m) => m.monthLabel).join(", "),
        callClicks: pct(
          lastComplete.callClicks,
          priorComplete.reduce((a, m) => a + m.callClicks, 0) / priorComplete.length
        ),
        websiteClicks: pct(
          lastComplete.websiteClicks,
          priorComplete.reduce((a, m) => a + m.websiteClicks, 0) / priorComplete.length
        ),
        directionRequests: pct(
          lastComplete.directionRequests,
          priorComplete.reduce((a, m) => a + m.directionRequests, 0) / priorComplete.length
        ),
        totalImpressions: pct(
          lastComplete.totalImpressions,
          priorComplete.reduce((a, m) => a + m.totalImpressions, 0) / priorComplete.length
        ),
      }
    : null;

  const keywordTotals: Map<string, number> = new Map();
  for (const k of monthlyKeywords) {
    keywordTotals.set(k.keyword, (keywordTotals.get(k.keyword) ?? 0) + k.impressions);
  }
  const topKeywords = Array.from(keywordTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([keyword, impressions]) => ({ keyword, impressions }));

  const highlights: string[] = [];
  if (lastComplete && trend) {
    const dir = (n: number | null) =>
      n === null ? "flat" : n > 0 ? `up ${n}%` : n < 0 ? `down ${Math.abs(n)}%` : "flat";
    highlights.push(
      `${lastComplete.monthLabel}: ${lastComplete.callClicks} calls (${dir(trend.callClicks)} vs prior 4-month avg), ${lastComplete.directionRequests} direction requests (${dir(trend.directionRequests)}), ${lastComplete.websiteClicks} website clicks (${dir(trend.websiteClicks)}).`
    );
    highlights.push(
      `Total impressions in ${lastComplete.monthLabel}: ${lastComplete.totalImpressions.toLocaleString()} (${dir(trend.totalImpressions)} vs prior 4-month avg).`
    );
  }
  if (completeMonths.length > 0) {
    const best = completeMonths.reduce((a, b) => (b.callClicks > a.callClicks ? b : a));
    const worst = completeMonths.reduce((a, b) => (b.callClicks < a.callClicks ? b : a));
    if (best.callClicks !== worst.callClicks) {
      highlights.push(
        `Best month for calls: ${best.monthLabel} (${best.callClicks}). Lowest: ${worst.monthLabel} (${worst.callClicks}).`
      );
    }
  }
  if (recentReviewCount > 0 && avgRating._avg.rating) {
    highlights.push(
      `${recentReviewCount} new review${recentReviewCount === 1 ? "" : "s"} in the last 6 months. All-time avg rating: ${Number(avgRating._avg.rating).toFixed(2)}.`
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
    window: {
      from: windowStart.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
      months: months.length,
    },
    months,
    totals6mo: totals,
    trend,
    topKeywords,
    reviews: {
      totalAllTime: reviewCount,
      avgRatingAllTime: avgRating._avg.rating ? Number(Number(avgRating._avg.rating).toFixed(2)) : null,
      newInWindow: recentReviewCount,
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
