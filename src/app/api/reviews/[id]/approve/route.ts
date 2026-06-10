import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scheduleReviewPublish } from "@/lib/queue/review-publish-queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const review = await prisma.review.findUnique({
    where: { id },
    include: { response: true },
  });

  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (review.repliedExternally) {
    return NextResponse.json(
      { error: "This review already has a reply on Google and cannot be responded to" },
      { status: 400 }
    );
  }

  if (!review.response) {
    return NextResponse.json(
      { error: "No response exists for this review" },
      { status: 400 }
    );
  }

  if (review.response.status !== "DRAFTED") {
    return NextResponse.json(
      { error: "Only DRAFTED responses can be approved" },
      { status: 400 }
    );
  }

  const updatedResponse = await prisma.reviewResponse.update({
    where: { id: review.response.id },
    data: { status: "APPROVED" },
  });

  // Queue for publishing
  try {
    await scheduleReviewPublish(updatedResponse.id);
  } catch (err) {
    console.warn(
      "Failed to queue review response for publishing (Redis may be unavailable):",
      err
    );
  }

  const updatedReview = await prisma.review.findUnique({
    where: { id },
    include: {
      profile: { select: { id: true, name: true, category: true } },
      response: true,
    },
  });

  return NextResponse.json(updatedReview);
}
