import "server-only";

import { IdentityMapRulesSchema } from "@llm-usage-lens/shared";
import type { IdentityMapRule, IdentityMapRules } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import { GOVERNANCE_PK } from "./keys";
import type { AccessResult, AuditContext } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": one versioned GOVERNANCE item, replaced whole on each write.
// A missing item means "no rules yet". Authorization data: never cached.
export const IDENTITY_MAP_RULES_SK = "IDENTITY_MAP_RULES";

export async function getIdentityMapRules(): Promise<IdentityMapRules | null> {
  const item = await getItem(GOVERNANCE_PK, IDENTITY_MAP_RULES_SK);
  return item ? IdentityMapRulesSchema.parse(item) : null;
}

const describeRules = (rules: readonly IdentityMapRule[]): string[] =>
  rules.map((r) => `${r.pattern} -> ${r.template}`);

// `version` is the stored version (0 when nothing is recorded); the condition
// sits in the audited transaction so exactly one concurrent writer wins.
export async function setIdentityMapRules(
  input: { rules: IdentityMapRule[]; version: number },
  ctx: AuditContext,
): Promise<AccessResult<IdentityMapRules>> {
  const previous = input.version === 0 ? null : await getIdentityMapRules();
  const value: IdentityMapRules = {
    rules: input.rules,
    version: input.version + 1,
    updatedAt: ctx.now.toISOString(),
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: { PK: GOVERNANCE_PK, SK: IDENTITY_MAP_RULES_SK, ...value },
          ...(input.version === 0
            ? { ConditionExpression: "attribute_not_exists(PK)" }
            : {
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": input.version },
              }),
        },
      },
    ],
    audit: {
      action: "identity.map.update",
      target: { type: "governance", id: IDENTITY_MAP_RULES_SK },
      before: {
        rules: describeRules(previous?.rules ?? []),
        version: input.version,
      },
      after: { rules: describeRules(value.rules), version: value.version },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}
