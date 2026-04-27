#!/usr/bin/env tsx
/**
 * Read-only snapshot of a single GBP Profile for the Vineyard Growth vault.
 *
 * Usage:
 *   pnpm tsx scripts/export-profile.ts <profileId>
 *
 * Emits one JSON object to stdout. Consumed by ~/VineyardGrowth/vault/scripts/sync-rankmaps.sh.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const profileId = process.argv[2];
  if (!profileId) {
    console.error("usage: export-profile.ts <profileId>");
    process.exit(1);
  }

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      keywords: { orderBy: { sortOrder: "asc" } },
      cities: { orderBy: { sortOrder: "asc" } },
      services: { orderBy: { serviceName: "asc" } },
      descriptions: { where: { isApproved: true }, orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });

  if (!profile) {
    console.error(`profile not found: ${profileId}`);
    process.exit(2);
  }

  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);

  const since12mo = new Date();
  since12mo.setMonth(since12mo.getMonth() - 12);

  const [dailyMetrics, monthlyKeywords, reviews, posts] = await Promise.all([
    prisma.dailyMetric.findMany({
      where: { profileId, date: { gte: since30 } },
      orderBy: { date: "desc" },
    }),
    prisma.monthlyKeyword.findMany({
      where: { profileId, month: { gte: since12mo } },
      orderBy: [{ month: "desc" }, { impressions: "desc" }],
    }),
    prisma.review.findMany({
      where: { profileId },
      include: { response: true },
      orderBy: { reviewDate: "desc" },
      take: 20,
    }),
    prisma.post.findMany({
      where: { profileId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const metrics30d = dailyMetrics.reduce(
    (acc, m) => ({
      impressionsSearchDesktop: acc.impressionsSearchDesktop + m.impressionsSearchDesktop,
      impressionsSearchMobile: acc.impressionsSearchMobile + m.impressionsSearchMobile,
      impressionsMapsDesktop: acc.impressionsMapsDesktop + m.impressionsMapsDesktop,
      impressionsMapsMobile: acc.impressionsMapsMobile + m.impressionsMapsMobile,
      websiteClicks: acc.websiteClicks + m.websiteClicks,
      callClicks: acc.callClicks + m.callClicks,
      directionRequests: acc.directionRequests + m.directionRequests,
      conversations: acc.conversations + m.conversations,
    }),
    {
      impressionsSearchDesktop: 0,
      impressionsSearchMobile: 0,
      impressionsMapsDesktop: 0,
      impressionsMapsMobile: 0,
      websiteClicks: 0,
      callClicks: 0,
      directionRequests: 0,
      conversations: 0,
    }
  );

  const reviewCount = await prisma.review.count({ where: { profileId } });
  const avg = await prisma.review.aggregate({
    where: { profileId },
    _avg: { rating: true },
  });

  const out = {
    profile: {
      id: profile.id,
      name: profile.name,
      address: profile.address,
      phone: profile.phone,
      category: profile.category,
      websiteUrl: profile.websiteUrl,
      placeId: profile.placeId,
      locationName: profile.locationName,
      isOnboarded: profile.isOnboarded,
      postFrequency: profile.postFrequency,
    },
    currentDescription: profile.descriptions[0]?.content ?? null,
    services: profile.services.map((s) => ({
      serviceName: s.serviceName,
      description: s.description,
      isStructured: s.isStructured,
      isApproved: s.isApproved,
      isPushed: s.isPushed,
    })),
    keywords: profile.keywords.map((k) => ({ keyword: k.keyword, sortOrder: k.sortOrder })),
    cities: profile.cities.map((c) => ({ city: c.city, sortOrder: c.sortOrder })),
    metrics30d,
    monthlyKeywords: monthlyKeywords.map((m) => ({
      month: m.month.toISOString(),
      keyword: m.keyword,
      impressions: m.impressions,
    })),
    reviewsSummary: {
      count: reviewCount,
      avgRating: avg._avg.rating ? Number(avg._avg.rating.toFixed(2)) : null,
    },
    reviews: reviews.map((r) => ({
      rating: r.rating,
      reviewerName: r.reviewerName,
      reviewDate: r.reviewDate.toISOString(),
      comment: r.comment,
      responseStatus: r.response?.status ?? null,
    })),
    posts: posts.map((p) => ({
      type: p.type,
      status: p.status,
      content: p.content,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    exportedAt: new Date().toISOString(),
  };

  process.stdout.write(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
