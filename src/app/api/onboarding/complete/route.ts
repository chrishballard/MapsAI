import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateMonthlyPosts } from "@/lib/post-generator";
import { PostType } from "@/generated/prisma/client";
import { fetchReviews, STAR_RATING_MAP } from "@/lib/google-reviews";
import { generateReviewResponse } from "@/lib/review-responder";
import {
  fetchDailyMetrics,
  parseMetricsResponse,
} from "@/lib/google-performance";
import { fetchSearchKeywords } from "@/lib/google-keywords";
import { calculateScheduleDates } from "@/lib/scheduling";
import { schedulePostPublish } from "@/lib/queue/publish-queue";
import { initReviewSyncScheduler } from "@/lib/queue/review-sync-queue";
import { initMetricsSyncScheduler } from "@/lib/queue/metrics-sync-queue";
import { scheduleReviewPublish } from "@/lib/queue/review-publish-queue";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { profileId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  try {
    // Step 1: Mark onboarding complete and set isOnboarded
    const [progress] = await prisma.$transaction([
      prisma.onboardingProgress.update({
        where: { profileId: body.profileId },
        data: {
          isComplete: true,
          completedAt: new Date(),
        },
      }),
      prisma.profile.update({
        where: { id: body.profileId },
        data: { isOnboarded: true },
      }),
    ]);

    // Step 2: Kick off initial data sync in the background (don't block the response)
    const profileId = body.profileId;
    initialSync(profileId).catch((err) =>
      console.error(`[onboarding-complete] Initial sync failed for ${profileId}:`, err)
    );

    return NextResponse.json({
      success: true,
      completedAt: progress.completedAt,
    });
  } catch {
    return NextResponse.json(
      { error: "No onboarding progress found for this profile" },
      { status: 404 }
    );
  }
}

async function initialSync(profileId: string) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      googleAccount: true,
      promptTemplate: true,
    },
  });

  if (!profile) return;

  // --- Generate initial monthly posts ---
  try {
    console.log(`[onboarding-complete] Generating posts for ${profile.name}`);

    const [keywordRecords, cityRecords] = await Promise.all([
      prisma.profileKeyword.findMany({
        where: { profileId },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.profileCity.findMany({
        where: { profileId },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    const generated = await generateMonthlyPosts(
      {
        name: profile.name,
        category: profile.category,
        address: profile.address,
        keywords: keywordRecords.map((k) => k.keyword),
        cities: cityRecords.map((c) => c.city),
      },
      profile.promptTemplate?.prompt ?? undefined,
      profile.postFrequency ?? 4
    );

    // Create posts and auto-approve them with scheduled dates
    const now = new Date();
    let scheduleDates = calculateScheduleDates(
      generated.posts.length,
      now.getMonth(),
      now.getFullYear()
    );
    if (scheduleDates.length === 0) {
      const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
      const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      scheduleDates = calculateScheduleDates(generated.posts.length, nextMonth, nextYear);
    }

    const createdPosts = await Promise.all(
      generated.posts.map((post, i) =>
        prisma.post.create({
          data: {
            profileId,
            type: post.suggestedType as PostType,
            content: post.content,
            callToAction: post.callToActionUrl ?? null,
            status: scheduleDates[i] ? "SCHEDULED" : "DRAFT",
            scheduledAt: scheduleDates[i] ?? null,
          },
        })
      )
    );

    // Queue scheduled posts for publishing via BullMQ
    for (const post of createdPosts) {
      if (post.status === "SCHEDULED" && post.scheduledAt) {
        try {
          await schedulePostPublish(post.id, post.scheduledAt);
        } catch (err) {
          console.warn(`[onboarding-complete] Failed to queue post ${post.id}:`, err);
        }
      }
    }

    console.log(`[onboarding-complete] Generated and scheduled ${createdPosts.filter(p => p.status === "SCHEDULED").length}/${generated.posts.length} posts for ${profile.name}`);
  } catch (err) {
    console.error(`[onboarding-complete] Post generation failed for ${profile.name}:`, err);
  }

  // --- Sync reviews ---
  try {
    if (profile.accountResourceName) {
      console.log(`[onboarding-complete] Syncing reviews for ${profile.name}`);

      const result = await fetchReviews(
        profile.googleAccountId,
        profile.accountResourceName,
        profile.locationName
      );

      let synced = 0;
      for (const gbpReview of result.reviews) {
        const existing = await prisma.review.findUnique({
          where: { googleReviewId: gbpReview.name },
        });
        if (existing) continue;
        if (gbpReview.reviewReply) continue;

        const rating = STAR_RATING_MAP[gbpReview.starRating] ?? 3;

        const review = await prisma.review.create({
          data: {
            profileId,
            googleReviewId: gbpReview.name,
            reviewerName: gbpReview.reviewer.isAnonymous
              ? null
              : gbpReview.reviewer.displayName,
            rating,
            comment: gbpReview.comment || null,
            reviewDate: new Date(gbpReview.createTime),
          },
        });

        try {
          const aiResponse = await generateReviewResponse({
            businessName: profile.name,
            businessCategory: profile.category,
            reviewerName: review.reviewerName,
            starRating: rating,
            reviewComment: review.comment,
          });

          const reviewResponse = await prisma.reviewResponse.create({
            data: {
              reviewId: review.id,
              content: aiResponse.response,
              status: "APPROVED",
            },
          });

          // Queue for immediate publishing to Google
          try {
            await scheduleReviewPublish(reviewResponse.id);
          } catch (pubErr) {
            console.warn(`[onboarding-complete] Failed to queue review response ${reviewResponse.id}:`, pubErr);
          }

          synced++;
        } catch (aiErr) {
          console.error(`[onboarding-complete] AI response failed for review ${review.id}:`, aiErr);
        }
      }

      console.log(`[onboarding-complete] Synced ${synced} reviews for ${profile.name}`);
    }
  } catch (err) {
    console.error(`[onboarding-complete] Review sync failed for ${profile.name}:`, err);
  }

  // --- Sync metrics ---
  try {
    console.log(`[onboarding-complete] Syncing metrics for ${profile.name}`);

    const locationId = profile.locationName.split("/").pop()!;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // Last 30 days for initial sync

    const metricsResponse = await fetchDailyMetrics(
      profile.googleAccountId,
      locationId,
      startDate,
      endDate
    );

    const parsedMetrics = parseMetricsResponse(metricsResponse, profileId);

    for (const metric of parsedMetrics) {
      await prisma.dailyMetric.upsert({
        where: {
          profileId_date: {
            profileId: metric.profileId,
            date: metric.date,
          },
        },
        create: metric,
        update: {
          impressionsSearchDesktop: metric.impressionsSearchDesktop,
          impressionsSearchMobile: metric.impressionsSearchMobile,
          impressionsMapsDesktop: metric.impressionsMapsDesktop,
          impressionsMapsMobile: metric.impressionsMapsMobile,
          websiteClicks: metric.websiteClicks,
          callClicks: metric.callClicks,
          directionRequests: metric.directionRequests,
          conversations: metric.conversations,
        },
      });
    }

    // Sync current month keywords
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const keywords = await fetchSearchKeywords(
      profile.googleAccountId,
      locationId,
      currentMonth,
      currentMonth
    );

    for (const kw of keywords) {
      await prisma.monthlyKeyword.upsert({
        where: {
          profileId_month_keyword: {
            profileId,
            month: currentMonth,
            keyword: kw.keyword,
          },
        },
        create: {
          profileId,
          month: currentMonth,
          keyword: kw.keyword,
          impressions: kw.impressions,
        },
        update: {
          impressions: kw.impressions,
        },
      });
    }

    console.log(`[onboarding-complete] Synced ${parsedMetrics.length} metric days + ${keywords.length} keywords for ${profile.name}`);
  } catch (err) {
    console.error(`[onboarding-complete] Metrics sync failed for ${profile.name}:`, err);
  }

  // --- Initialize recurring schedulers (idempotent — safe to call multiple times) ---
  try {
    await initReviewSyncScheduler();
    console.log(`[onboarding-complete] Review sync scheduler initialized (every 30 min)`);
  } catch (err) {
    console.error(`[onboarding-complete] Failed to init review sync scheduler:`, err);
  }

  try {
    await initMetricsSyncScheduler();
    console.log(`[onboarding-complete] Metrics sync scheduler initialized (every 24h)`);
  } catch (err) {
    console.error(`[onboarding-complete] Failed to init metrics sync scheduler:`, err);
  }

  // --- Enable auto-approve for ongoing review responses ---
  try {
    await prisma.profile.update({
      where: { id: profileId },
      data: { autoApproveReviews: true },
    });
    console.log(`[onboarding-complete] Auto-approve reviews enabled for ${profile.name}`);
  } catch (err) {
    console.error(`[onboarding-complete] Failed to enable auto-approve:`, err);
  }
}
