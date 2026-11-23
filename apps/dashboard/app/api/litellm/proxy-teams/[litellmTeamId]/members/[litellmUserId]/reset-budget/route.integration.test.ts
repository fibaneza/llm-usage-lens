import { describe, expect, it, vi } from "vitest";

import {
  LTEAM,
  LU,
  defineProxyMemberResetContract,
  send,
  setupIdWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-id-writes-support";

// Source: docs/specs/2026-11-10-litellm.md - LD39, "Writes" (resetMemberBudget:
// POST /team/{team_id}/member/{user_id}/reset_budget, toggle on by default),
// "API routes" (RS2 write routes); plan RS2 D-RS3..D-RS5, D-RS8, T-RS3..T-RS6.
// The 401/403-before-parse/400/no-store/denied cases are the shared
// route-contract suite's (Rule 60.23).
//
// Contract for the developer: POST
// app/api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-budget/route.ts,
// no body; exports POST. 200 { data: { litellmUserId, budgetId,
// previousBudgetId } } (ids from LiteLLM's answer); audit
// litellm.member.reset-budget, before { budgetId: previous }, after
// { budgetId: new }.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupIdWritesSuite();
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};

defineProxyMemberResetContract(state, {
  operation: "budget",
  action: "litellm.member.reset-budget",
  toggleOp: "resetMemberBudget",
  defaultOff: false,
  suffix: "reset-budget",
  upstream: "reset_budget",
  load,
});

describe("POST /api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-budget (D-RS4)", () => {
  it("is on by default (no toggle needed) and answers both budget ids from LiteLLM (Writes: resetMemberBudget)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await send(
      await load(),
      `/api/litellm/proxy-teams/${LTEAM["team-a"]}/members/${LU.ab}/reset-budget`,
      { litellmTeamId: LTEAM["team-a"], litellmUserId: LU.ab },
    );
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      litellmUserId: LU.ab,
      budgetId: "budget-new",
      previousBudgetId: "b1",
    });
    expect(writeCalls(state)).toHaveLength(1);
  });
});
