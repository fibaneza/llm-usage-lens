import type { DefaultSession } from "next-auth";

// Identity and global roles resolved at sign-in by `auth.ts`
// (docs/specs/2026-11-10-access-control.md — Identity, SSO mapping and defaults).
declare module "next-auth" {
  interface Session {
    user: {
      oid: string;
      tid: string;
      roles: string[];
      authMethod: "entra" | "master" | "local";
    } & DefaultSession["user"];
  }

  interface User {
    oid?: string;
    tid?: string;
    roles?: string[];
    authMethod?: "entra" | "master" | "local";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    oid?: string;
    tid?: string;
    roles?: string[];
    authMethod?: "entra" | "master" | "local";
    // Epoch seconds of the sign-in; the session ends at its role-dependent cap.
    signedInAt?: number;
  }
}
