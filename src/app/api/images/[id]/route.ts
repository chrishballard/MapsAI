import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/api-validation";
import { enqueueImageCaption } from "@/lib/queue/image-caption-queue";

const patchImageSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "HIDDEN"]),
});

/** True when a write failed because the row doesn't exist (Prisma P2025). */
function isMissingRow(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2025";
}

/** Change an image's rotation status (approve a client upload, hide, ...). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const parsed = await parseBody(request, patchImageSchema);
  if (parsed.error) return parsed.error;

  try {
    const updated = await prisma.profileImage.update({
      where: { id },
      data: { status: parsed.data.status },
      select: { id: true, status: true, captionedAt: true },
    });

    // A newly approved image (client-upload approval) needs a vision caption
    // before it can be matched to posts. Queue failures never fail the
    // approval itself.
    if (updated.status === "APPROVED" && !updated.captionedAt) {
      await enqueueImageCaption(id).catch((err) =>
        console.warn(
          `[images] Failed to enqueue caption for image ${id}:`,
          err
        )
      );
    }

    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (err) {
    if (isMissingRow(err)) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    throw err;
  }
}

/**
 * Remove an image from the library. Posts that used it keep their recorded
 * mediaUrl; scheduled posts fall back to text-only (FK nulls the reference).
 * Note: GBP-synced photos reappear on the next sync — hide those instead.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  try {
    // select keeps the multi-MB image bytes from being returned just to
    // confirm the delete.
    await prisma.profileImage.delete({ where: { id }, select: { id: true } });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (isMissingRow(err)) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    throw err;
  }
}
