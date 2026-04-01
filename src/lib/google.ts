import { google } from "googleapis";
import { prisma } from "./prisma";

const SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl() {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function createGoogleClient(googleAccountId: string) {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
  });

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
  const expiryBuffer = new Date(tokenExpiry.getTime() - 5 * 60 * 1000); // 5 min buffer

  if (now < expiryBuffer) return;

  const { credentials } = await oauth2Client.refreshAccessToken();
  oauth2Client.setCredentials(credentials);

  await prisma.googleAccount.update({
    where: { id: googleAccountId },
    data: {
      accessToken: credentials.access_token!,
      tokenExpiry: new Date(credentials.expiry_date!),
    },
  });
}
