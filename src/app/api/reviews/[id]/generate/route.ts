import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateReviewResponse } from "@/lib/review-responder";
import {
  REVIEWS_DISABLED_ERROR,
  REVIEWS_DISABLED_STATUS,
} from "@/lib/reviews-enabled";

// Never overwrite an APPROVED response — a publish job may already be
// queued for it, and it must publish exactly the content that was approved.
// PUBLISHED responses are the record of what's live on Google.
const NOT_REGENERATABLE = ["APPROVED", "PUBLISHED"] as const;

function isNotRegeneratable(status: string): boolean {
  return (NOT_REGENERATABLE as readonly string[]).includes(status);
}

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
          phone: true,
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

  if (review.removedAt) {
    return NextResponse.json(
      { error: "This review was removed on Google and cannot be responded to" },
      { status: 400 }
    );
  }

  if (review.response && isNotRegeneratable(review.response.status)) {
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
    businessPhone: review.profile.phone,
  });

  // Upsert: create if none exists, update if it does. Either way this is a
  // fresh human-track draft, so autoApproved resets.
  //
  // The check above ran before a Claude call that takes seconds, and in that
  // time a person can approve the draft, or a sync AUTO-approve a new one,
  // and the worker publish it. So the write only touches a response that is
  // still in a status this route regenerates from. One that has moved on
  // fails the filter: the upsert then tries to create a second response for
  // the review, the unique reviewId refuses it, and this answers 409.
  try {
    await prisma.reviewResponse.upsert({
      where: { reviewId: id, status: { notIn: [...NOT_REGENERATABLE] } },
      create: {
        reviewId: id,
        content: aiResponse.response,
        status: "DRAFTED",
        autoApproved: false,
      },
      update: {
        content: aiResponse.response,
        status: "DRAFTED",
        errorMessage: null,
        autoApproved: false,
      },
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    // P2002: the create collided with a response that moved on. P2025: the
    // row changed between the upsert's own read and its update.
    if (code === "P2002" || code === "P2025") {
      return NextResponse.json(
        {
          error:
            "This response was approved or published while the new draft was being written, so it was left as it is",
        },
        { status: 409 }
      );
    }
    throw err;
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
