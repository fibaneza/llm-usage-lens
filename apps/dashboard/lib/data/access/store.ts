import "server-only";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { auditCategory } from "@llm-usage-lens/shared";
import type {
  AuditAction,
  AuditRecord,
  AuditSnapshot,
} from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { appendAuditRecord, auditPutItem } from "./audit";
import { deliverAuditLine } from "./audit-delivery";
import type { TransactItem } from "./audit";
import type { AccessErrorCode, AuditContext } from "./result";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" semantics and
// "Storage boundary (D26.2)"; contract R2 decisions 2-3. A success commits its
// audit item in the same transaction; a conditional failure maps to the code
// planned for that item and writes no record; any other error writes one
// separate `failed` record and rethrows.

export async function getItem(
  PK: string,
  SK: string,
): Promise<Record<string, unknown> | null> {
  const res = await getDocumentClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK, SK } }),
  );
  return res.Item ?? null;
}

export type AuditSpec = {
  action: AuditAction;
  target?: { type: string; id: string };
  teamId?: string;
  before?: AuditSnapshot;
  after?: AuditSnapshot;
};

function buildRecord(
  spec: AuditSpec,
  ctx: AuditContext,
  result: "success" | "failed",
): AuditRecord {
  return {
    actor: ctx.actor,
    action: spec.action,
    category: auditCategory(spec.action, result),
    result,
    timestamp: ctx.now.toISOString(),
    requestId: ctx.requestId,
    ...(spec.target ? { target: spec.target } : {}),
    ...(spec.teamId ? { teamId: spec.teamId } : {}),
    ...(spec.before ? { before: spec.before } : {}),
    ...(spec.after ? { after: spec.after } : {}),
  };
}

export type CommitResult = { ok: true } | { ok: false; code: AccessErrorCode };

// `conflictCodes` maps a failed condition at an item index to its error code;
// unlisted indexes default to CONFLICT.
export async function commitAudited(args: {
  items: TransactItem[];
  audit: AuditSpec;
  ctx: AuditContext;
  conflictCodes?: Partial<Record<number, AccessErrorCode>>;
}): Promise<CommitResult> {
  const { items, audit, ctx, conflictCodes = {} } = args;
  try {
    const record = buildRecord(audit, ctx, "success");
    await getDocumentClient().send(
      new TransactWriteCommand({
        TransactItems: [...items, auditPutItem(record, ctx.sequence.next)],
      }),
    );
    ctx.sequence.next += 1;
    await deliverAuditLine(record);
    return { ok: true };
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      const reasons = error.CancellationReasons ?? [];
      if (reasons.some((r) => r.Code === "TransactionConflict")) {
        return { ok: false, code: "CONFLICT" };
      }
      const index = reasons.findIndex(
        (r) => r.Code === "ConditionalCheckFailed",
      );
      if (index >= 0 && index < items.length) {
        return { ok: false, code: conflictCodes[index] ?? "CONFLICT" };
      }
    }
    try {
      const failed = buildRecord(audit, ctx, "failed");
      await appendAuditRecord(failed, ctx.sequence.next);
      ctx.sequence.next += 1;
      await deliverAuditLine(failed);
    } catch (auditError) {
      throw new AggregateError(
        [error, auditError],
        "write failed and its failed audit record could not be stored",
      );
    }
    throw error;
  }
}

// A read that is itself audited (spec - Audit log: audit-log views and
// access-review exports). Written after the read succeeds; a failed write
// throws, so an unaudited view is never served.
export async function recordAuditedRead(
  audit: AuditSpec,
  ctx: AuditContext,
): Promise<void> {
  const record = buildRecord(audit, ctx, "success");
  await appendAuditRecord(record, ctx.sequence.next);
  ctx.sequence.next += 1;
  await deliverAuditLine(record);
}
