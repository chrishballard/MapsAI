import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/require-session";
import { parseBody, profileIdBodySchema } from "@/lib/api-validation";
import { syncProfileMediaToLibrary } from "@/lib/google-media";
import { GoogleAuthRevokedError } from "@/lib/google";

/** Pull the profile's current GBP photos into the image library. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, profileIdBodySchema);
  if (parsed.error) return parsed.error;

  const result = await requireProfile(parsed.data.profileId);
  if (result instanceof NextResponse) return result;

  if (!result.accountResourceName) {
    return NextResponse.json(
      { error: "Profile is missing its Google account link — reconnect it first" },
      { status: 400 }
    );
  }

  try {
    const sync = await syncProfileMediaToLibrary(result.id);
    return NextResponse.json(sync);
  } catch (err) {
    const message =
      err instanceof GoogleAuthRevokedError
        ? err.message
        : "Google Business Profile could not be reached — try again shortly";
    console.error(`[images-sync] Failed for profile ${result.id}:`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
