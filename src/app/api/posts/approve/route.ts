import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateScheduleDates } from "@/lib/scheduling";
import { schedulePostPublish } from "@/lib/queue/publish-queue";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { profileId } = body as { profileId: string };

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

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

  // Calculate schedule dates for all drafts
  const now = new Date();
  let scheduleDates = calculateScheduleDates(
    drafts.length,
    now.getMonth(),
    now.getFullYear()
  );

  // If not enough dates this month, try next month
  if (scheduleDates.length === 0) {
    const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    const nextYear =
      now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    scheduleDates = calculateScheduleDates(drafts.length, nextMonth, nextYear);
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
