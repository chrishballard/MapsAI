import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReviewResponse } from "@/lib/review-responder";

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
    include: {
      profile: { select: { name: true, category: true } },
    },
  });

  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const aiResponse = await generateReviewResponse({
    businessName: review.profile.name,
    businessCategory: review.profile.category,
    reviewerName: review.reviewerName,
    starRating: review.rating,
    reviewComment: review.comment,
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
