import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { idSchema, parseBody } from "@/lib/api-validation";
import { MAX_REVIEW_INSTRUCTIONS_CHARS } from "@/lib/reviews-enabled";

/** Per-profile review settings: the on/off switch and the AI training notes. */
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
    select: { reviewsEnabled: true, reviewInstructions: true },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({
    reviewsEnabled: profile.reviewsEnabled,
    reviewInstructions: profile.reviewInstructions,
  });
}

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
  })
  .refine(
    (body) =>
      body.reviewsEnabled !== undefined || body.reviewInstructions !== undefined,
    "at least one of reviewsEnabled or reviewInstructions is required"
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
      },
      select: { reviewsEnabled: true, reviewInstructions: true },
    });

    return NextResponse.json({
      reviewsEnabled: updated.reviewsEnabled,
      reviewInstructions: updated.reviewInstructions,
    });
  } catch {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
}
