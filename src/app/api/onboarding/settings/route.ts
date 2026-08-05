import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { idSchema, parseBody } from "@/lib/api-validation";

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
    select: { id: true, postFrequency: true, autoApproveReviews: true },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    postFrequency: profile.postFrequency,
    autoApproveReviews: profile.autoApproveReviews,
  });
}

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
      autoApproveReviews: z.boolean().optional(),
    })
  );
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const updated = await prisma.profile.update({
      where: { id: body.profileId },
      data: {
        postFrequency: body.postFrequency,
        ...(body.autoApproveReviews !== undefined
          ? { autoApproveReviews: body.autoApproveReviews }
          : {}),
      },
    });

    return NextResponse.json({
      postFrequency: updated.postFrequency,
      autoApproveReviews: updated.autoApproveReviews,
    });
  } catch {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }
}
