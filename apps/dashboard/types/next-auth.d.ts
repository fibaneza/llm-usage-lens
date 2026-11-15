import type { DefaultSession } from "next-auth";

// Identity and global roles resolved at sign-in by `auth.ts`
// (docs/specs/2026-11-10-access-control.md — Identity, SSO mapping and defaults).
declare module "next-auth" {
  interface Session {
    user: {
      oid: string;
      tid: string;
      roles: string[];
      authMethod: "entra" | "master" | "local" | "password";
      // Epoch seconds of the last credential check (D28); read-only, set at sign-in.
      authTime?: number;
      // Epoch seconds of the sign-in; identifies the session to its own password change (D29).
      signedInAt?: number;
    } & DefaultSession["user"];
  }

  interface User {
    oid?: string;
    tid?: string;
    roles?: string[];
    authMethod?: "entra" | "master" | "local" | "password";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    oid?: string;
    tid?: string;
    roles?: string[];
    authMethod?: "entra" | "master" | "local" | "password";
    // Epoch seconds of the sign-in; the session ends at its role-dependent cap.
    signedInAt?: number;
    // Epoch seconds of the credential check (D28); set only at sign-in.
    authTime?: number;
    email?: string;
    // Password sessions only (D29); never exposed on the session.
    credentialVersion?: number;
  }
}
