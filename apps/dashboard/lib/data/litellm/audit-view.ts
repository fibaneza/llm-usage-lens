import "server-only";

import { randomUUID } from "node:crypto";

import { auditCategory } from "@llm-usage-lens/shared";
import type { AuditRecord } from "@llm-usage-lens/shared";

import { appendAuditRecord } from "../access/audit";
import { deliverAuditLine } from "../access/audit-delivery";

// Source: docs/specs/2026-11-10-litellm.md — "Audit" item 3 (viewing the
// LiteLLM audit view is audited as `litellm.audit.view`, as audit-log views
// are; LD15) and Access Control — "Audit log". Written only after a
// successful read, never with the viewed contents.
export async function recordLiteLLMAuditView(actor: string): Promise<void> {
  const record: AuditRecord = {
    actor,
    action: "litellm.audit.view",
    category: auditCategory("litellm.audit.view", "success"),
    result: "success",
    timestamp: new Date().toISOString(),
    requestId: randomUUID(),
    target: { type: "litellm-audit", id: "proxy" },
  };
  await appendAuditRecord(record);
  await deliverAuditLine(record);
}
