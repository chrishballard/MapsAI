import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    select: { id: true, postFrequency: true },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ postFrequency: profile.postFrequency });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { profileId: string; postFrequency: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  if (
    typeof body.postFrequency !== "number" ||
    !Number.isInteger(body.postFrequency) ||
    body.postFrequency < 1 ||
    body.postFrequency > 30
  ) {
    return NextResponse.json(
      { error: "postFrequency must be an integer between 1 and 30" },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.profile.update({
      where: { id: body.profileId },
      data: { postFrequency: body.postFrequency },
    });

    return NextResponse.json({ postFrequency: updated.postFrequency });
  } catch {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }
}
