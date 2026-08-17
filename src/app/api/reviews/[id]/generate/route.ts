import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateReviewResponse } from "@/lib/review-responder";
import {
  REVIEWS_DISABLED_ERROR,
  REVIEWS_DISABLED_STATUS,
} from "@/lib/reviews-enabled";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  const review = await prisma.review.findUnique({
    where: { id },
    include: {
      profile: {
        select: {
          name: true,
          category: true,
          reviewsEnabled: true,
          reviewInstructions: true,
        },
      },
      response: { select: { status: true } },
    },
  });

  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (!review.profile.reviewsEnabled) {
    return NextResponse.json(
      { error: REVIEWS_DISABLED_ERROR },
      { status: REVIEWS_DISABLED_STATUS }
    );
  }

  if (review.repliedExternally) {
    return NextResponse.json(
      { error: "This review already has a reply on Google and cannot be responded to" },
      { status: 400 }
    );
  }

  // Never overwrite an APPROVED response — a publish job may already be
  // queued for it, and it must publish exactly the content that was approved.
  // PUBLISHED responses are the record of what's live on Google.
  if (
    review.response?.status === "APPROVED" ||
    review.response?.status === "PUBLISHED"
  ) {
    return NextResponse.json(
      {
        error: `This response is ${review.response.status.toLowerCase()} and cannot be regenerated`,
      },
      { status: 409 }
    );
  }

  const aiResponse = await generateReviewResponse({
    businessName: review.profile.name,
    businessCategory: review.profile.category,
    reviewerName: review.reviewerName,
    starRating: review.rating,
    reviewComment: review.comment,
    customInstructions: review.profile.reviewInstructions,
  });

  // Upsert: create if none exists, update if it does
  const reviewResponse = await prisma.reviewResponse.upsert({
    where: { reviewId: id },
    create: {
      reviewId: id,
      content: aiResponse.response,
      status: "DRAFTED",
    },
    update: {
      content: aiResponse.response,
      status: "DRAFTED",
      errorMessage: null,
    },
  });

  const updatedReview = await prisma.review.findUnique({
    where: { id },
    include: {
      profile: { select: { id: true, name: true, category: true } },
      response: true,
    },
  });

  return NextResponse.json(updatedReview);
}
