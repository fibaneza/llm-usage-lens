import { memberWriteRoute, snapshot } from "@/lib/litellm/member-write";
import { resetMemberBudget } from "@/lib/litellm/operations";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (resetMemberBudget: Lead
// + Admin; the audit carries previous_budget_id and budget_id), "Budgets and
// limits" (exactly one member of one team).

export const dynamic = "force-dynamic";

export const POST = memberWriteRoute(
  {
    action: "litellm.member.reset-budget",
    pattern: "/api/litellm/teams/[teamId]/members/[oid]/reset-budget",
    toggle: "resetMemberBudget",
    status: 200,
    target: "existing",
    oidFrom: "path",
    ledger: "budget",
  },
  async ({ actor, litellmTeamId, oid, litellmUserId }) => {
    const { budgetId, previousBudgetId } = await resetMemberBudget(
      { litellmTeamId, litellmUserId },
      { actor },
    );
    return {
      data: { oid, litellmUserId, budgetId, previousBudgetId },
      before: snapshot({ litellmUserId, budgetId: previousBudgetId }),
      after: snapshot({ litellmUserId, budgetId }),
    };
  },
);
