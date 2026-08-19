import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleReviewPublish } from "@/lib/queue/review-publish-queue";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";
import {
  REVIEWS_DISABLED_ERROR,
  REVIEWS_DISABLED_STATUS,
} from "@/lib/reviews-enabled";
import { ratingNotIgnoredFilter } from "@/lib/review-reply-mode";

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const { profileId } = parsed.data;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { reviewsEnabled: true },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  if (!profile.reviewsEnabled) {
    return NextResponse.json(
      { error: REVIEWS_DISABLED_ERROR },
      { status: REVIEWS_DISABLED_STATUS }
    );
  }

  // Find all reviews for profile with DRAFTED responses — excluding reviews
  // that were already replied to outside RankMaps, and ratings set to
  // Ignore: their drafts are hidden from the pending queue, so "approve
  // all" must not publish them behind the operator's back.
  const reviews = await prisma.review.findMany({
    where: {
      profileId,
      repliedExternally: false,
      response: { status: "DRAFTED" },
      ...ratingNotIgnoredFilter(),
    },
    include: { response: true },
  });

  if (reviews.length === 0) {
    return NextResponse.json(
      { error: "No drafted responses found for this profile" },
      { status: 404 }
    );
  }

  let approvedCount = 0;

  // Stagger publishes so a bulk approval stays under GBP's 10 edits/min
  // per-profile limit (all these reviews belong to one profile).
  const STAGGER_MS = 7_500; // 8 per minute

  for (const review of reviews) {
    if (!review.response) continue;

    // A person clicked Approve — clear autoApproved so the publish worker
    // treats this as a human decision, whatever the star mode is now.
    await prisma.reviewResponse.update({
      where: { id: review.response.id },
      data: { status: "APPROVED", autoApproved: false },
    });

    try {
      await scheduleReviewPublish(review.response.id, {
        delayMs: approvedCount * STAGGER_MS,
      });
    } catch (err) {
      console.warn(
        `Failed to queue review response ${review.response.id} for publishing:`,
        err
      );
    }

    approvedCount++;
  }

  return NextResponse.json({ approved: approvedCount });
}
