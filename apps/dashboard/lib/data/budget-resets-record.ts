import "server-only";

import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { AuditRecord, BudgetReset } from "@llm-usage-lens/shared";

import { getDocumentClient } from "@/lib/dynamodb";

import { auditPutItem } from "./access/audit";
import { deliverAuditLine } from "./access/audit-delivery";
import { budgetResetPutItem } from "./budget-resets";

// Source: docs/specs/2026-11-10-litellm.md - MG-D8: the ledger item of a
// direct reset is written after LiteLLM confirmed, in the same
// transaction as the audit record. A failed write throws (Rule 60.17).
export async function recordMemberReset(
  reset: BudgetReset,
  record: AuditRecord,
): Promise<void> {
  await getDocumentClient().send(
    new TransactWriteCommand({
      TransactItems: [budgetResetPutItem(reset), auditPutItem(record, 0)],
    }),
  );
  await deliverAuditLine(record);
}
