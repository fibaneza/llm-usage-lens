import type { DefaultSession } from "next-auth";

// The `roles` claim copied from the Entra ID token by `auth.ts`
// (docs/specs/2026-05-15-system-architecture.md — "Account-mutation role").
declare module "next-auth" {
  interface Session {
    user: { roles: string[] } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    roles?: string[];
    // Epoch seconds of the sign-in; the session ends 8 hours after it.
    signedInAt?: number;
  }
}
