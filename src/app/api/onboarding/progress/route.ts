import { requireSession, requireProfile } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  idSchema,
  parseBody,
  profileIdBodySchema,
} from "@/lib/api-validation";
import { isPrismaError } from "@/lib/prisma-errors";

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

  const progress = await prisma.onboardingProgress.findUnique({
    where: { profileId },
  });

  return NextResponse.json({ progress });
}

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const { profileId } = parsed.data;

  const profile = await requireProfile(profileId);
  if (profile instanceof NextResponse) return profile;

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

const patchProgressSchema = z.object({
  profileId: idSchema,
  currentStep: z.number().int().min(0).max(100).optional(),
  completedSteps: z.array(z.number().int().min(0).max(100)).max(100).optional(),
  isComplete: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, patchProgressSchema);
  if (parsed.error) return parsed.error;
  const { profileId, currentStep, completedSteps, isComplete } = parsed.data;

  const data: Record<string, unknown> = {};
  if (currentStep !== undefined) data.currentStep = currentStep;
  if (completedSteps !== undefined) data.completedSteps = completedSteps;
  if (isComplete !== undefined) {
    data.isComplete = isComplete;
    // completedAt follows isComplete both ways. The wizard sends
    // isComplete: false on every step change, including when someone
    // re-opens a finished profile and steps back through it; that marks it
    // not complete again, and a completion date left behind would say
    // otherwise.
    data.completedAt = isComplete ? new Date() : null;
  }

  try {
    const progress = await prisma.onboardingProgress.update({
      where: { profileId },
      data,
    });
    return NextResponse.json({ progress });
  } catch (err) {
    // Only a missing row is "not found"; anything else is a real failure.
    if (isPrismaError(err, "P2025")) {
      return NextResponse.json(
        { error: "No onboarding progress found for this profile" },
        { status: 404 }
      );
    }
    throw err;
  }
}
