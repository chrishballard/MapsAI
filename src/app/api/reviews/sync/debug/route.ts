import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchReviews } from "@/lib/google-reviews";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown>[] = [];

  try {
    // 1. Find profiles
    const profiles = await prisma.profile.findMany({
      where: {
        isConnected: true,
        isOnboarded: true,
        accountResourceName: { not: null },
      },
      include: { googleAccount: true },
    });

    results.push({ step: "profiles_found", count: profiles.length, names: profiles.map(p => p.name) });

    if (profiles.length === 0) {
      // Check why — are there profiles at all?
      const allProfiles = await prisma.profile.findMany({
        select: { id: true, name: true, isConnected: true, isOnboarded: true, accountResourceName: true, googleAccountId: true },
      });
      results.push({ step: "all_profiles_debug", profiles: allProfiles });
      return NextResponse.json({ status: "no_eligible_profiles", results });
    }

    // 2. Try fetching reviews for first eligible profile
    const profile = profiles[0];
    results.push({
      step: "trying_profile",
      name: profile.name,
      locationName: profile.locationName,
      accountResourceName: profile.accountResourceName,
      googleAccountId: profile.googleAccountId,
      hasGoogleAccount: !!profile.googleAccount,
      tokenExpiry: profile.googleAccount?.tokenExpiry,
    });

    try {
      const reviewResult = await fetchReviews(
        profile.googleAccountId,
        profile.accountResourceName!,
        profile.locationName,
        undefined
      );

      results.push({
        step: "reviews_fetched",
        reviewCount: reviewResult.reviews.length,
        totalReviewCount: reviewResult.totalReviewCount,
        averageRating: reviewResult.averageRating,
        firstReview: reviewResult.reviews[0] ? {
          name: reviewResult.reviews[0].name,
          rating: reviewResult.reviews[0].starRating,
          hasReply: !!reviewResult.reviews[0].reviewReply,
          createTime: reviewResult.reviews[0].createTime,
        } : null,
      });

      // Count how many would be skipped
      const existingIds = await prisma.review.findMany({
        where: { profileId: profile.id },
        select: { googleReviewId: true },
      });
      const existingSet = new Set(existingIds.map(r => r.googleReviewId));

      let alreadyExists = 0;
      let hasReply = 0;
      let wouldSync = 0;
      for (const r of reviewResult.reviews) {
        if (existingSet.has(r.name)) { alreadyExists++; continue; }
        if (r.reviewReply) { hasReply++; continue; }
        wouldSync++;
      }

      results.push({
        step: "sync_analysis",
        totalFromGoogle: reviewResult.reviews.length,
        alreadyInDB: alreadyExists,
        skippedHasReply: hasReply,
        wouldSync: wouldSync,
        existingInDB: existingIds.length,
      });

    } catch (apiErr: unknown) {
      const err = apiErr as { message?: string; code?: number; response?: { data?: unknown; status?: number } };
      results.push({
        step: "api_error",
        message: err.message,
        code: err.code,
        responseStatus: err.response?.status,
        responseData: err.response?.data,
      });
    }

    return NextResponse.json({ status: "debug_complete", results });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    return NextResponse.json({ status: "error", message: e.message, stack: e.stack }, { status: 500 });
  }
}
