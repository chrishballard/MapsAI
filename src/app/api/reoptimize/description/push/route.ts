import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pushDescriptionToGBP } from "@/lib/google-business-info";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId, content } = body;

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json(
      { error: "content is required and must be non-empty" },
      { status: 400 }
    );
  }

  if (content.length > 750) {
    return NextResponse.json(
      { error: "content must be 750 characters or less" },
      { status: 400 }
    );
  }

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
  return NextResponse.json({
    success: false,
    error: pushResult.error,
    description: savedRecord,
  });
}
