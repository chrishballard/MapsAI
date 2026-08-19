import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody, idSchema } from "@/lib/api-validation";
import { markImagesUsed } from "@/lib/post-images";
import { PostStatus } from "@/generated/prisma/client";

// Status changes allowed through this endpoint. Scheduling happens via
// /api/posts/approve and publishing via /api/posts/[id]/publish and the
// publish queue — PATCH may only revert a post back to DRAFT (retry flow).
const ALLOWED_TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  DRAFT: [],
  APPROVED: ["DRAFT"],
  SCHEDULED: ["DRAFT"],
  PUBLISHING: [],
  PUBLISHED: [],
  FAILED: ["DRAFT"],
};

const patchPostSchema = z
  .object({
    content: z.string().min(1).max(1500).optional(),
    callToAction: z.string().max(2048).nullable().optional(),
    mediaUrl: z.string().max(2048).nullable().optional(),
    imageId: idSchema.nullable().optional(),
    type: z.enum(["WHATS_NEW", "EVENT", "OFFER"]).optional(),
    status: z.enum(PostStatus).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "no fields to update");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const parsed = await parseBody(request, patchPostSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (
    body.status !== undefined &&
    body.status !== post.status &&
    !ALLOWED_TRANSITIONS[post.status].includes(body.status)
  ) {
    return NextResponse.json(
      { error: `Cannot change status from ${post.status} to ${body.status}` },
      { status: 400 }
    );
  }

  // Content edits are only allowed while the post is still in our hands
  const editsContent =
    body.content !== undefined ||
    body.callToAction !== undefined ||
    body.mediaUrl !== undefined ||
    body.imageId !== undefined ||
    body.type !== undefined;
  if (
    editsContent &&
    (post.status === "PUBLISHING" || post.status === "PUBLISHED")
  ) {
    return NextResponse.json(
      { error: `Cannot edit a ${post.status.toLowerCase()} post` },
      { status: 400 }
    );
  }

  // An attached image must belong to the post's profile and be in rotation.
  if (body.imageId) {
    const image = await prisma.profileImage.findUnique({
      where: { id: body.imageId },
      select: { profileId: true, status: true },
    });
    if (!image || image.profileId !== post.profileId) {
      return NextResponse.json(
        { error: "Image not found for this profile" },
        { status: 400 }
      );
    }
    if (image.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Image must be approved before it can be used on a post" },
        { status: 400 }
      );
    }
  }

  const updatedPost = await prisma.post.update({
    where: { id },
    data: body,
  });

  // A manual pick counts as a use so the rotation moves past this image.
  if (body.imageId && body.imageId !== post.imageId) {
    await markImagesUsed([body.imageId]).catch((err) =>
      console.warn(`Failed to record image usage for post ${id}:`, err)
    );
  }

  return NextResponse.json(updatedPost);
}

export async function DELETE(
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
      { error: "Only DRAFT posts can be deleted" },
      { status: 400 }
    );
  }

  await prisma.post.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
