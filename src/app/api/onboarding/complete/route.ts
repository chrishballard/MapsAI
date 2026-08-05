import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueOnboardingSync } from "@/lib/queue/onboarding-sync-queue";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // Step 1: Mark onboarding complete and set isOnboarded
  let completedAt: Date | null;
  try {
    const [progress] = await prisma.$transaction([
      prisma.onboardingProgress.update({
        where: { profileId: body.profileId },
        data: {
          isComplete: true,
          completedAt: new Date(),
        },
      }),
      prisma.profile.update({
        where: { id: body.profileId },
        data: { isOnboarded: true },
      }),
    ]);
    completedAt = progress.completedAt;
  } catch (err) {
    // P2025 = record to update not found (no onboarding progress / profile)
    if ((err as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { error: "No onboarding progress found for this profile" },
        { status: 404 }
      );
    }
    console.error(
      `[onboarding-complete] Failed to mark ${body.profileId} complete:`,
      err
    );
    return NextResponse.json(
      { error: "Failed to complete onboarding" },
      { status: 500 }
    );
  }

  // Step 2: Enqueue the initial data sync (posts, reviews, metrics,
  // schedulers) as a BullMQ job. A fire-and-forget promise here dies with
  // the request process — a mid-sync deploy or crash left the profile
  // marked onboarded with no data and nothing ever retried. The job
  // survives restarts and retries with backoff.
  try {
    await enqueueOnboardingSync(body.profileId);
  } catch (err) {
    console.error(
      `[onboarding-complete] Failed to enqueue initial sync for ${body.profileId}:`,
      err
    );
    // Onboarding state is already saved; calling this endpoint again is safe
    // and re-attempts the enqueue.
    return NextResponse.json(
      {
        error:
          "Onboarding was saved, but the initial data sync could not be scheduled. Please try again.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    completedAt,
  });
}
