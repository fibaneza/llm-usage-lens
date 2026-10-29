import type { Session } from "next-auth";
import { z } from "zod";

// Source: docs/specs/2026-05-15-system-architecture.md — "Authentication &
// Access" → "Account-mutation role"; Rule 50.3. Pure and dependency-light (no
// env, no server-only) so Server Components and the Settings UI can import it.

export const ADMIN_ROLE = "Admin";

// A malformed value means no roles; non-string entries are dropped, never
// reinterpreted.
const RolesSchema = z
  .array(z.unknown())
  .transform((entries) =>
    entries.filter((entry): entry is string => typeof entry === "string"),
  );

const ProfileRolesSchema = z.object({ roles: RolesSchema });

export function parseRoles(roles: unknown): string[] {
  const parsed = RolesSchema.safeParse(roles);
  return parsed.success ? parsed.data : [];
}

export function rolesFromProfile(profile: unknown): string[] {
  const parsed = ProfileRolesSchema.safeParse(profile);
  return parsed.success ? parsed.data.roles : [];
}

export function hasAdminRole(session: Session | null | undefined): boolean {
  const roles: unknown = session?.user?.roles;
  return Array.isArray(roles) && roles.includes(ADMIN_ROLE);
}
