import crypto from "crypto";
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

/**
 * Sign-in email allowlist, driven by the ALLOWED_EMAILS env var
 * (comma-separated, case-insensitive, whitespace-trimmed).
 *
 * If ALLOWED_EMAILS is unset (or parses to an empty list):
 *  - in production the allowlist FAILS CLOSED — every sign-in is rejected
 *    until the env var is configured. A misconfigured deploy must not become
 *    an open door.
 *  - in development it is disabled (any valid credentials work) with a
 *    warning, so local setups don't need the env var.
 */
function isEmailAllowed(email: string): boolean {
  const raw = process.env.ALLOWED_EMAILS;
  const allowed = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[auth] ALLOWED_EMAILS is not set — rejecting ALL sign-ins in production. " +
          "Set ALLOWED_EMAILS (comma-separated emails) to allow access."
      );
      return false;
    }
    console.warn(
      "[auth] ALLOWED_EMAILS is not set — sign-in allowlist is disabled (non-production only). " +
        "Set ALLOWED_EMAILS (comma-separated emails) to restrict who can sign in."
    );
    return true;
  }

  return allowed.includes(email.trim().toLowerCase());
}

/**
 * Short digest of the user's password hash, embedded in the JWT as a token
 * version. When the password hash changes (or the user is deleted), every
 * outstanding JWT stops validating — see the jwt callback below.
 */
function passwordVersion(passwordHash: string): string {
  return crypto
    .createHash("sha256")
    .update(passwordHash)
    .digest("hex")
    .slice(0, 16);
}

// How often a live session re-checks its password version against the DB.
// Bounds both the DB cost (one indexed lookup per user per interval) and the
// window in which a changed password leaves an old session usable.
const PW_VERSION_RECHECK_MS = 10 * 60 * 1000;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Email allowlist gate — see isEmailAllowed() above.
        if (!isEmailAllowed(credentials.email)) {
          console.warn(
            `[auth] Rejected sign-in for ${credentials.email}: not in ALLOWED_EMAILS`
          );
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) return null;

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          // Carried into the JWT so password changes revoke the session.
          pwv: passwordVersion(user.passwordHash),
        };
      },
    }),
  ],
  // JWT sessions have no server-side store, so revocation is approximated two
  // ways: a 7-day maxAge (down from next-auth's 30-day default) caps how long
  // any token lives, and the pwv (password version) check in the jwt callback
  // kills sessions within PW_VERSION_RECHECK_MS of a password change or user
  // deletion. Remaining gap: within that recheck window a stolen token still
  // works, and there is no way to revoke a single session on demand short of
  // rotating NEXTAUTH_SECRET (which signs everyone out).
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.pwv = user.pwv;
        token.pwvCheckedAt = Date.now();
        return token;
      }

      // Periodically re-verify the token against the current password hash.
      // Throwing here is next-auth v4's supported escape hatch: the session
      // route catches it, logs JWT_SESSION_ERROR, and clears the session
      // cookie — i.e. the user is signed out. Tokens issued before this
      // deploy have no pwv and are invalidated on their first recheck.
      const checkedAt =
        typeof token.pwvCheckedAt === "number" ? token.pwvCheckedAt : 0;
      if (Date.now() - checkedAt > PW_VERSION_RECHECK_MS) {
        const dbUser =
          typeof token.id === "string"
            ? await prisma.user.findUnique({
                where: { id: token.id },
                select: { passwordHash: true },
              })
            : null;
        if (!dbUser || passwordVersion(dbUser.passwordHash) !== token.pwv) {
          throw new Error(
            "Session revoked: password changed or user no longer exists"
          );
        }
        token.pwvCheckedAt = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};
