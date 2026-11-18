import "server-only";

import { BudgetResetSchema } from "@llm-usage-lens/shared";
import type { BudgetReset } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import type { TransactItem } from "./access/audit";
import { bResetPk, bResetSk, bResetsGsi1pk } from "./budget-resets-keys";

// Source: docs/specs/2026-05-15-data-model.md — "Budget reset entities (unit
// M4)", BudgetReset (MG-D8): append-only, written after LiteLLM confirmed, in
// the same transaction as the audit record; no update, no delete except TTL.
const RETENTION_SECONDS = 400 * 86_400;

export function budgetResetPutItem(reset: BudgetReset): TransactItem {
  const value = BudgetResetSchema.parse(reset);
  const sk = bResetSk(value.timestamp, value.resetId);
  return {
    Put: {
      TableName: getTableName(),
      Item: {
        PK: bResetPk(value.teamId),
        SK: sk,
        gsi1pk: bResetsGsi1pk(value.oid),
        gsi1sk: sk,
        ...value,
        expiresAt:
          Math.floor(Date.parse(value.timestamp) / 1000) + RETENTION_SECONDS,
      },
      ConditionExpression: "attribute_not_exists(SK)",
    },
  };
}
