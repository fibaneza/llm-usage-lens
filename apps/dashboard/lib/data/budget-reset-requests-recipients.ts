import "server-only";

import {
  IdentityRecordSchema,
  isAdminScopeSuspended,
  runBounded,
} from "@llm-usage-lens/shared";
import type { AdminScope } from "@llm-usage-lens/shared";

import { env } from "@/env";
import {
  ADMIN_ROLE,
  INTERNAL_ADMIN_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";

import { listScopeAdmins } from "./access/admin-scopes";
import { loadGrantedRoles } from "./access/authorization";
import { listIdentities } from "./access/identities";
import { IDENT_META_SK, identItemPk } from "./budget-resets-keys";
import { getItem } from "./access/store";

// Source: docs/specs/2026-11-10-litellm.md — "Budget reset requests" flow
// step 2 (MG-D13): each lead whose scope covers the team, except the
// requester; when there is none, every internal-admin / internal-org-admin
// holder (stored grant or last-seen role, the `leadEmail` precedent). The
// result only decides who is notified; it never grants anything (BR1).

const IDENTITY_READ_CONCURRENCY = 5;

const isGlobalDecider = (roles: readonly string[]) =>
  roles.some(
    (role) =>
      role === INTERNAL_ADMIN_ROLE ||
      role === INTERNAL_ORG_ADMIN_ROLE ||
      (role === ADMIN_ROLE && env.APP_ENV !== "prod"),
  );

async function liveScopeAdmins(
  ref: { scopeType: "team" | "department"; scopeId: string },
  cursorSecret: string,
): Promise<string[]> {
  const scopes: AdminScope[] = [];
  let cursor: string | undefined;
  do {
    const page = await listScopeAdmins(ref, { cursorSecret, cursor });
    if (!page.ok) throw new Error(`scope admin listing failed: ${page.code}`);
    scopes.push(...page.value.items);
    cursor = page.value.cursor;
  } while (cursor);

  const oids = [...new Set(scopes.map((s) => s.oid))];
  const live: string[] = [];
  await runBounded(oids, IDENTITY_READ_CONCURRENCY, async (oid) => {
    const item = await getItem(identItemPk(oid), IDENT_META_SK);
    if (!item) return;
    const identity = IdentityRecordSchema.parse(item);
    const held = scopes.filter((s) => s.oid === oid);
    if (!held.every((s) => isAdminScopeSuspended(s, identity))) live.push(oid);
  });
  return live;
}

async function globalDeciders(cursorSecret: string): Promise<string[]> {
  const oids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await listIdentities({ cursorSecret, cursor });
    if (!page.ok) throw new Error(`identity listing failed: ${page.code}`);
    for (const { oid } of page.value.items) oids.add(oid);
    cursor = page.value.cursor;
  } while (cursor);

  const held: string[] = [];
  await runBounded([...oids], IDENTITY_READ_CONCURRENCY, async (oid) => {
    const item = await getItem(identItemPk(oid), IDENT_META_SK);
    if (!item) return;
    const identity = IdentityRecordSchema.parse(item);
    if (
      isGlobalDecider(identity.lastSeenRoles) ||
      isGlobalDecider(await loadGrantedRoles(oid))
    ) {
      held.push(oid);
    }
  });
  return held;
}

export async function resolveResetRecipients(args: {
  teamId: string;
  departmentId: string;
  requesterOid: string;
  cursorSecret: string;
}): Promise<string[]> {
  const { teamId, departmentId, requesterOid, cursorSecret } = args;
  const [teamLeads, departmentLeads] = await Promise.all([
    liveScopeAdmins({ scopeType: "team", scopeId: teamId }, cursorSecret),
    liveScopeAdmins(
      { scopeType: "department", scopeId: departmentId },
      cursorSecret,
    ),
  ]);
  const leads = new Set([...teamLeads, ...departmentLeads]);
  leads.delete(requesterOid);
  if (leads.size > 0) return [...leads].sort();

  const fallback = new Set(await globalDeciders(cursorSecret));
  fallback.delete(requesterOid);
  return [...fallback].sort();
}
