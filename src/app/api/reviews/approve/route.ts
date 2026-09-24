import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scheduleReviewPublish } from "@/lib/queue/review-publish-queue";
import { idSchema, parseBody } from "@/lib/api-validation";
import {
  REVIEWS_DISABLED_ERROR,
  REVIEWS_DISABLED_STATUS,
} from "@/lib/reviews-enabled";
import { bulkApprovableReviewsWhere } from "@/lib/review-bulk-approve";
import {
  HEALTHCARE_BULK_APPROVE_HELD_ERROR,
  isHealthcareCategory,
} from "@/lib/healthcare";

/**
 * Approve all publishes every live draft on a profile exactly as written,
 * so the caller must confirm how many it is approving. If the queue has
 * changed since the operator confirmed (a sync drafted more, someone else
 * approved some), nothing is approved and the current count comes back.
 */
const bulkApproveBodySchema = z.object({
  profileId: idSchema,
  confirmCount: z.number().int().positive(),
});

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, bulkApproveBodySchema);
  if (parsed.error) return parsed.error;
  const { profileId, confirmCount } = parsed.data;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { reviewsEnabled: true, category: true },
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

  // A healthcare reply must be read before it publishes, so there is no
  // bulk path for these profiles at all.
  if (isHealthcareCategory(profile.category)) {
    return NextResponse.json(
      { error: HEALTHCARE_BULK_APPROVE_HELD_ERROR },
      { status: 409 }
    );
  }

  const reviews = await prisma.review.findMany({
    where: bulkApprovableReviewsWhere(profileId),
    include: { response: true },
  });

  if (reviews.length === 0) {
    return NextResponse.json(
      { error: "No drafted responses found for this profile" },
      { status: 404 }
    );
  }

  if (reviews.length !== confirmCount) {
    return NextResponse.json(
      {
        error: `There are now ${reviews.length} drafted replies, not the ${confirmCount} you confirmed. Nothing was approved. Refresh and check them again.`,
        draftCount: reviews.length,
      },
      { status: 409 }
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
