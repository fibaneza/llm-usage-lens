import "server-only";

import { BedrockGatewayConfigSchema } from "@llm-usage-lens/shared";
import type { BedrockGatewayConfig } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import { getAccountMeta } from "../account-meta";
import type { AccessResult, AuditContext } from "../access/result";
import { commitAudited, getItem } from "../access/store";

import { LITELLM_CONFIG_PK, LITELLM_GATEWAY_SK } from "./keys";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6) -> Gateway configuration" (GatewayConfig at LITELLM#CONFIG / GATEWAY,
// versioned; every account id must exist in AccountMeta; one audit record
// litellm.gateway.update in the same transaction) and "Read per request,
// never cached" (LT33; Rule 60.10): no cache wraps this read.

export async function getBedrockGateway(): Promise<BedrockGatewayConfig | null> {
  const item = await getItem(LITELLM_CONFIG_PK, LITELLM_GATEWAY_SK);
  if (!item) return null;
  return BedrockGatewayConfigSchema.parse({
    principals: item.principals,
    accountIds: item.accountIds,
    version: item.version,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  });
}

// Audit snapshots hold string lists only.
const snapshot = (config: BedrockGatewayConfig) => ({
  version: config.version,
  principals: config.principals.map((p) => `${p.type}:${p.value}`),
  accountIds: [...config.accountIds],
});

// `version: null` creates the item; otherwise it must equal the stored one.
export async function putBedrockGateway(
  input: {
    version: number | null;
    principals: BedrockGatewayConfig["principals"];
    accountIds: BedrockGatewayConfig["accountIds"];
  },
  ctx: AuditContext,
): Promise<AccessResult<BedrockGatewayConfig>> {
  const current = await getBedrockGateway();
  if ((current?.version ?? null) !== input.version) {
    return { ok: false, code: "CONFLICT" };
  }
  const accounts = await Promise.all(input.accountIds.map(getAccountMeta));
  if (accounts.some((a) => a === null)) return { ok: false, code: "NOT_FOUND" };

  const value = BedrockGatewayConfigSchema.parse({
    principals: input.principals,
    accountIds: input.accountIds,
    version: (current?.version ?? 0) + 1,
    updatedAt: ctx.now.toISOString(),
    updatedBy: ctx.actor,
  });
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: { PK: LITELLM_CONFIG_PK, SK: LITELLM_GATEWAY_SK, ...value },
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
      action: "litellm.gateway.update",
      target: { type: "litellm-gateway", id: "default" },
      ...(current ? { before: snapshot(current) } : {}),
      after: snapshot(value),
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}
