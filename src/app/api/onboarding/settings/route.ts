import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { idSchema, parseBody } from "@/lib/api-validation";
import { REVIEW_REPLY_MODES } from "@/lib/review-reply-mode";

const settingsSelect = {
  id: true,
  postFrequency: true,
  reviewReplyMode1: true,
  reviewReplyMode2: true,
  reviewReplyMode3: true,
  reviewReplyMode4: true,
  reviewReplyMode5: true,
} as const;

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: settingsSelect,
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    postFrequency: profile.postFrequency,
    reviewReplyMode1: profile.reviewReplyMode1,
    reviewReplyMode2: profile.reviewReplyMode2,
    reviewReplyMode3: profile.reviewReplyMode3,
    reviewReplyMode4: profile.reviewReplyMode4,
    reviewReplyMode5: profile.reviewReplyMode5,
  });
}

const replyModeSchema = z.enum(REVIEW_REPLY_MODES);

export async function PATCH(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(
    request,
    z.object({
      profileId: idSchema,
      postFrequency: z
        .number()
        .int()
        .min(1, "postFrequency must be an integer between 1 and 30")
        .max(30, "postFrequency must be an integer between 1 and 30"),
      reviewReplyMode1: replyModeSchema.optional(),
      reviewReplyMode2: replyModeSchema.optional(),
      reviewReplyMode3: replyModeSchema.optional(),
      reviewReplyMode4: replyModeSchema.optional(),
      reviewReplyMode5: replyModeSchema.optional(),
    })
  );
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const updated = await prisma.profile.update({
      where: { id: body.profileId },
      data: {
        postFrequency: body.postFrequency,
        ...(body.reviewReplyMode1 !== undefined
          ? { reviewReplyMode1: body.reviewReplyMode1 }
          : {}),
        ...(body.reviewReplyMode2 !== undefined
          ? { reviewReplyMode2: body.reviewReplyMode2 }
          : {}),
        ...(body.reviewReplyMode3 !== undefined
          ? { reviewReplyMode3: body.reviewReplyMode3 }
          : {}),
        ...(body.reviewReplyMode4 !== undefined
          ? { reviewReplyMode4: body.reviewReplyMode4 }
          : {}),
        ...(body.reviewReplyMode5 !== undefined
          ? { reviewReplyMode5: body.reviewReplyMode5 }
          : {}),
      },
      select: settingsSelect,
    });

    return NextResponse.json({
      postFrequency: updated.postFrequency,
      reviewReplyMode1: updated.reviewReplyMode1,
      reviewReplyMode2: updated.reviewReplyMode2,
      reviewReplyMode3: updated.reviewReplyMode3,
      reviewReplyMode4: updated.reviewReplyMode4,
      reviewReplyMode5: updated.reviewReplyMode5,
    });
  } catch {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }
}
