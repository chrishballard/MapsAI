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

  const progress = await prisma.onboardingProgress.findUnique({
    where: { profileId },
  });

  return NextResponse.json({ progress });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId } = body;

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
  });

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  const progress = await prisma.onboardingProgress.upsert({
    where: { profileId },
    create: {
      profileId,
      currentStep: 0,
      completedSteps: [],
      isComplete: false,
    },
    update: {},
  });

  return NextResponse.json({ progress }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId, currentStep, completedSteps, isComplete } = body;

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (currentStep !== undefined) data.currentStep = currentStep;
  if (completedSteps !== undefined) data.completedSteps = completedSteps;
  if (isComplete !== undefined) {
    data.isComplete = isComplete;
    if (isComplete) data.completedAt = new Date();
  }

  const progress = await prisma.onboardingProgress.update({
    where: { profileId },
    data,
  });

  return NextResponse.json({ progress });
}
