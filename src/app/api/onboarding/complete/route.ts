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

  try {
    const progress = await prisma.onboardingProgress.update({
      where: { profileId: body.profileId },
      data: {
        isComplete: true,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      completedAt: progress.completedAt,
    });
  } catch {
    return NextResponse.json(
      { error: "No onboarding progress found for this profile" },
      { status: 404 }
    );
  }
}
