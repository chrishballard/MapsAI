import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushDescriptionToGBP } from "@/lib/google-business-info";
import { z } from "zod";
import {
  descriptionContentSchema,
  idSchema,
  parseBody,
} from "@/lib/api-validation";

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(
    request,
    z.object({ profileId: idSchema, content: descriptionContentSchema })
  );
  if (parsed.error) return parsed.error;
  const { profileId, content } = parsed.data;

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      googleAccountId: true,
      locationName: true,
    },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  // Step 1: Save/upsert to DB with isApproved: true
  const existing = await prisma.profileDescription.findFirst({
    where: { profileId },
    orderBy: { updatedAt: "desc" },
  });

  let savedRecord;
  if (existing) {
    savedRecord = await prisma.profileDescription.update({
      where: { id: existing.id },
      data: {
        content,
        isApproved: true,
        isPushed: false,
        pushedAt: null,
      },
    });
  } else {
    savedRecord = await prisma.profileDescription.create({
      data: {
        profileId,
        content,
        isApproved: true,
      },
    });
  }

  // Step 2: Push to GBP
  const pushResult = await pushDescriptionToGBP({
    googleAccountId: profile.googleAccountId,
    locationName: profile.locationName,
    description: content,
  });

  if (pushResult.success) {
    const updatedRecord = await prisma.profileDescription.update({
      where: { id: savedRecord.id },
      data: {
        isPushed: true,
        pushedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, description: updatedRecord });
  }

  // Push failed but description is saved locally
  console.error("Description push to GBP failed:", pushResult.error);
  return NextResponse.json(
    {
      success: false,
      error: "Failed to push description to Google Business Profile",
      description: savedRecord,
    },
    { status: 502 }
  );
}
