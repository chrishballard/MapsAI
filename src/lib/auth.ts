import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

/**
 * Sign-in email allowlist, driven by the ALLOWED_EMAILS env var
 * (comma-separated, case-insensitive, whitespace-trimmed).
 *
 * IMPORTANT: if ALLOWED_EMAILS is unset (or parses to an empty list), the
 * allowlist is DISABLED — any valid credentials can sign in and a warning is
 * logged. This is intentional: the running Railway deployment must not lock
 * everyone out before the env var has been configured. Set ALLOWED_EMAILS in
 * production to enforce the allowlist.
 */
function isEmailAllowed(email: string): boolean {
  const raw = process.env.ALLOWED_EMAILS;
  const allowed = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) {
    console.warn(
      "[auth] ALLOWED_EMAILS is not set — sign-in allowlist is disabled. " +
        "Set ALLOWED_EMAILS (comma-separated emails) to restrict who can sign in."
    );
    return true;
  }

  return allowed.includes(email.trim().toLowerCase());
}

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

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
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
