import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { idSchema, parseBody } from "@/lib/api-validation";
import { MAX_REVIEW_INSTRUCTIONS_CHARS } from "@/lib/reviews-enabled";
import { REVIEW_REPLY_MODES } from "@/lib/review-reply-mode";

const settingsSelect = {
  reviewsEnabled: true,
  reviewInstructions: true,
  reviewReplyMode1: true,
  reviewReplyMode2: true,
  reviewReplyMode3: true,
  reviewReplyMode4: true,
  reviewReplyMode5: true,
} as const;

/**
 * Per-profile review settings: the on/off switch, the per-star reply modes,
 * and the AI training notes.
 */
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
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}

const replyModeSchema = z.enum(REVIEW_REPLY_MODES);

const patchSchema = z
  .object({
    profileId: idSchema,
    reviewsEnabled: z.boolean().optional(),
    reviewInstructions: z
      .string()
      .max(
        MAX_REVIEW_INSTRUCTIONS_CHARS,
        `reviewInstructions must be ${MAX_REVIEW_INSTRUCTIONS_CHARS} characters or less`
      )
      .nullable()
      .optional(),
    reviewReplyMode1: replyModeSchema.optional(),
    reviewReplyMode2: replyModeSchema.optional(),
    reviewReplyMode3: replyModeSchema.optional(),
    reviewReplyMode4: replyModeSchema.optional(),
    reviewReplyMode5: replyModeSchema.optional(),
  })
  .refine(
    (body) =>
      [
        body.reviewsEnabled,
        body.reviewInstructions,
        body.reviewReplyMode1,
        body.reviewReplyMode2,
        body.reviewReplyMode3,
        body.reviewReplyMode4,
        body.reviewReplyMode5,
      ].some((value) => value !== undefined),
    "at least one settings field is required"
  );

export async function PATCH(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, patchSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // Blank instructions mean "no training notes" — store null, not "".
  const trimmedInstructions =
    body.reviewInstructions === undefined
      ? undefined
      : (body.reviewInstructions?.trim() || null);

  try {
    const updated = await prisma.profile.update({
      where: { id: body.profileId },
      data: {
        ...(body.reviewsEnabled !== undefined
          ? { reviewsEnabled: body.reviewsEnabled }
          : {}),
        ...(trimmedInstructions !== undefined
          ? { reviewInstructions: trimmedInstructions }
          : {}),
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

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
}
