import "server-only";

import type { AuditRecord } from "@llm-usage-lens/shared";

import { appendAuditRecord } from "./audit";
import { deliverAuditLine } from "./audit-delivery";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" D18: each
// successful sign-in and explicit sign-out is a change record carrying the
// method and no claims. Entra sign-ins are written inside the sign-in sync
// transaction; this serves the other methods and sign-out. A persistence
// failure rejects so the caller can fail the sign-in.
export type SessionMethod = "entra" | "master" | "password" | "local";

type SessionAuditInput = {
  oid: string;
  method: SessionMethod;
  requestId: string;
  now: Date;
};

async function record(
  action: "auth.signin.success" | "auth.signout",
  input: SessionAuditInput,
): Promise<void> {
  const entry: AuditRecord = {
    actor: input.oid,
    action,
    category: "change",
    result: "success",
    target: { type: "identity", id: input.oid },
    after: { method: input.method },
    timestamp: input.now.toISOString(),
    requestId: input.requestId,
  };
  await appendAuditRecord(entry);
  await deliverAuditLine(entry);
}

export const recordSignIn = (input: SessionAuditInput): Promise<void> =>
  record("auth.signin.success", input);

export const recordSignOut = (input: SessionAuditInput): Promise<void> =>
  record("auth.signout", input);
