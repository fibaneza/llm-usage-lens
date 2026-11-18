import "server-only";

import type { AccountMeta, BudgetResetRequest } from "@llm-usage-lens/shared";
import { z } from "zod";

import type { MatrixArgs } from "@/lib/api/matrix-route";
import { notFoundResponse } from "@/lib/api/matrix-route";
import { jsonError, parseInput, recordDeniedWrite } from "@/lib/api/respond";
import { getAllAccounts } from "@/lib/data/account-meta";
import { getBudgetResetRequest } from "@/lib/data/budget-reset-requests";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "Budget reset requests" flow
// step 3 (MG-D12); Access Control BR1, BR2, BR4. The shared first half of
// approve and deny: every check re-reads uncached data at the decision.

export type Decidable = { request: BudgetResetRequest; meta: AccountMeta };

export async function loadDecidable(
  { request, params, session, actor, refuse }: MatrixArgs,
  denied: {
    action: "budgetreset.request.approve" | "budgetreset.request.deny";
    pattern: string;
  },
): Promise<Decidable | Response> {
  const refused = openModeRefusal();
  if (refused) return refused;

  const id = parseInput(params.id, z.uuid());
  const found = await getBudgetResetRequest(id);
  if (!found) return notFoundResponse();

  const meta = (await getAllAccounts()).find((a) => a.teamId === found.teamId);
  const scopeRefusal = await refuse({
    operation: "member",
    team: meta
      ? { teamId: meta.teamId, departmentId: meta.departmentId }
      : null,
  });
  if (scopeRefusal) return scopeRefusal;
  if (!meta) return notFoundResponse();

  if (actor.oid === found.requesterOid) {
    await recordDeniedWrite(request, session.user.oid, denied);
    return jsonError(403, "FORBIDDEN", "You cannot decide your own request");
  }
  if (found.status !== "open") {
    return jsonError(409, "CONFLICT", "The request has already been decided");
  }
  return { request: found, meta };
}
