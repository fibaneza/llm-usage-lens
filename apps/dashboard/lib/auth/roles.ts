import type { Session } from "next-auth";
import { z } from "zod";

// Source: docs/specs/2026-05-15-system-architecture.md — "Authentication &
// Access" → "Account-mutation role"; Rule 50.3. Pure and dependency-light (no
// env, no server-only) so Server Components and the Settings UI can import it.

export const ADMIN_ROLE = "Admin";

export const INTERNAL_ADMIN_ROLE = "internal-admin";
export const GLOBAL_ROLES = [
  INTERNAL_ADMIN_ROLE,
  "internal-org-admin",
  "internal-auditor",
  "internal-viewer",
] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

const DEFAULT_ROLE: GlobalRole = "internal-viewer";

export function isGlobalRole(value: unknown): value is GlobalRole {
  return GLOBAL_ROLES.some((role) => role === value);
}

// Access Control spec — Identity, SSO mapping and defaults. `null` means the
// claim is present but not an array: no session (fail closed). The legacy
// `Admin` alias is off in prod, which is always enforce.
export function resolveGlobalRoles(
  claim: unknown,
  appEnv: "dev" | "prod",
): GlobalRole[] | null {
  if (claim === undefined) return [DEFAULT_ROLE];
  if (!Array.isArray(claim)) return null;
  const found = new Set<GlobalRole>();
  for (const entry of claim as unknown[]) {
    if (isGlobalRole(entry)) found.add(entry);
    else if (entry === ADMIN_ROLE && appEnv !== "prod") {
      found.add(INTERNAL_ADMIN_ROLE);
    }
  }
  const ordered = GLOBAL_ROLES.filter((role) => found.has(role));
  return ordered.length > 0 ? ordered : [DEFAULT_ROLE];
}

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

export function hasGlobalRole(
  session: Session | null | undefined,
  role: GlobalRole,
): boolean {
  const roles: unknown = session?.user?.roles;
  return Array.isArray(roles) && roles.includes(role);
}

export function hasAdminRole(session: Session | null | undefined): boolean {
  return hasGlobalRole(session, INTERNAL_ADMIN_ROLE);
}
