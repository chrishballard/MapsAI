import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publishQueue } from "@/lib/queue/publish-queue";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    // Update status to SCHEDULED so the worker picks it up
    await prisma.post.update({
      where: { id: postId },
      data: { status: "SCHEDULED", scheduledAt: new Date() },
    });

    // Queue for immediate publish (delay: 0)
    await publishQueue.add(`publish-now-${postId}`, { postId }, { delay: 0 });

    return NextResponse.json({ message: "Post queued for immediate publish" });
  } catch (err) {
    console.error(`Failed to publish post ${postId}:`, err);
    return NextResponse.json(
      { error: "Failed to publish post" },
      { status: 500 }
    );
  }
}
