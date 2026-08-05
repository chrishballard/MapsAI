import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@/generated/prisma/client";

/**
 * Guard for API route handlers. Returns a 401 response when there is no
 * authenticated session, or null when the request is authorized.
 *
 *   const unauthorized = await requireSession();
 *   if (unauthorized) return unauthorized;
 */
export async function requireSession(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Session check + profile lookup in one step. Returns the profile, or a
 * ready-to-return error response (401 unauthorized, 400 missing profileId,
 * 404 profile not found).
 *
 *   const result = await requireProfile(profileId);
 *   if (result instanceof NextResponse) return result;
 *   const profile = result;
 */
export async function requireProfile(
  profileId: string | null | undefined
): Promise<Profile | NextResponse> {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  if (!profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return profile;
}
