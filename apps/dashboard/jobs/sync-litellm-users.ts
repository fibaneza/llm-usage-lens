import "server-only";

import { releaseUserSyncLease } from "@/lib/data/litellm/user-sync-lock";
import { currentRunId, runLiteLLMUserSync } from "@/lib/litellm-user-sync/run";
import { writeSyncSummary } from "@/lib/litellm-user-sync/summary";

// Source: docs/specs/2026-11-10-platform.md - "Scheduled job - LiteLLM user
// sync (unit SYNC2)": one call to the one function, a failure exits non-zero,
// the deadline and SIGTERM release the lease, the last success line is one
// fixed structured line with the counts (the missing-run alarm reads
// `event`). Access Control - *LiteLLM user sync*, *Records* (no email).
const DEADLINE_MS = 10 * 60_000;
const FAILURE = 1;

const line = (fields: Record<string, unknown>): string =>
  `${JSON.stringify(fields)}\n`;

// The AWS error code only when it is a string; never the message.
function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

// The run was cut short (deadline or SIGTERM): release the lease only if this
// process holds it, and leave a summary so the stop is never silent.
async function stopHeldRun(reason: "deadline" | "sigterm"): Promise<void> {
  const runId = currentRunId();
  process.stderr.write(
    line({
      event: "litellm_user_sync.stopped",
      reason,
      held: runId !== undefined,
    }),
  );
  if (runId === undefined) return;
  try {
    await releaseUserSyncLease(runId);
    await writeSyncSummary(
      {
        actor: "system",
        requestId: runId,
        now: new Date(),
        sequence: { next: 0 },
      },
      runId,
      "schedule",
      { skipped: "lost-lease" },
    );
  } catch (error) {
    process.stderr.write(
      line({
        event: "litellm_user_sync.stop_failed",
        error: error instanceof Error ? error.name : "unknown",
        code: errorCode(error),
      }),
    );
  }
}

export async function runSyncJob(): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onTerm: (() => void) | undefined;
  const stopped = new Promise<"deadline" | "sigterm">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), DEADLINE_MS);
    onTerm = () => resolve("sigterm");
    process.once("SIGTERM", onTerm);
  });
  try {
    const outcome = await Promise.race([
      runLiteLLMUserSync({
        actor: "system",
        trigger: "schedule",
        mode: "apply",
      }).then(
        (result) => ({ result }) as const,
        (error: unknown) => ({ error }) as const,
      ),
      stopped,
    ]);
    if (typeof outcome === "string") {
      await stopHeldRun(outcome);
      return FAILURE;
    }
    if ("error" in outcome) {
      process.stderr.write(
        line({
          event: "litellm_user_sync.failed",
          error:
            outcome.error instanceof Error ? outcome.error.name : "unknown",
        }),
      );
      return FAILURE;
    }
    const { result } = outcome;
    if (!result.ok) {
      process.stderr.write(
        line({ event: "litellm_user_sync.failed", code: result.code }),
      );
      return FAILURE;
    }
    const value = result.value;
    process.stdout.write(
      line({
        event: "litellm_user_sync.completed",
        runId: value.runId,
        ...(value.skipped ? { skipped: value.skipped } : {}),
        applied: value.applied ?? 0,
        remaining: value.remaining ?? 0,
        toLink: value.plan?.counts.toLink ?? 0,
        toPend: value.plan?.counts.toPend ?? 0,
        memberships: value.plan?.counts.memberships ?? 0,
        skippedUsers: value.plan?.counts.skipped ?? 0,
      }),
    );
    return 0;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onTerm) process.off("SIGTERM", onTerm);
  }
}

// Runs only as the bundle's entry (`node sync-litellm-users.cjs`), never when
// imported by a test.
if (typeof require !== "undefined" && require.main === module) {
  void runSyncJob().then((code) => process.exit(code));
}
