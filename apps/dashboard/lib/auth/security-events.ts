import { randomUUID } from "node:crypto";

import { trace } from "@opentelemetry/api";
import type { AuditRecord } from "@llm-usage-lens/shared";

// Source: docs/specs/2026-11-10-access-control.md — "Threat model" T20,
// "Audit log" (security events are security records; the actor is the oid or
// `system`; the request id is generated on the server). Id-only event: never
// the username, password, code or hash (Rule 50.6).
export type SecurityEvent = {
  action:
    | "auth.master.signin"
    | "auth.master.failure"
    | "auth.master.lockout"
    | "auth.signin.error";
  result: "success" | "failed";
  oid?: string;
  at: string;
};

function emitTelemetry(event: SecurityEvent): void {
  const attributes = {
    action: event.action,
    result: event.result,
    at: event.at,
    ...(event.oid ? { oid: event.oid } : {}),
  };
  const name = `security.${event.action}`;
  const active = trace.getActiveSpan();
  if (active) {
    active.addEvent(name, attributes);
    return;
  }
  const span = trace.getTracer("llm-usage-lens-auth").startSpan(name);
  span.addEvent(name, attributes);
  span.end();
}

// A master sign-in whose record cannot be stored rejects, so that sign-in
// fails; other events record the exception and continue (T20).
export async function recordSecurityEvent(
  event: SecurityEvent & { requestId?: string },
): Promise<void> {
  emitTelemetry(event);
  const record: AuditRecord = {
    actor: event.oid ?? "system",
    action: event.action,
    category: "security",
    result: event.result,
    target: { type: "identity", id: event.oid ?? "unknown" },
    timestamp: event.at,
    requestId: event.requestId ?? randomUUID(),
  };
  // Loaded on demand: the data layer is server-only and pulls the AWS SDK.
  const { appendAuditRecord } = await import("@/lib/data/access/audit");
  const { deliverAuditLine } = await import("@/lib/data/access/audit-delivery");
  let failure: unknown;
  try {
    await appendAuditRecord(record);
  } catch (error) {
    failure = error;
  }
  await deliverAuditLine(record);
  if (failure === undefined) return;
  if (event.action === "auth.master.signin") throw failure;
  trace
    .getActiveSpan()
    ?.recordException(
      failure instanceof Error ? failure : new Error("audit write failed"),
    );
}
