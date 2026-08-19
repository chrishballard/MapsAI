import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProfile } from "@/lib/auth/require-session";
import { prisma } from "@/lib/prisma";
import { parseBody, idSchema } from "@/lib/api-validation";
import { listProfileImages } from "@/lib/image-library";
import { storeUploadedImages, filesFromForm } from "@/lib/image-upload";
import { MAX_FILES_PER_UPLOAD } from "@/lib/image-validation";
import type { ProfileImageStatus } from "@/generated/prisma/client";

/** List a profile's image library (metadata only — bytes stay in the DB). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const result = await requireProfile(searchParams.get("profileId"));
  if (result instanceof NextResponse) return result;

  const statusParam = searchParams.get("status");
  const status =
    statusParam && ["PENDING", "APPROVED", "HIDDEN"].includes(statusParam)
      ? (statusParam as ProfileImageStatus)
      : undefined;

  const images = await listProfileImages(result.id, status);

  return NextResponse.json({ images });
}

/** Team upload: multipart form with profileId + files[]. */
export async function POST(request: Request) {
  // Reject unauthenticated callers before buffering a multi-MB body.
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart form data" },
      { status: 400 }
    );
  }

  const profileId = form.get("profileId");
  const result = await requireProfile(
    typeof profileId === "string" ? profileId : null
  );
  if (result instanceof NextResponse) return result;

  const files = filesFromForm(form);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return NextResponse.json(
      { error: `Too many files (max ${MAX_FILES_PER_UPLOAD} per upload)` },
      { status: 400 }
    );
  }

  const uploadedBy = session.user?.email ?? "team";

  const results = await storeUploadedImages(result.id, files, {
    source: "TEAM",
    status: "APPROVED",
    uploadedBy,
  });

  return NextResponse.json({
    results,
    stored: results.filter((r) => r.ok).length,
  });
}

const bulkStatusSchema = z.object({
  profileId: idSchema,
  from: z.enum(["PENDING", "APPROVED", "HIDDEN"]),
  to: z.enum(["PENDING", "APPROVED", "HIDDEN"]),
});

/** Bulk status change — one updateMany instead of a request per image
 * (backs the "Approve all" button for pending client uploads). */
export async function PATCH(request: Request) {
  const parsed = await parseBody(request, bulkStatusSchema);
  if (parsed.error) return parsed.error;

  const result = await requireProfile(parsed.data.profileId);
  if (result instanceof NextResponse) return result;

  const updated = await prisma.profileImage.updateMany({
    where: { profileId: result.id, status: parsed.data.from },
    data: { status: parsed.data.to },
  });

  return NextResponse.json({ updated: updated.count });
}
