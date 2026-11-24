import "server-only";

import { recordAuditedRead } from "@/lib/data/access/store";
import type { AuditContext } from "@/lib/data/access/result";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync",
// *Records*: the one `litellm.user.sync` summary. Shared by the run and by the
// job when it stops a run that held the lease.
export type SyncSummaryTrigger = "manual" | "schedule";

export async function writeSyncSummary(
  ctx: AuditContext,
  runId: string,
  trigger: SyncSummaryTrigger,
  fields: {
    truncated?: boolean;
    planHash?: string;
    skipped?: "disabled" | "locked" | "lost-lease";
    counts?: string[];
  },
): Promise<void> {
  await recordAuditedRead(
    {
      action: "litellm.user.sync",
      target: { type: "litellm-sync", id: runId },
      after: {
        runId,
        trigger,
        ...(fields.truncated !== undefined
          ? { truncated: fields.truncated }
          : {}),
        ...(fields.planHash ? { planHash: fields.planHash } : {}),
        ...(fields.skipped ? { skipped: fields.skipped } : {}),
        ...(fields.counts ? { counts: fields.counts } : {}),
      },
    },
    ctx,
  );
}
