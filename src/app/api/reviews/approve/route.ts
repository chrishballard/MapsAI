import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scheduleReviewPublish } from "@/lib/queue/review-publish-queue";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId } = body as { profileId: string };

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  // Find all reviews for profile with DRAFTED responses
  const reviews = await prisma.review.findMany({
    where: {
      profileId,
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

  for (const review of reviews) {
    if (!review.response) continue;

    await prisma.reviewResponse.update({
      where: { id: review.response.id },
      data: { status: "APPROVED" },
    });

    try {
      await scheduleReviewPublish(review.response.id);
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
