import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  GSI1_NAME,
  IdentityRecordSchema,
  PendingItemSchema,
} from "@llm-usage-lens/shared";
import type {
  IdentityRecord,
  InviteCandidate,
  MemberAffiliation,
  PendingItem,
} from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { affiliationItem, affiliationSnapshot } from "./affiliations";
import {
  AFFILIATION_SK,
  IDENTS_GSI1PK,
  META_SK,
  PENDING_LITELLMLINK_SK,
  adminScopeSk,
  adminsGsi1pk,
  identPk,
  membersGsi1pk,
  pendingPk,
} from "./keys";
import type { AccessResult, AuditContext } from "./result";
import { configuredTenant } from "./sso-binding";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "Membership, admin scopes
// and lifecycle" (Joiner: pre-staged items by email/UPN); contract R2 §2, §4.
// Emails are lower-cased by the key builder and on the stored item.
type NewPendingItem =
  | { kind: "affiliation"; emailOrUpn: string; teamId: string }
  | {
      kind: "adminScope";
      emailOrUpn: string;
      scopeType: "team" | "department";
      scopeId: string;
    };

const sortKey = (item: NewPendingItem | PendingItem): string =>
  item.kind === "affiliation"
    ? AFFILIATION_SK
    : adminScopeSk(item.scopeType, item.scopeId);

const gsi1pk = (item: NewPendingItem | PendingItem): string =>
  item.kind === "affiliation"
    ? membersGsi1pk(item.teamId)
    : adminsGsi1pk(item.scopeType, item.scopeId);

const snapshot = (item: PendingItem) => ({
  kind: item.kind,
  version: item.version,
  ...(item.kind === "affiliation"
    ? { teamId: item.teamId }
    : { scopeType: item.scopeType, scopeId: item.scopeId }),
});

const auditTarget = (item: PendingItem) => ({
  target: { type: "pending", id: item.emailOrUpn },
  ...(item.kind === "affiliation"
    ? { teamId: item.teamId }
    : item.scopeType === "team"
      ? { teamId: item.scopeId }
      : {}),
});

export async function createPendingItem(
  input: NewPendingItem,
  ctx: AuditContext,
): Promise<AccessResult<PendingItem>> {
  const value: PendingItem = {
    ...input,
    emailOrUpn: input.emailOrUpn.toLowerCase(),
    createdBy: ctx.actor,
    createdAt: ctx.now.toISOString(),
    version: 1,
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: pendingPk(value.emailOrUpn),
            SK: sortKey(value),
            gsi1pk: gsi1pk(value),
            gsi1sk: pendingPk(value.emailOrUpn),
            ...value,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "pending.create",
      ...auditTarget(value),
      after: snapshot(value),
    },
    ctx,
    conflictCodes: {
      0: value.kind === "affiliation" ? "ALREADY_AFFILIATED" : "CONFLICT",
    },
  });
  return result.ok ? { ok: true, value } : result;
}

export async function deletePendingItem(
  input: { item: PendingItem; version: number },
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const Key = {
    PK: pendingPk(input.item.emailOrUpn),
    SK: sortKey(input.item),
  };
  const stored = await getItem(Key.PK, Key.SK);
  if (!stored) return { ok: false, code: "NOT_FOUND" };
  const current = PendingItemSchema.parse(stored);
  if (current.version !== input.version) return { ok: false, code: "CONFLICT" };
  const result = await commitAudited({
    items: [
      {
        Delete: {
          TableName: getTableName(),
          Key,
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":v": input.version },
        },
      },
    ],
    audit: {
      action: "pending.delete",
      ...auditTarget(current),
      before: snapshot(current),
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

// Bounded by the number of pending items one person can hold (a handful), so
// each partition is read to the end here rather than handed out as a cursor.
export async function listPendingFor(
  emailsOrUpns: readonly string[],
): Promise<PendingItem[]> {
  const unique = [...new Set(emailsOrUpns.map((e) => pendingPk(e)))];
  const found: PendingItem[] = [];
  for (const pk of unique) {
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await getDocumentClient().send(
        new QueryCommand({
          TableName: getTableName(),
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": pk },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) {
        // A PendingLiteLLMLink shares this partition (Access Control - Data
        // model additions); it is not a pending member or admin item.
        if (item.SK === PENDING_LITELLMLINK_SK) continue;
        found.push(PendingItemSchema.parse(item));
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
  }
  return found;
}

// Source: docs/specs/2026-11-10-access-control.md - "Accept a pending invite
// (unit INV1)". One transaction: the pending member item goes (on its version
// and team), the UI-sourced affiliation is written only if the target has
// none, and the audit record commits with them. An SSO-sourced affiliation is
// read first so it answers MANAGED_BY_SSO rather than ALREADY_AFFILIATED.
export async function acceptPendingInvite(
  input: {
    emailOrUpn: string;
    teamId: string;
    version: number;
    oid: string;
    reason: string;
  },
  ctx: AuditContext,
): Promise<AccessResult<MemberAffiliation>> {
  const key = input.emailOrUpn.toLowerCase();
  const existing = await getItem(identPk(input.oid), AFFILIATION_SK);
  if (existing?.source === "sso") return { ok: false, code: "MANAGED_BY_SSO" };
  const now = ctx.now.toISOString();
  const value: MemberAffiliation = {
    oid: input.oid,
    teamId: input.teamId,
    source: "ui",
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actor,
  };
  const result = await commitAudited({
    items: [
      {
        Delete: {
          TableName: getTableName(),
          Key: { PK: pendingPk(key), SK: AFFILIATION_SK },
          ConditionExpression: "version = :v AND teamId = :t",
          ExpressionAttributeValues: {
            ":v": input.version,
            ":t": input.teamId,
          },
        },
      },
      {
        Put: {
          TableName: getTableName(),
          Item: affiliationItem(value),
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "affiliation.invite.accept",
      target: { type: "identity", id: input.oid },
      teamId: input.teamId,
      after: {
        ...affiliationSnapshot(value),
        emailOrUpn: key,
        reason: input.reason,
      },
    },
    ctx,
    conflictCodes: { 1: "ALREADY_AFFILIATED" },
  });
  return result.ok ? { ok: true, value } : result;
}

const MAX_CANDIDATES = 10;

const toCandidate = (identity: IdentityRecord): InviteCandidate => ({
  oid: identity.oid,
  displayName: identity.displayName ?? null,
  upn: identity.upn ?? null,
  email: identity.email ?? null,
});

// A guest UPN writes the address with "_" for "@": jane@example.com is
// jane_example.com#EXT#@tenant.onmicrosoft.com.
function guestUpnPrefix(key: string): string | null {
  const at = key.lastIndexOf("@");
  if (at < 1) return null;
  return `${key.slice(0, at)}_${key.slice(at + 1)}#ext#@`;
}

async function hasMemberTeam(oid: string): Promise<boolean> {
  return (await getItem(identPk(oid), AFFILIATION_SK)) !== null;
}

// Walks the identity directory page by page and keeps the first
// MAX_CANDIDATES identities of the configured tenant that match and have no
// member team. Read per request, never cached (Rule 60.10).
async function collectCandidates(
  matches: (identity: IdentityRecord) => boolean,
): Promise<InviteCandidate[]> {
  const tenant = configuredTenant();
  if (!tenant) return [];
  const found: InviteCandidate[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: { ":pk": IDENTS_GSI1PK, ":sk": "IDENT#" },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const identity = IdentityRecordSchema.parse(item);
      if (identity.tid.toLowerCase() !== tenant || !matches(identity)) continue;
      if (await hasMemberTeam(identity.oid)) continue;
      found.push(toCandidate(identity));
      if (found.length === MAX_CANDIDATES) return found;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return found;
}

export function listInviteCandidates(
  emailOrUpn: string,
): Promise<InviteCandidate[]> {
  const key = emailOrUpn.toLowerCase();
  const guest = guestUpnPrefix(key);
  return collectCandidates((identity) => {
    const upn = identity.upn?.toLowerCase();
    return (
      upn === key ||
      (guest !== null && upn !== undefined && upn.startsWith(guest)) ||
      identity.email?.toLowerCase() === key
    );
  });
}

export function searchInviteDirectory(
  query: string,
): Promise<InviteCandidate[]> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return Promise.resolve([]);
  return collectCandidates((identity) =>
    [identity.displayName, identity.email, identity.upn].some((field) =>
      field?.toLowerCase().includes(needle),
    ),
  );
}

// The identity of a signed-in person in the configured tenant; null when the
// person never signed in, or belongs to another tenant or none is configured.
export async function findTenantIdentity(
  oid: string,
): Promise<IdentityRecord | null> {
  const tenant = configuredTenant();
  if (!tenant) return null;
  const item = await getItem(identPk(oid), META_SK);
  if (!item) return null;
  const identity = IdentityRecordSchema.parse(item);
  return identity.tid.toLowerCase() === tenant ? identity : null;
}
