#!/usr/bin/env tsx
/**
 * Read-only snapshot of a single GBP Profile for the Vineyard Growth vault.
 *
 * Usage:
 *   pnpm tsx scripts/export-profile.ts <profileId>
 *
 * Emits one JSON object to stdout. Consumed by ~/VineyardGrowth/vault/scripts/sync-rankmaps.sh.
 *
 * Everything Google-side and everything RankMaps-side is emitted under
 * separate keys. They are not the same thing and were conflated until
 * 2026-09-10: `currentDescription` used to be the latest approved
 * ProfileDescription (a RankMaps draft) while the vault printed it as the
 * profile's live description, and a client who wrote their own description in
 * GBP therefore read as having none. Same for services, and same for
 * `responseStatus` on reviews, which is RankMaps' own reply record and says
 * nothing about a reply the owner left in GBP (that is repliedExternally).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { resolveReviewStats } from "../src/lib/review-stats";

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
      descriptions: { orderBy: { updatedAt: "desc" } },
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
      where: { profileId, removedAt: null },
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

  const liveAgg = await prisma.review.aggregate({
    where: { profileId, removedAt: null },
    _count: true,
    _avg: { rating: true },
  });
  const reviewStats = resolveReviewStats({
    googleReviewCount: profile.googleReviewCount,
    googleAverageRating: profile.googleAverageRating,
    liveSummary: { count: liveAgg._count, averageRating: liveAgg._avg.rating },
  });

  // Reviews Google shows as unanswered: nobody replied in GBP and RankMaps has
  // not published one either. A DRAFTED/APPROVED RankMaps response is not a
  // reply — it is a reply we have not sent.
  const unansweredOnGoogle = await prisma.review.count({
    where: {
      profileId,
      removedAt: null,
      repliedExternally: false,
      NOT: { response: { status: "PUBLISHED" } },
    },
  });

  // Google's own serviceItems, flattened to a name + description per item.
  // Structured items carry a serviceTypeId like
  // "job_type_id:gutter_installation"; the display name is the last segment.
  const googleServiceItems = Array.isArray(profile.googleServiceItems)
    ? (profile.googleServiceItems as Array<Record<string, unknown>>)
    : null;

  function googleServiceName(item: Record<string, unknown>): string {
    const free = item.freeFormServiceItem as
      | { label?: { displayName?: string } }
      | undefined;
    if (free?.label?.displayName) return free.label.displayName;
    const structured = item.structuredServiceItem as
      | { serviceTypeId?: string }
      | undefined;
    const raw = structured?.serviceTypeId;
    if (!raw) return "(unnamed service)";
    const last = raw.includes("/") ? raw.split("/").pop()! : raw;
    return last.replace(/^job_type_id:/, "").replace(/_/g, " ");
  }

  function googleServiceDescription(item: Record<string, unknown>): string | null {
    const structured = item.structuredServiceItem as
      | { description?: string }
      | undefined;
    if (structured?.description) return structured.description;
    const free = item.freeFormServiceItem as
      | { label?: { description?: string } }
      | undefined;
    return free?.label?.description ?? null;
  }

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
    // What Google itself returns for this location. syncedAt null means we
    // have never read it — which is NOT the same as Google having nothing,
    // and must never be rendered as "none".
    googleProfile: {
      syncedAt: profile.googleProfileSyncedAt?.toISOString() ?? null,
      description: profile.googleDescription,
      serviceItems:
        googleServiceItems === null
          ? null
          : googleServiceItems.map((item) => ({
              serviceName: googleServiceName(item),
              description: googleServiceDescription(item),
              isStructured: Boolean(item.structuredServiceItem),
            })),
    },
    // RankMaps' own drafts. These are what we wrote, at whatever stage of
    // approval; only the pushed ones ever reached Google, and even a pushed
    // one can have been overwritten in GBP since.
    rankmapsDraft: {
      description: profile.descriptions[0]
        ? {
            content: profile.descriptions[0].content,
            isApproved: profile.descriptions[0].isApproved,
            isPushed: profile.descriptions[0].isPushed,
            pushedAt: profile.descriptions[0].pushedAt?.toISOString() ?? null,
            updatedAt: profile.descriptions[0].updatedAt.toISOString(),
          }
        : null,
      services: profile.services.map((s) => ({
        serviceName: s.serviceName,
        description: s.description,
        isStructured: s.isStructured,
        isApproved: s.isApproved,
        isPushed: s.isPushed,
      })),
    },
    keywords: profile.keywords.map((k) => ({ keyword: k.keyword, sortOrder: k.sortOrder })),
    cities: profile.cities.map((c) => ({ city: c.city, sortOrder: c.sortOrder })),
    metrics30d,
    monthlyKeywords: monthlyKeywords.map((m) => ({
      month: m.month.toISOString(),
      keyword: m.keyword,
      impressions: m.impressions,
    })),
    reviewsSummary: {
      count: reviewStats.count,
      avgRating:
        reviewStats.averageRating === null ? null : Number(reviewStats.averageRating.toFixed(2)),
      source: reviewStats.source,
      // Live rows only (removedAt null), matching how the counts are taken.
      liveCount: liveAgg._count,
      unansweredOnGoogle,
    },
    reviews: reviews.map((r) => {
      const published = r.response?.status === "PUBLISHED";
      // One field, four states, so the renderer cannot invent a fifth.
      const replyState = r.repliedExternally
        ? "EXTERNAL"
        : published
          ? "PUBLISHED_BY_RANKMAPS"
          : r.response
            ? "RANKMAPS_DRAFT_ONLY"
            : "NONE";
      return {
        rating: r.rating,
        reviewerName: r.reviewerName,
        reviewDate: r.reviewDate.toISOString(),
        comment: r.comment,
        replyState,
        repliedExternally: r.repliedExternally,
        // RankMaps' own reply record. PENDING/DRAFTED/APPROVED mean nothing
        // is on Google; only PUBLISHED does.
        rankmapsResponseStatus: r.response?.status ?? null,
        rankmapsPublishedAt: r.response?.publishedAt?.toISOString() ?? null,
      };
    }),
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
