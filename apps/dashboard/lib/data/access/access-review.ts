import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  AdminScopeSchema,
  GSI1_NAME,
  IdentityLinkSchema,
  IdentityRecordSchema,
  type IdentityRecord,
  MemberAffiliationSchema,
  RoleGrantSchema,
} from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { IDENTS_GSI1PK, LOCALUSERS_GSI1PK, identPk } from "./keys";
import { listPendingLiteLLMLinks } from "./pending-litellm-links";
import type { AuditContext } from "./result";
import { recordAuditedRead } from "./store";

// Source: docs/specs/2026-11-10-access-control.md - "Access review" (the
// columns and flags), "Data model additions" (access review reads
// Query GSI1=IDENTS, then each identity's items), D2 (stale = 90 days),
// Enforcement item 4 (never cached), Rule 20.6 (paginate). Secrets and
// lockout state never leave the identity schema pick below.
const STALE_AFTER_MS = 90 * 86_400_000;
// A pending LiteLLM link not bound after 30 days is stale (Access Control -
// LiteLLM user sync, Pending LiteLLM links; T-SY6).
const PENDING_LINK_STALE_AFTER_MS = 30 * 86_400_000;
const READ_CONCURRENCY = 20;

export type AccessReviewFlag =
  | "ambiguous"
  | "overage"
  | "stale"
  | "entra-role-removed-with-grant"
  | "enabled-password-user";

export type AccessReviewRow = {
  oid: string;
  email: string;
  displayName: string;
  authMethod: IdentityRecord["authMethod"];
  lastSignInAt: string;
  roles: { role: string; source: "sso" | "ui" }[];
  team: { teamId: string; source: "sso" | "ui" } | null;
  adminScopes: {
    scopeType: "team" | "department";
    scopeId: string;
    source: "sso" | "ui";
  }[];
  aliases: string[];
  litellmUserId?: string;
  flags: AccessReviewFlag[];
};

async function queryAll(
  input: Omit<ConstructorParameters<typeof QueryCommand>[0], "TableName">,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        ...input,
        TableName: getTableName(),
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function listIdentityOids(): Promise<string[]> {
  const items = await queryAll({
    IndexName: GSI1_NAME,
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": IDENTS_GSI1PK },
  });
  return items.map((item) => String(item.oid));
}

async function listEnabledPasswordOids(): Promise<Set<string>> {
  const items = await queryAll({
    IndexName: GSI1_NAME,
    KeyConditionExpression: "gsi1pk = :pk",
    FilterExpression: "#s = :enabled",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":pk": LOCALUSERS_GSI1PK,
      ":enabled": "enabled",
    },
  });
  return new Set(items.map((item) => String(item.oid)));
}

async function buildRow(
  oid: string,
  now: Date,
  enabledPasswordOids: ReadonlySet<string>,
): Promise<AccessReviewRow | null> {
  const items = await queryAll({
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": identPk(oid) },
  });
  const bySk = (prefix: string) =>
    items.filter((item) => String(item.SK).startsWith(prefix));

  const metaItem = items.find((item) => item.SK === "META");
  if (!metaItem) return null;
  const identity = IdentityRecordSchema.parse(metaItem);
  const grants = bySk("ROLEGRANT#").map((i) => RoleGrantSchema.parse(i));
  const affiliationItem = items.find((item) => item.SK === "AFFILIATION");
  const affiliation = affiliationItem
    ? MemberAffiliationSchema.parse(affiliationItem)
    : null;
  const adminScopes = bySk("ADMINSCOPE#").map((i) => AdminScopeSchema.parse(i));
  const linkItem = items.find((item) => item.SK === "LINK");
  const link = linkItem ? IdentityLinkSchema.parse(linkItem) : null;

  const flags: AccessReviewFlag[] = [];
  if (identity.ambiguousMembership === true) flags.push("ambiguous");
  if (identity.groupsOverage === true) flags.push("overage");
  if (now.getTime() - Date.parse(identity.lastSignInAt) > STALE_AFTER_MS) {
    flags.push("stale");
  }
  if (grants.some((g) => !identity.lastSeenRoles.includes(g.role))) {
    flags.push("entra-role-removed-with-grant");
  }
  if (enabledPasswordOids.has(oid)) flags.push("enabled-password-user");

  return {
    oid,
    email: identity.email ?? identity.upn ?? "",
    displayName: identity.displayName ?? "",
    authMethod: identity.authMethod,
    lastSignInAt: identity.lastSignInAt,
    roles: [
      ...identity.lastSeenRoles.map((role) => ({
        role,
        source: "sso" as const,
      })),
      ...grants.map((g) => ({ role: g.role, source: "ui" as const })),
    ],
    team: affiliation
      ? { teamId: affiliation.teamId, source: affiliation.source }
      : null,
    adminScopes: adminScopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
      source: s.source,
    })),
    aliases: link?.aliases ?? [],
    ...(link?.litellmUserId ? { litellmUserId: link.litellmUserId } : {}),
    flags,
  };
}

export type PendingLiteLLMLinkReviewRow = {
  key: string;
  litellmUserId: string;
  createdAt: string;
  flags: "stale"[];
};

export async function listPendingLiteLLMLinkRows(
  now: Date,
): Promise<PendingLiteLLMLinkReviewRow[]> {
  return (await listPendingLiteLLMLinks()).map((p) => ({
    key: p.emailOrOid,
    litellmUserId: p.litellmUserId,
    createdAt: p.createdAt,
    flags:
      now.getTime() - Date.parse(p.createdAt) > PENDING_LINK_STALE_AFTER_MS
        ? ["stale"]
        : [],
  }));
}

export async function listAccessReviewRows(
  now: Date,
): Promise<AccessReviewRow[]> {
  const [oids, enabledPasswordOids] = await Promise.all([
    listIdentityOids(),
    listEnabledPasswordOids(),
  ]);
  const rows: AccessReviewRow[] = [];
  for (let i = 0; i < oids.length; i += READ_CONCURRENCY) {
    const batch = await Promise.all(
      oids
        .slice(i, i + READ_CONCURRENCY)
        .map((oid) => buildRow(oid, now, enabledPasswordOids)),
    );
    for (const row of batch) if (row) rows.push(row);
  }
  return rows;
}

// The export is audited (spec - Access review): one record per export, after
// the rows were read.
export async function exportAccessReview(ctx: AuditContext): Promise<{
  date: string;
  rows: AccessReviewRow[];
  pendingLiteLLMLinks: PendingLiteLLMLinkReviewRow[];
}> {
  const [rows, pendingLiteLLMLinks] = await Promise.all([
    listAccessReviewRows(ctx.now),
    listPendingLiteLLMLinkRows(ctx.now),
  ]);
  const date = ctx.now.toISOString().slice(0, 10);
  await recordAuditedRead(
    {
      action: "accessreview.export",
      target: { type: "accessreview", id: date },
    },
    ctx,
  );
  return { date, rows, pendingLiteLLMLinks };
}
