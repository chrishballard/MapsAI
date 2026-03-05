import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchCurrentDescription } from "@/lib/google-business-info";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const [description, currentGBPDescription] = await Promise.all([
    prisma.profileDescription.findFirst({
      where: { profileId },
      orderBy: { updatedAt: "desc" },
    }),
    fetchCurrentDescription({
      googleAccountId: profile.googleAccountId,
      locationName: profile.locationName,
    }),
  ]);

  return NextResponse.json({ description, currentGBPDescription });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId, content, isApproved } = body;

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

  const existing = await prisma.profileDescription.findFirst({
    where: { profileId },
    orderBy: { updatedAt: "desc" },
  });

  let description;
  if (existing) {
    description = await prisma.profileDescription.update({
      where: { id: existing.id },
      data: {
        content,
        isApproved: isApproved ?? false,
        isPushed: false,
        pushedAt: null,
      },
    });
  } else {
    description = await prisma.profileDescription.create({
      data: {
        profileId,
        content,
        isApproved: isApproved ?? false,
      },
    });
  }

  return NextResponse.json({ description });
}
