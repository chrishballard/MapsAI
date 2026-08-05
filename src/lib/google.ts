import { google } from "googleapis";
import { prisma } from "./prisma";

const SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/userinfo.email",
];

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// How far the claiming worker bumps tokenExpiry while it refreshes. Must stay
// well under REFRESH_BUFFER_MS so a crashed claim never makes the stale token
// look valid to other workers.
const CLAIM_WINDOW_MS = 30 * 1000;

export class GoogleAuthRevokedError extends Error {
  constructor(googleEmail: string) {
    super(
      `Google access for ${googleEmail} has been revoked. The account must be reconnected.`
    );
    this.name = "GoogleAuthRevokedError";
  }
}

function isInvalidGrant(error: unknown): boolean {
  const e = error as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return (
    e?.response?.data?.error === "invalid_grant" ||
    (typeof e?.message === "string" && e.message.includes("invalid_grant"))
  );
}

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Cookie that carries the OAuth state nonce between /api/auth/google and the
// callback. httpOnly + sameSite=lax; lax still sends it on the top-level
// redirect back from accounts.google.com.
export const OAUTH_STATE_COOKIE = "google_oauth_state";

export function getAuthUrl(state: string) {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

export async function createGoogleClient(googleAccountId: string) {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
  });

  if (account.needsReauth) {
    throw new GoogleAuthRevokedError(account.googleEmail);
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
  });

  await refreshTokenIfNeeded(account.id, oauth2Client, account.tokenExpiry);

  return oauth2Client;
}

export async function refreshTokenIfNeeded(
  googleAccountId: string,
  oauth2Client: InstanceType<typeof google.auth.OAuth2>,
  tokenExpiry: Date
) {
  const now = new Date();
  if (now.getTime() < tokenExpiry.getTime() - REFRESH_BUFFER_MS) return;

  // Atomic claim: only the worker that still observes the current expiry gets
  // to refresh; concurrent workers see count === 0 and wait for its result.
  const claim = await prisma.googleAccount.updateMany({
    where: { id: googleAccountId, tokenExpiry },
    data: { tokenExpiry: new Date(now.getTime() + CLAIM_WINDOW_MS) },
  });

  if (claim.count === 0) {
    const refreshed = await waitForRefreshedToken(googleAccountId, now);
    if (refreshed) {
      oauth2Client.setCredentials({
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
      });
      return;
    }
    // The claiming worker never finished — refresh ourselves as a fallback.
  }

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    await prisma.googleAccount.update({
      where: { id: googleAccountId },
      data: {
        accessToken: credentials.access_token!,
        tokenExpiry: new Date(credentials.expiry_date!),
        // Google may rotate the refresh token; losing it breaks all future refreshes.
        ...(credentials.refresh_token
          ? { refreshToken: credentials.refresh_token }
          : {}),
      },
    });
  } catch (error) {
    if (isInvalidGrant(error)) {
      const account = await prisma.googleAccount.update({
        where: { id: googleAccountId },
        data: { needsReauth: true },
      });
      throw new GoogleAuthRevokedError(account.googleEmail);
    }
    throw error;
  }
}

async function waitForRefreshedToken(googleAccountId: string, since: Date) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const account = await prisma.googleAccount.findUniqueOrThrow({
      where: { id: googleAccountId },
    });
    if (account.needsReauth) {
      throw new GoogleAuthRevokedError(account.googleEmail);
    }
    // A completed refresh sets expiry ~1h out — well past the claim window.
    if (account.tokenExpiry.getTime() > since.getTime() + CLAIM_WINDOW_MS) {
      return account;
    }
  }
  return null;
}
