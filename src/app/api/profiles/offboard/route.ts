import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";
import { publishQueue } from "@/lib/queue/publish-queue";

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // Capture posts with pending publish jobs before flipping their status —
  // their delayed BullMQ jobs must be removed too, or the offboarded profile
  // keeps receiving AI posts as the jobs fire.
  const scheduledPosts = await prisma.post.findMany({
    where: { profileId: body.profileId, status: "SCHEDULED" },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.profile.update({
      where: { id: body.profileId },
      data: { isOnboarded: false },
    }),
    prisma.post.updateMany({
      where: { profileId: body.profileId, status: "SCHEDULED" },
      data: { status: "DRAFT", scheduledAt: null },
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

  // Best-effort removal of the delayed publish jobs. remove() throws for a
  // job that is currently being processed — the publish worker's own
  // inactive-profile guard covers that window.
  for (const post of scheduledPosts) {
    try {
      const job = await publishQueue.getJob(`publish-${post.id}`);
      if (job) await job.remove();
    } catch (err) {
      console.warn(
        `[offboard] Could not remove publish job for post ${post.id}:`,
        err
      );
    }
  }

  return NextResponse.json({ success: true });
}
