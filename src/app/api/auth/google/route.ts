import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAuthUrl, OAUTH_STATE_COOKIE } from "@/lib/google";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  // CSRF protection: bind this authorization request to the browser via a
  // random state nonce, echoed back by Google and validated in the callback.
  const state = crypto.randomBytes(32).toString("hex");
  const response = NextResponse.redirect(getAuthUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
