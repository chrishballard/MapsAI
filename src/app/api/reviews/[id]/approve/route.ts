import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleReviewPublish } from "@/lib/queue/review-publish-queue";
import {
  REVIEWS_DISABLED_ERROR,
  REVIEWS_DISABLED_STATUS,
} from "@/lib/reviews-enabled";
import {
  checkHealthcareReply,
  describeHealthcareIssues,
  isHealthcareCategory,
} from "@/lib/healthcare";

/**
 * Optional body: the reply text the operator is looking at. When given,
 * approval only goes through if the stored draft still says exactly that,
 * so Approve never publishes text someone else edited or regenerated after
 * the page loaded.
 */
async function readExpectedContent(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { content?: unknown } | null;
    return typeof body?.content === "string" ? body.content : null;
  } catch {
    return null;
  }
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
      response: true,
      profile: {
        select: { reviewsEnabled: true, category: true, phone: true },
      },
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

  const expectedContent = await readExpectedContent(request);
  if (expectedContent !== null && expectedContent !== review.response.content) {
    return NextResponse.json(
      {
        error:
          "This reply changed since you opened the page. Refresh and read it again before approving.",
      },
      { status: 409 }
    );
  }

  // Healthcare: the reply must pass the privacy check before a person can
  // approve it. Edit the text until it does.
  if (isHealthcareCategory(review.profile.category)) {
    const issues = checkHealthcareReply(review.response.content, {
      reviewerName: review.reviewerName,
      officePhone: review.profile.phone,
    });
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: `Edit this reply before approving it. ${describeHealthcareIssues(issues)}.`,
          issues,
        },
        { status: 422 }
      );
    }
  }

  // A person clicked Approve — clear autoApproved so the publish worker
  // treats this as a human decision, whatever the star mode is now. Only
  // the draft that was checked above is approved: if it was edited,
  // regenerated or approved in the meantime, nothing changes.
  const approved = await prisma.reviewResponse.updateMany({
    where: {
      id: review.response.id,
      status: "DRAFTED",
      content: review.response.content,
    },
    data: { status: "APPROVED", autoApproved: false },
  });

  if (approved.count === 0) {
    return NextResponse.json(
      {
        error:
          "This reply changed while you were approving it. Refresh and read it again.",
      },
      { status: 409 }
    );
  }

  // Queue for publishing
  try {
    await scheduleReviewPublish(review.response.id);
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
