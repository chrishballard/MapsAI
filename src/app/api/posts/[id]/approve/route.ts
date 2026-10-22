import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateScheduleDates } from "@/lib/scheduling";
import { schedulePostPublish } from "@/lib/queue/publish-queue";
import { redisErrorMessage } from "@/lib/queue/redis-errors";
import { formatDateISO } from "@/lib/dates";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (post.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only DRAFT posts can be approved" },
      { status: 400 }
    );
  }

  // Skip days this profile already has a scheduled post on, as bulk approve
  // does — never two posts on one day.
  const existingScheduled = await prisma.post.findMany({
    where: {
      profileId: post.profileId,
      status: "SCHEDULED",
      scheduledAt: { not: null },
    },
    select: { scheduledAt: true },
  });
  const takenDates = new Set(
    existingScheduled
      .filter((p) => p.scheduledAt)
      .map((p) => formatDateISO(p.scheduledAt!))
  );

  // Calculate next available schedule date
  const now = new Date();
  let scheduleDates = calculateScheduleDates(
    1,
    now.getMonth(),
    now.getFullYear(),
    takenDates
  );

  // If no free weekday is left this month, try next month
  if (scheduleDates.length === 0) {
    const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    scheduleDates = calculateScheduleDates(1, nextMonth, nextYear, takenDates);
  }

  if (scheduleDates.length === 0) {
    return NextResponse.json(
      { error: "No available schedule dates" },
      { status: 500 }
    );
  }

  const scheduledAt = scheduleDates[0];

  const updatedPost = await prisma.post.update({
    where: { id },
    data: {
      status: "SCHEDULED",
      scheduledAt,
    },
  });

  // Create delayed BullMQ job
  try {
    await schedulePostPublish(id, scheduledAt);
  } catch (err) {
    // Queue might not be available (no Redis) - post is still scheduled
    console.warn("Failed to create publish job (Redis may be unavailable):", redisErrorMessage(err));
  }

  return NextResponse.json(updatedPost);
}
