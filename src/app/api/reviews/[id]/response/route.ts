import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/api-validation";
import {
  GBP_REPLY_MAX_BYTES,
  REVIEWS_DISABLED_ERROR,
  REVIEWS_DISABLED_STATUS,
} from "@/lib/reviews-enabled";

const editReplyBodySchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Reply can't be empty")
    .refine(
      (text) => Buffer.byteLength(text, "utf8") <= GBP_REPLY_MAX_BYTES,
      `Reply must be ${GBP_REPLY_MAX_BYTES} bytes or less (Google's limit)`
    ),
});

/**
 * Replace a reply's text with what a person wrote. The reply goes (back)
 * to DRAFTED, so it still needs Approve before anything publishes, and
 * Approve then publishes exactly this text. With no reply yet, this
 * creates one.
 *
 * Approved and published replies can't be edited: a publish job may be
 * queued for the approved text, and a published one is the record of
 * what's live on Google. Skipped ones already have a different reply on
 * Google, or the review is gone.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  const parsed = await parseBody(request, editReplyBodySchema);
  if (parsed.error) return parsed.error;
  const { content } = parsed.data;

  const review = await prisma.review.findUnique({
    where: { id },
    include: {
      response: { select: { id: true, status: true } },
      profile: { select: { reviewsEnabled: true } },
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

  const editable = ["DRAFTED", "FAILED"] as const;

  if (!review.response) {
    await prisma.reviewResponse.create({
      data: {
        reviewId: id,
        content,
        status: "DRAFTED",
        autoApproved: false,
      },
    });
  } else {
    if (!(editable as readonly string[]).includes(review.response.status)) {
      return NextResponse.json(
        {
          error: `This reply is ${review.response.status.toLowerCase()} and cannot be edited`,
        },
        { status: 409 }
      );
    }

    // Guarded on status so an Approve that lands between the read above
    // and this write is never overwritten.
    const updated = await prisma.reviewResponse.updateMany({
      where: { id: review.response.id, status: { in: [...editable] } },
      data: {
        content,
        status: "DRAFTED",
        errorMessage: null,
        autoApproved: false,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json(
        {
          error:
            "This reply was approved or changed while you were editing it. Refresh to see it.",
        },
        { status: 409 }
      );
    }
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
