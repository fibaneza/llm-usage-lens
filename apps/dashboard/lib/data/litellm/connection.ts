import "server-only";

import { LiteLLMConnectionSchema } from "@llm-usage-lens/shared";
import type { LiteLLMConnection } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import type { AccessResult, AuditContext } from "../access/result";
import { commitAudited, getItem } from "../access/store";

import { LITELLM_CONFIG_PK, LITELLM_CONNECTION_SK } from "./keys";

// Source: docs/specs/2026-11-10-litellm.md — "Data model additions"
// (LiteLLMConnection at LITELLM#CONFIG / CONNECTION: base URL only, versioned;
// the service key is never stored) and "Security architecture" item 7
// (versioned, audited as litellm.connection.update in the same transaction).

export async function getLiteLLMConnection(): Promise<LiteLLMConnection | null> {
  const item = await getItem(LITELLM_CONFIG_PK, LITELLM_CONNECTION_SK);
  if (!item) return null;
  return LiteLLMConnectionSchema.parse({
    baseUrl: item.baseUrl,
    version: item.version,
    updatedAt: item.updatedAt,
  });
}

// `version: null` creates the connection; otherwise it must equal the stored
// version (a stale or racing write returns CONFLICT and writes no record).
export async function putLiteLLMConnection(
  input: { baseUrl: string; version: number | null },
  ctx: AuditContext,
): Promise<AccessResult<LiteLLMConnection>> {
  const current = await getLiteLLMConnection();
  if ((current?.version ?? null) !== input.version) {
    return { ok: false, code: "CONFLICT" };
  }
  const value = LiteLLMConnectionSchema.parse({
    baseUrl: input.baseUrl,
    version: (current?.version ?? 0) + 1,
    updatedAt: ctx.now.toISOString(),
  });
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: LITELLM_CONFIG_PK,
            SK: LITELLM_CONNECTION_SK,
            ...value,
          },
          ...(current
            ? {
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": current.version },
              }
            : { ConditionExpression: "attribute_not_exists(PK)" }),
        },
      },
    ],
    audit: {
      action: "litellm.connection.update",
      target: { type: "litellm-connection", id: "default" },
      ...(current ? { before: { baseUrl: current.baseUrl } } : {}),
      after: { baseUrl: value.baseUrl },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}
