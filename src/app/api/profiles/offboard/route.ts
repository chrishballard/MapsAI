import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { profileId: string };
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

  await prisma.$transaction([
    prisma.profile.update({
      where: { id: body.profileId },
      data: { isOnboarded: false },
    }),
    prisma.onboardingProgress.deleteMany({
      where: { profileId: body.profileId },
    }),
    prisma.profileKeyword.deleteMany({
      where: { profileId: body.profileId },
    }),
    prisma.profileCity.deleteMany({
      where: { profileId: body.profileId },
    }),
    prisma.profileDescription.deleteMany({
      where: { profileId: body.profileId },
    }),
    prisma.profileService.deleteMany({
      where: { profileId: body.profileId },
    }),
  ]);

  return NextResponse.json({ success: true });
}
