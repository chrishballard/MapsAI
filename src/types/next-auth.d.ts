import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    // Password version — digest of the password hash, used to revoke JWT
    // sessions when the password changes. See src/lib/auth.ts.
    pwv?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    pwv?: string;
    pwvCheckedAt?: number;
  }
}
