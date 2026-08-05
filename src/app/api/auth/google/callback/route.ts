import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createOAuth2Client, OAUTH_STATE_COOKIE } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import { syncLocationsForAccount } from "@/lib/google-locations";

function statesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Every exit path clears the one-time state cookie so a nonce can't be replayed.
function redirectClearingState(path: string) {
  const response = NextResponse.redirect(
    new URL(path, process.env.NEXTAUTH_URL)
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  // CSRF check: the state echoed by Google must match the nonce we set in
  // /api/auth/google. Rejecting here stops an attacker from binding their own
  // Google account (via a forged callback URL) to the victim's session.
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !storedState || !statesMatch(state, storedState)) {
    console.warn("[oauth] Rejected Google callback: state mismatch or missing");
    return redirectClearingState("/dashboard/profiles?error=invalid_state");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectClearingState("/dashboard/profiles?error=no_code");
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get the Google account email
    const oauth2 = await import("googleapis").then((g) =>
      g.google.oauth2({ version: "v2", auth: oauth2Client })
    );
    const { data: userInfo } = await oauth2.userinfo.get();
    const googleEmail = userInfo.email!;

    // Upsert the Google account
    const googleAccount = await prisma.googleAccount.upsert({
      where: { googleEmail },
      create: {
        googleEmail,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        tokenExpiry: new Date(tokens.expiry_date!),
      },
      update: {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiry: new Date(tokens.expiry_date!),
        needsReauth: false,
      },
    });

    // Sync locations
    await syncLocationsForAccount(googleAccount.id);

    return redirectClearingState("/dashboard/profiles?connected=true");
  } catch (error) {
    // Log the message only — the full error object can include OAuth client credentials
    console.error(
      "Google OAuth callback error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return redirectClearingState("/dashboard/profiles?error=oauth_failed");
  }
}
