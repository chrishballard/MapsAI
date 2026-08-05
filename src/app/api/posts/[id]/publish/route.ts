import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishQueue, schedulePostPublish } from "@/lib/queue/publish-queue";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id: postId } = await params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (post.status === "PUBLISHED") {
    return NextResponse.json(
      { error: "Post is already published" },
      { status: 400 }
    );
  }

  if (post.status !== "DRAFT" && post.status !== "APPROVED" && post.status !== "SCHEDULED") {
    return NextResponse.json(
      { error: `Cannot publish a post with status ${post.status}` },
      { status: 400 }
    );
  }

  try {
    const now = new Date();

    // Update status to SCHEDULED so the worker picks it up
    await prisma.post.update({
      where: { id: postId },
      data: { status: "SCHEDULED", scheduledAt: now },
    });

    // A SCHEDULED post may already have a delayed job under the stable
    // publish-<postId> jobId; remove it so the immediate enqueue below
    // isn't deduped away and the post publishes now, not at the old time.
    try {
      await publishQueue.remove(`publish-${postId}`);
    } catch {
      // Job is locked (a worker is publishing it right now) — deduping the
      // enqueue below is exactly what we want in that case.
    }

    // Enqueue via the same stable jobId the sweep uses, so the sweep can
    // never double-enqueue this post while our job is pending.
    await schedulePostPublish(postId, now);

    return NextResponse.json({ message: "Post queued for immediate publish" });
  } catch (err) {
    console.error(`Failed to publish post ${postId}:`, err);
    return NextResponse.json(
      { error: "Failed to publish post" },
      { status: 500 }
    );
  }
}
