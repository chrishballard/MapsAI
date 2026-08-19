import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidImageToken } from "@/lib/image-tokens";

// PUBLIC route — no session. Google fetches post photos from here at
// publish time, so it must work without auth; the 32-hex publicToken is the
// only credential. Served immutable: image bytes never change after upload
// (a replaced photo gets a new row and token).
//
// ?size=thumb serves the ~480px JPEG stored at upload (our UI's grid/card
// requests) and falls back to the original when no thumb exists. Google
// always fetches the bare URL — the full-size original.

function serveBytes(bytes: Uint8Array, contentType: string): NextResponse {
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Cheap shape check before touching the DB.
  if (!isValidImageToken(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const wantThumb = new URL(request.url).searchParams.get("size") === "thumb";

  // Thumb requests never pull the original bytes unless no thumb exists.
  if (wantThumb) {
    const image = await prisma.profileImage.findUnique({
      where: { publicToken: token },
      select: { thumbData: true, googleUrl: true },
    });
    if (!image) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (image.thumbData) return serveBytes(image.thumbData, "image/jpeg");
    if (image.googleUrl) return NextResponse.redirect(image.googleUrl, 302);
    // No thumb stored (small original) — fall through to the original.
  }

  const image = await prisma.profileImage.findUnique({
    where: { publicToken: token },
    select: { data: true, contentType: true, googleUrl: true },
  });

  if (!image) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (image.data) {
    return serveBytes(image.data, image.contentType ?? "image/jpeg");
  }

  // GBP-synced image — Google hosts the bytes.
  if (image.googleUrl) {
    return NextResponse.redirect(image.googleUrl, 302);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
