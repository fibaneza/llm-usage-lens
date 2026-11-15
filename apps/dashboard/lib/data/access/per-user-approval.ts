import "server-only";

import { PerUserApprovalSchema } from "@llm-usage-lens/shared";
import type { PerUserApproval } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import { GOVERNANCE_PK } from "./keys";
import type { AccessResult, AuditContext } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (organisation cap) and "Data model additions" (PerUserApproval,
// GOVERNANCE/PER_USER). A missing item means "not approved", not an error.
export const PER_USER_SK = "PER_USER";

export async function getPerUserApproval(): Promise<PerUserApproval | null> {
  const item = await getItem(GOVERNANCE_PK, PER_USER_SK);
  return item ? PerUserApprovalSchema.parse(item) : null;
}

// `version` is the stored version (0 when nothing is recorded); the condition
// sits in the audited transaction so exactly one concurrent writer wins.
// Withdrawal is not defined by the spec, so there is none.
export async function setPerUserApproval(
  input: { reference: string; version: number },
  ctx: AuditContext,
): Promise<AccessResult<PerUserApproval>> {
  const value: PerUserApproval = {
    approvedBy: ctx.actor,
    approvedAt: ctx.now.toISOString(),
    reference: input.reference,
    version: input.version + 1,
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: { PK: GOVERNANCE_PK, SK: PER_USER_SK, ...value },
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
      action: "governance.approval.update",
      target: { type: "governance", id: PER_USER_SK },
      before: { version: input.version },
      after: { version: value.version },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}
