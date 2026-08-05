import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleReviewPublish } from "@/lib/queue/review-publish-queue";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const { profileId } = parsed.data;

  // Find all reviews for profile with DRAFTED responses
  // (excluding reviews that were already replied to outside RankMaps)
  const reviews = await prisma.review.findMany({
    where: {
      profileId,
      repliedExternally: false,
      response: { status: "DRAFTED" },
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

    await prisma.reviewResponse.update({
      where: { id: review.response.id },
      data: { status: "APPROVED" },
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
