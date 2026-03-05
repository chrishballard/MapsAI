import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateScheduleDates } from "@/lib/scheduling";
import { schedulePostPublish } from "@/lib/queue/publish-queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // Calculate next available schedule date
  const now = new Date();
  let scheduleDates = calculateScheduleDates(1, now.getMonth(), now.getFullYear());

  // If no future Tuesdays this month, try next month
  if (scheduleDates.length === 0) {
    const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    scheduleDates = calculateScheduleDates(1, nextMonth, nextYear);
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
    console.warn("Failed to create publish job (Redis may be unavailable):", err);
  }

  return NextResponse.json(updatedPost);
}
