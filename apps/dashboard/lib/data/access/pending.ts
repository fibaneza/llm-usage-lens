import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { PendingItemSchema } from "@llm-usage-lens/shared";
import type { PendingItem } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import {
  AFFILIATION_SK,
  adminScopeSk,
  adminsGsi1pk,
  membersGsi1pk,
  pendingPk,
} from "./keys";
import type { AccessResult, AuditContext } from "./result";
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
        found.push(PendingItemSchema.parse(item));
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
  }
  return found;
}
