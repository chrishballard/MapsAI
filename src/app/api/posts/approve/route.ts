import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateScheduleDates } from "@/lib/scheduling";
import { schedulePostPublish } from "@/lib/queue/publish-queue";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";
import { formatDateISO } from "@/lib/dates";

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;
  const { profileId } = parsed.data;

  const drafts = await prisma.post.findMany({
    where: { profileId, status: "DRAFT" },
    orderBy: { createdAt: "asc" },
  });

  if (drafts.length === 0) {
    return NextResponse.json(
      { error: "No draft posts found for this profile" },
      { status: 404 }
    );
  }

  // Find dates that already have scheduled posts for this profile
  const now = new Date();
  const existingScheduled = await prisma.post.findMany({
    where: { profileId, status: "SCHEDULED", scheduledAt: { not: null } },
    select: { scheduledAt: true },
  });
  const takenDates = new Set(
    existingScheduled
      .filter((p) => p.scheduledAt)
      .map((p) => formatDateISO(p.scheduledAt!))
  );

  // Calculate schedule dates for all drafts, excluding already-taken dates
  let scheduleDates = calculateScheduleDates(
    drafts.length,
    now.getMonth(),
    now.getFullYear(),
    takenDates
  );

  // If not enough dates this month, try next month
  if (scheduleDates.length < drafts.length) {
    const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    const nextYear =
      now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const extraDates = calculateScheduleDates(
      drafts.length - scheduleDates.length,
      nextMonth,
      nextYear,
      takenDates
    );
    scheduleDates = [...scheduleDates, ...extraDates];
  }

  if (scheduleDates.length === 0) {
    return NextResponse.json(
      { error: "No available schedule dates" },
      { status: 500 }
    );
  }

  const updatedPosts = [];

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const scheduledAt = scheduleDates[i];

    const updated = await prisma.post.update({
      where: { id: draft.id },
      data: {
        status: "SCHEDULED",
        scheduledAt,
      },
    });

    updatedPosts.push(updated);

    // Create delayed BullMQ job
    try {
      await schedulePostPublish(draft.id, scheduledAt);
    } catch (err) {
      console.warn(
        `Failed to create publish job for post ${draft.id} (Redis may be unavailable):`,
        err
      );
    }
  }

  return NextResponse.json({
    approved: updatedPosts.length,
    posts: updatedPosts,
  });
}
