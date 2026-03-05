import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createOAuth2Client } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import { syncLocationsForAccount } from "@/lib/google-locations";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/dashboard/profiles?error=no_code", process.env.NEXTAUTH_URL)
    );
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
      },
    });

    // Sync locations
    await syncLocationsForAccount(googleAccount.id);

    return NextResponse.redirect(
      new URL("/dashboard/profiles?connected=true", process.env.NEXTAUTH_URL)
    );
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/dashboard/profiles?error=oauth_failed", process.env.NEXTAUTH_URL)
    );
  }
}
