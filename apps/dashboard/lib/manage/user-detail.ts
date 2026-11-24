import "server-only";

import { IdentityDetailSchema } from "@llm-usage-lens/shared";
import type {
  AdminScope,
  IdentityDetail,
  RoleGrant,
} from "@llm-usage-lens/shared";
import type { Session } from "next-auth";

import { env } from "@/env";
import { cursorSecret } from "@/lib/api/access-route";
import { findPersonInvites } from "@/lib/api/person-invite";
import { globalRolesOf } from "@/lib/auth/policy";
import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";
import type { GlobalRole } from "@/lib/auth/roles";
import { listAdminScopes } from "@/lib/data/access/admin-scopes";
import { getAffiliation } from "@/lib/data/access/affiliations";
import { loadAuthorization } from "@/lib/data/access/authorization";
import { getIdentityLink } from "@/lib/data/access/identity-links";
import { getPasswordUser } from "@/lib/data/access/password-users";
import { getIdentityRecord } from "@/lib/data/access/team-member-lookup";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { enabledOperations } from "@/lib/litellm/read-views";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (`GET /api/identities/[oid]`), the permission matrix row for the user-page
// read (D-US11, the user's decision, 2026-11-23); Design System - "The user
// page (unit US2)" D-US6, D-US10, D-US11, D-US12 and the 2026-11-24 agent
// decisions (versions in the read; one shared builder). Roles are the claim
// plus stored grants, read per request and never cached (Rule 60.10). Nothing
// of the identity record beyond the fields below leaves this module (T-US1).
type Caller = { roles: readonly GlobalRole[]; oid: string };

async function callerOf(session: Session): Promise<Caller | null> {
  const input = await loadAuthorization({
    appEnv: env.APP_ENV === "prod" ? "prod" : "dev",
    session,
    teamIds: [],
    departmentIds: [],
  });
  const roles = globalRolesOf(session, input.appEnv, input.roleGrants);
  const oid = session.user?.oid;
  if (roles === null || typeof oid !== "string" || oid === "") return null;
  return { roles, oid };
}

const READER_ROLES: readonly GlobalRole[] = [
  INTERNAL_ADMIN_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
];

export async function mayReadIdentityDetail(
  session: Session,
): Promise<boolean> {
  const caller = await callerOf(session);
  return caller?.roles.some((r) => READER_ROLES.includes(r)) ?? false;
}

async function listAllScopes(oid: string): Promise<AdminScope[]> {
  const scopes: AdminScope[] = [];
  let cursor: string | undefined;
  do {
    const page = await listAdminScopes(oid, {
      cursorSecret: cursorSecret(),
      ...(cursor ? { cursor } : {}),
    });
    if (!page.ok) throw new Error("admin scope read failed");
    scopes.push(...page.value.items);
    cursor = page.value.cursor;
  } while (cursor);
  return scopes;
}

// The stored grants of one person, with their versions: the per-request
// authorization read for that oid (Rule 60.10).
async function grantsOf(oid: string): Promise<RoleGrant[]> {
  const input = await loadAuthorization({
    appEnv: env.APP_ENV === "prod" ? "prod" : "dev",
    session: { user: { oid } },
    teamIds: [],
    departmentIds: [],
  });
  return [...input.roleGrants];
}

async function resetSpendAvailable(linked: boolean): Promise<boolean> {
  if (!linked || !(await isLiteLLMConfigured())) return false;
  return (await enabledOperations()).includes("resetMemberSpend");
}

export async function loadIdentityDetail(
  session: Session,
  oid: string,
): Promise<IdentityDetail | null> {
  const caller = await callerOf(session);
  if (!caller || !caller.roles.some((r) => READER_ROLES.includes(r))) {
    return null;
  }
  const identity = await getIdentityRecord(oid);
  if (!identity) return null;

  const isAdmin = caller.roles.includes(INTERNAL_ADMIN_ROLE);
  const isOrgAdmin = caller.roles.includes(INTERNAL_ORG_ADMIN_ROLE);
  const isAuditor = caller.roles.includes(INTERNAL_AUDITOR_ROLE);
  const isSelf = caller.oid === oid;
  const canWrite = isAdmin || isOrgAdmin;

  const email = identity.email?.toLowerCase() ?? null;
  const passwordUser =
    identity.authMethod === "password" && email
      ? await getPasswordUser(email)
      : null;

  const [affiliation, scopes, link, grants] = await Promise.all([
    getAffiliation(oid),
    listAllScopes(oid),
    getIdentityLink(oid),
    grantsOf(oid),
  ]);
  const linkedId = link?.litellmUserId;
  // Placing a person by hand (T-IV5): state and invite for member writers only.
  const invites = canWrite
    ? await findPersonInvites([identity.email, identity.upn])
    : [];

  const canEditName =
    isAdmin && passwordUser !== null && passwordUser.status !== "sso-bound";
  const detail = {
    oid,
    displayName: passwordUser?.displayName ?? identity.displayName ?? null,
    email: identity.email ?? null,
    upn: identity.upn ?? null,
    authMethod: identity.authMethod,
    createdAt: identity.createdAt ?? null,
    lastSignInAt: identity.lastSignInAt,
    memberTeamId: affiliation?.teamId ?? null,
    memberVersion: affiliation?.version ?? 0,
    leadScopes: scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
      version: s.version,
    })),
    litellm: linkedId
      ? { state: "linked" as const, litellmUserId: linkedId }
      : { state: "none" as const },
    linkVersion: link?.version ?? 0,
    usageIdentities: link?.usageIdentities ?? [],
    aliases: link?.aliases ?? [],
    roleGrants: grants.map((g) => ({
      role: g.role,
      grantedAt: g.grantedAt,
      version: g.version,
    })),
    ...(passwordUser && (isAdmin || isAuditor)
      ? {
          sso: {
            expectedUpn: passwordUser.sso.expectedUpn,
            ...(passwordUser.sso.expectedOid
              ? { expectedOid: passwordUser.sso.expectedOid }
              : {}),
            ...(passwordUser.sso.boundAt
              ? { boundAt: passwordUser.sso.boundAt }
              : {}),
          },
        }
      : {}),
    ...(canEditName && passwordUser
      ? { passwordUserVersion: passwordUser.version }
      : {}),
    ...(canWrite
      ? invites.length > 0
        ? { state: "invited" as const, invites }
        : { state: "signed-in" as const }
      : {}),
    allowed: {
      editDisplayName: canEditName,
      linkLiteLLM: canWrite && !isSelf,
      unlinkLiteLLM: canWrite && !isSelf,
      resetSpend: canWrite && (await resetSpendAvailable(Boolean(linkedId))),
      changeMembership: canWrite,
      changeLead: canWrite && !isSelf,
      editRoles: isAdmin && !isSelf,
      editUsageIdentities: isAdmin && !isSelf,
    },
  };
  return IdentityDetailSchema.parse(detail);
}
