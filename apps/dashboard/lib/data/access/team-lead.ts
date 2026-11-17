import "server-only";

import {
  type AdminScope,
  IdentityRecordSchema,
  isAdminScopeSuspended,
} from "@llm-usage-lens/shared";

import { env } from "@/env";
import {
  ADMIN_ROLE,
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";

import { listScopeAdmins } from "./admin-scopes";
import { loadGrantedRoles } from "./authorization";
import { META_SK, identPk } from "./keys";
import { getItem } from "./store";

const GLOBAL_HOLDER_ROLES: readonly string[] = [
  INTERNAL_ADMIN_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
];

function isGlobalHolder(roles: readonly string[]): boolean {
  return roles.some(
    (role) =>
      GLOBAL_HOLDER_ROLES.includes(role) ||
      (role === ADMIN_ROLE && env.APP_ENV !== "prod"),
  );
}

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)",
// "/api/me leadEmail and own usage byModel" (Slice B2). The lead of a team is
// a team-scope admin of that team that is not a global admin (stored
// internal-admin grant or last seen role); the lowest email wins so the
// answer is deterministic. Read per request, never cached (Rule 60.10).
export async function leadEmailOfTeam(
  teamId: string,
  cursorSecret: string,
): Promise<string | null> {
  const scopes = new Map<string, AdminScope[]>();
  let cursor: string | undefined;
  do {
    const page = await listScopeAdmins(
      { scopeType: "team", scopeId: teamId },
      { cursorSecret, cursor },
    );
    if (!page.ok) throw new Error(`team admin listing failed: ${page.code}`);
    for (const scope of page.value.items) {
      scopes.set(scope.oid, [...(scopes.get(scope.oid) ?? []), scope]);
    }
    cursor = page.value.cursor;
  } while (cursor);

  const emails = await Promise.all(
    [...scopes].map(async ([oid, held]) => {
      const item = await getItem(identPk(oid), META_SK);
      if (!item) return null;
      const identity = IdentityRecordSchema.parse(item);
      const email = identity.email?.trim().toLowerCase();
      if (!email) return null;
      if (held.every((scope) => isAdminScopeSuspended(scope, identity))) {
        return null;
      }
      if (isGlobalHolder(identity.lastSeenRoles)) return null;
      const granted = await loadGrantedRoles(oid);
      return isGlobalHolder(granted) ? null : email;
    }),
  );
  const valid = emails.filter((e): e is string => e !== null).sort();
  return valid[0] ?? null;
}
