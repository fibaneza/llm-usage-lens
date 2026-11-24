import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GSI1_NAME, PendingLiteLLMLinkSchema } from "@llm-usage-lens/shared";
import type { PendingLiteLLMLink } from "@llm-usage-lens/shared";
import { z } from "zod";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import {
  OWNER_SK,
  PENDINGLITELLMLINKS_GSI1PK,
  PENDING_LITELLMLINK_SK,
  litellmUserPk,
  pendingPk,
} from "./keys";
import { queryPage } from "./paging";
import type { AccessResult, AuditContext, ListOptions, Page } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md - "Data model additions"
// (PendingLiteLLMLink and its claim naming the pending key as owner) and
// "LiteLLM user sync" - Pending LiteLLM links, Records (one set or remove
// record per change, carrying the run's runId; T-SY1, T-SY6, T-SY10). The
// item, its claim and the audit record commit in one transaction. Stores no
// Entra id (S20).

const itemFrom = (raw: Record<string, unknown>): PendingLiteLLMLink =>
  PendingLiteLLMLinkSchema.parse({
    emailOrOid: raw.emailOrOid,
    litellmUserId: raw.litellmUserId,
    source: raw.source,
    version: raw.version,
    createdAt: raw.createdAt,
    createdBy: raw.createdBy,
    lastValidatedAt: raw.lastValidatedAt,
  });

export async function createPendingLiteLLMLink(
  input: { emailOrOid: string; litellmUserId: string; runId: string },
  ctx: AuditContext,
): Promise<AccessResult<PendingLiteLLMLink>> {
  const key = input.emailOrOid.toLowerCase();
  const now = ctx.now.toISOString();
  const value: PendingLiteLLMLink = {
    emailOrOid: key,
    litellmUserId: input.litellmUserId,
    source: "sync",
    version: 1,
    createdAt: now,
    createdBy: ctx.actor,
    lastValidatedAt: now,
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: pendingPk(key),
            SK: PENDING_LITELLMLINK_SK,
            gsi1pk: PENDINGLITELLMLINKS_GSI1PK,
            gsi1sk: pendingPk(key),
            ...value,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: litellmUserPk(input.litellmUserId),
            SK: OWNER_SK,
            litellmUserId: input.litellmUserId,
            oid: key,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "identity.litellm-pending.set",
      target: { type: "pending-litellm-link", id: key },
      after: { runId: input.runId, litellmUserId: input.litellmUserId },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

export async function getPendingLiteLLMLink(
  emailOrOid: string,
): Promise<PendingLiteLLMLink | null> {
  const raw = await getItem(pendingPk(emailOrOid), PENDING_LITELLMLINK_SK);
  return raw ? itemFrom(raw) : null;
}

export async function listPendingLiteLLMLinks(): Promise<PendingLiteLLMLink[]> {
  const found: PendingLiteLLMLink[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": PENDINGLITELLMLINKS_GSI1PK },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) found.push(itemFrom(item));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return found;
}

// One page of the Not signed in yet panel (Access Control - API routes
// (additions): 25 rows a page, opaque cursor).
const PendingLinkItemSchema = z.object(PendingLiteLLMLinkSchema.shape);

export function listPendingLiteLLMLinksPage(
  options: ListOptions,
): Promise<AccessResult<Page<PendingLiteLLMLink>>> {
  return queryPage({
    schema: PendingLinkItemSchema,
    options,
    partition: PENDINGLITELLMLINKS_GSI1PK,
    index: "GSI1",
  });
}

export async function removePendingLiteLLMLink(
  input: {
    emailOrOid: string;
    version: number;
    runId: string;
    // The claim already belongs to an identity (the same LiteLLM user is
    // linked): only the placeholder goes (Access Control - LiteLLM user
    // sync, SM5).
    keepClaim?: boolean;
  },
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const key = input.emailOrOid.toLowerCase();
  const raw = await getItem(pendingPk(key), PENDING_LITELLMLINK_SK);
  if (!raw) return { ok: false, code: "NOT_FOUND" };
  const current = itemFrom(raw);
  if (current.version !== input.version) return { ok: false, code: "CONFLICT" };
  const result = await commitAudited({
    items: [
      {
        Delete: {
          TableName: getTableName(),
          Key: { PK: pendingPk(key), SK: PENDING_LITELLMLINK_SK },
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":v": input.version },
        },
      },
      ...(input.keepClaim
        ? []
        : [
            {
              Delete: {
                TableName: getTableName(),
                Key: {
                  PK: litellmUserPk(current.litellmUserId),
                  SK: OWNER_SK,
                },
                ConditionExpression: "attribute_not_exists(PK) OR #oid = :oid",
                ExpressionAttributeNames: { "#oid": "oid" },
                ExpressionAttributeValues: { ":oid": key },
              },
            },
          ]),
    ],
    audit: {
      action: "identity.litellm-pending.remove",
      target: { type: "pending-litellm-link", id: key },
      before: {
        litellmUserId: current.litellmUserId,
        version: current.version,
      },
      after: { runId: input.runId },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}
