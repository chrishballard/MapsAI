import { NextResponse } from "next/server";
import {
  storeUploadedImages,
  filesFromForm,
  profileForUploadToken,
} from "@/lib/image-upload";
import { isValidImageToken } from "@/lib/image-tokens";
import { MAX_FILES_PER_UPLOAD } from "@/lib/image-validation";

// PUBLIC route — the client photo-upload page posts here. The profile's
// uploadToken (32 hex chars, shareable link) is the only credential; photos
// land as PENDING and enter the post rotation only after a team member
// approves them in the dashboard.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!isValidImageToken(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const profile = await profileForUploadToken(token);
  if (!profile) {
    return NextResponse.json(
      { error: "This upload link is no longer active" },
      { status: 404 }
    );
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

  const results = await storeUploadedImages(profile.id, files, {
    source: "CLIENT",
    status: "PENDING",
    uploadedBy: "client",
  });

  return NextResponse.json({
    results,
    stored: results.filter((r) => r.ok).length,
  });
}
