import "server-only";

import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import {
  AuditItemSchema,
  AuditRecordSchema,
  auditCategory,
  sanitizeAuditSnapshot,
} from "@llm-usage-lens/shared";
import type { AuditAction, AuditRecord } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { auditPk, auditSk } from "./keys";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" (schema,
// semantics, denied attempts D17, retention 400 days), threats T17, T18, T22;
// contract R2 decision 4 (SK `{timestamp}#{requestId}#{nn}`).

export type TransactItem = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

const RETENTION_SECONDS = 400 * 86_400;
const DENIED_WINDOW_MS = 60_000;
const DENIED_PRUNE_THRESHOLD = 1_000;

function toItem(record: AuditRecord, index: number) {
  const day = record.timestamp.slice(0, 10);
  return AuditItemSchema.parse({
    ...record,
    category: auditCategory(record.action, record.result),
    before: sanitizeAuditSnapshot(record.before),
    after: sanitizeAuditSnapshot(record.after),
    PK: auditPk(day),
    SK: auditSk(record.timestamp, record.requestId, index),
    expiresAt:
      Math.floor(Date.parse(record.timestamp) / 1000) + RETENTION_SECONDS,
  });
}

// Audit items are append-only: an index collision fails instead of overwriting.
const NOT_EXISTS = "attribute_not_exists(SK)";

export function auditPutItem(record: AuditRecord, index: number): TransactItem {
  return {
    Put: {
      TableName: getTableName(),
      Item: toItem(record, index),
      ConditionExpression: NOT_EXISTS,
    },
  };
}

export async function appendAuditRecord(
  record: AuditRecord,
  index = 0,
): Promise<void> {
  await getDocumentClient().send(
    new PutCommand({
      TableName: getTableName(),
      Item: toItem(record, index),
      ConditionExpression: NOT_EXISTS,
    }),
  );
}

export async function listAuditRecords(utcDay: string): Promise<AuditRecord[]> {
  const records: AuditRecord[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": auditPk(utcDay) },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      records.push(AuditRecordSchema.parse(item));
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return records;
}

export type DeniedAuditInput = {
  actor: string;
  action: AuditAction;
  requestId: string;
  code: "FORBIDDEN" | "NOT_FOUND" | "PRIVILEGED_TARGET";
  route?: { method: string; pattern: string };
  target?: { type: string; id: string };
  teamId?: string;
  now?: Date;
};

export type DeniedAuditOutcome =
  | { written: true }
  | { suppressed: true }
  | { written: false };

// Per-task suppression state (D17): one record per actor+action per minute.
const lastDenied = new Map<string, number>();
let suppressedCount = 0;

export function getDeniedSuppressedCount(): number {
  return suppressedCount;
}

export function resetDeniedAudit(): void {
  lastDenied.clear();
  suppressedCount = 0;
}

export async function appendDeniedAudit(
  input: DeniedAuditInput,
): Promise<DeniedAuditOutcome> {
  const now = input.now ?? new Date();
  const key = `${input.actor}\u0000${input.action}`;
  const last = lastDenied.get(key);
  if (last !== undefined && now.getTime() - last < DENIED_WINDOW_MS) {
    suppressedCount += 1;
    return { suppressed: true };
  }
  try {
    await appendAuditRecord({
      actor: input.actor,
      action: input.action,
      category: "security",
      result: "denied",
      timestamp: now.toISOString(),
      requestId: input.requestId,
      code: input.code,
      ...(input.route ? { route: input.route } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
    });
  } catch {
    // D17: a failed denied-record write never changes the response; the
    // caller counts it on the delivery metric from this outcome.
    return { written: false };
  }
  if (lastDenied.size >= DENIED_PRUNE_THRESHOLD) {
    for (const [k, t] of lastDenied) {
      if (now.getTime() - t >= DENIED_WINDOW_MS) lastDenied.delete(k);
    }
  }
  lastDenied.set(key, now.getTime());
  return { written: true };
}
