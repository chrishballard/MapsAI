import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/require-session";
import { prisma } from "@/lib/prisma";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";
import { newImageToken } from "@/lib/image-tokens";
import { appBaseUrl } from "@/lib/image-urls";

function linkUrl(token: string): string {
  const base = appBaseUrl();
  return base ? `${base}/u/${token}` : `/u/${token}`;
}

/** Current client upload link for a profile (null when none is active). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const result = await requireProfile(searchParams.get("profileId"));
  if (result instanceof NextResponse) return result;

  return NextResponse.json({
    url: result.uploadToken ? linkUrl(result.uploadToken) : null,
  });
}

/**
 * Create the profile's client upload link, or rotate it if one exists —
 * rotating invalidates the previously shared link immediately.
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;

  const result = await requireProfile(parsed.data.profileId);
  if (result instanceof NextResponse) return result;

  const token = newImageToken();
  await prisma.profile.update({
    where: { id: result.id },
    data: { uploadToken: token },
  });

  return NextResponse.json({ url: linkUrl(token) });
}

/** Disable the client upload link entirely. */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const result = await requireProfile(searchParams.get("profileId"));
  if (result instanceof NextResponse) return result;

  await prisma.profile.update({
    where: { id: result.id },
    data: { uploadToken: null },
  });

  return NextResponse.json({ url: null });
}
