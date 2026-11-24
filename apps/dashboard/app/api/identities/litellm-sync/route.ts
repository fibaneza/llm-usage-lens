import {
  LiteLLMSyncBodySchema,
  LiteLLMSyncPlanResponseSchema,
  LiteLLMSyncResultSchema,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { LiteLLMError, isLiteLLMConfigured } from "@/lib/litellm/client";
import {
  enabledOperations,
  liteLLMResponse,
  requireEnabled,
} from "@/lib/litellm/read-views";
import {
  openModeRefusal,
  permitAdminOrOrgAdmin,
} from "@/lib/litellm/route-guard";
import { runLiteLLMUserSync } from "@/lib/litellm-user-sync/run";
import type { SyncPlan } from "@/lib/litellm-user-sync/run";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync"
// (Preview and apply: `409 PLAN_CHANGED`, `PLAN_TRUNCATED`, `SYNC_RUNNING`;
// Records), "API routes (additions)" (`/api/identities/litellm-sync`),
// "Permission matrix" (`internal-admin`, `internal-org-admin`; `403` before
// parsing with one `denied` record), LiteLLM spec LD37 (not configured: `200`
// `configured: false` on the preview, the gateway's `503` on apply) and the
// `syncLiteLLMUsers` toggle (`OPERATION_DISABLED` when off, checked for manual
// runs here). The sync only reads LiteLLM (T-SY11). Order: permission, toggle,
// configured, then the body.

export const dynamic = "force-dynamic";

const PATH = "/api/identities/litellm-sync";

// The plan the domain built, as the strict shared view: a removal is a user
// row, a membership drops the person's key, and `sso_user_id` is never here.
function planView(plan: SyncPlan) {
  const users = [
    ...plan.users.map((row) => {
      const base = {
        litellmUserId: row.litellmUserId,
        email: row.email || row.litellmUserId,
      };
      switch (row.outcome) {
        case "link-existing":
          return {
            ...base,
            outcome: row.outcome,
            oid: row.oid,
            matchedKey: row.matchedKey,
          };
        case "skip":
          return { ...base, outcome: row.outcome, reason: row.reason };
        default:
          return { ...base, outcome: row.outcome };
      }
    }),
    ...plan.removals.map((row) => ({
      litellmUserId: row.litellmUserId,
      email: row.key.includes("@") ? row.key : row.litellmUserId,
      outcome: row.outcome,
      ...(row.reason ? { reason: row.reason } : {}),
    })),
  ];
  return {
    configured: true as const,
    users,
    memberships: plan.memberships.map((m) => ({
      litellmUserId: m.litellmUserId,
      teamId: m.teamId,
      outcome: m.outcome,
      ...(m.reason ? { reason: m.reason } : {}),
    })),
    drift: plan.drift,
    notPlaced: plan.notPlaced,
    counts: plan.counts,
    truncated: plan.truncated,
    planHash: plan.planHash,
  };
}

const CONFLICT_MESSAGES = {
  PLAN_CHANGED: "The plan changed since the preview; review it again",
  PLAN_TRUNCATED: "The user list is too long to sync on demand",
  SYNC_RUNNING: "A sync is already running",
} as const;

export const GET = withRoute(
  async (request, _ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    return liteLLMResponse(async () => {
      requireEnabled(await enabledOperations(), ["syncLiteLLMUsers"]);
      if (!(await isLiteLLMConfigured())) {
        return jsonData(
          LiteLLMSyncPlanResponseSchema.parse({ configured: false }),
        );
      }
      const result = await runLiteLLMUserSync({
        actor: session.user.oid,
        trigger: "manual",
        mode: "preview",
      });
      if (!result.ok || !result.value.plan) {
        throw new Error("The sync preview returned no plan");
      }
      return jsonData(
        LiteLLMSyncPlanResponseSchema.parse(planView(result.value.plan)),
      );
    });
  },
  { permit: permitAdminOrOrgAdmin },
);

export const POST = withRoute(
  async (request, _ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    return liteLLMResponse(async () => {
      requireEnabled(await enabledOperations(), ["syncLiteLLMUsers"]);
      // A body that is not JSON is 400 first (Rule 10.3); then the gateway's
      // not-configured error (LD37); then the body's shape.
      await parseJsonBody(request.clone(), z.unknown());
      if (!(await isLiteLLMConfigured())) {
        throw new LiteLLMError("not_configured");
      }
      const body = await parseJsonBody(request, LiteLLMSyncBodySchema);
      const result = await runLiteLLMUserSync({
        actor: session.user.oid,
        trigger: "manual",
        mode: "apply",
        planHash: body.planHash,
      });
      if (!result.ok) {
        return jsonError(409, result.code, CONFLICT_MESSAGES[result.code]);
      }
      const { runId, results, remaining, unplaced } = result.value;
      if (!runId || !results || remaining === undefined) {
        throw new Error("The sync apply returned no result");
      }
      return jsonData(
        LiteLLMSyncResultSchema.parse({
          runId,
          results: { ...results, notPlaced: unplaced ?? [] },
          remaining,
        }),
      );
    });
  },
  {
    permit: permitAdminOrOrgAdmin,
    denied: { action: "litellm.user.sync", pattern: PATH },
  },
);
