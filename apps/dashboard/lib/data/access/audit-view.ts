import "server-only";

import { AuditRecordSchema } from "@llm-usage-lens/shared";
import type { AuditRecord } from "@llm-usage-lens/shared";

import { auditPk } from "./keys";
import { queryPage } from "./paging";
import type { AccessResult, AuditContext, ListOptions, Page } from "./result";
import { recordAuditedRead } from "./store";

// Source: docs/specs/2026-11-10-access-control.md - "Audit log" (views are
// themselves audited; never secrets), "Data model additions" (audit by UTC
// day). One page of a day's records, oldest first. AuditRecordSchema drops the
// storage keys and any stray attribute. The view record is written only after
// a successful read, so a bad cursor audits nothing.
export async function viewAuditDay(
  utcDay: string,
  options: ListOptions,
  ctx: AuditContext,
): Promise<AccessResult<Page<AuditRecord>>> {
  const result = await queryPage({
    schema: AuditRecordSchema,
    options,
    partition: auditPk(utcDay),
  });
  if (!result.ok) return result;
  await recordAuditedRead(
    { action: "audit.view", target: { type: "audit", id: utcDay } },
    ctx,
  );
  return result;
}
