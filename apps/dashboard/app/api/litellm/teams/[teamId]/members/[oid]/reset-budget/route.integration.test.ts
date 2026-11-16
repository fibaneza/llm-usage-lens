import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  LTEAM,
  MEMBER_A_LUSER,
  defineMemberWriteContract,
  memberAudit,
  send,
  setupMemberWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-member-writes-support";

// Contract for the developer: see the header of each describe below. Shared
// role x operation, toggle, outage, scope-404 and unlinked cases come from
// defineMemberWriteContract; the 401/403-before-parse/400/no-store/denied
// cases of every route are the shared route-contract suite's (Rule 60.23).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupMemberWritesSuite();

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (resetMemberBudget: POST
// /team/{team_id}/member/{user_id}/reset_budget, no body fields; Lead + Admin;
// toggle on; audit litellmUserId, previous_budget_id and budget_id), "Budgets
// and limits" (exactly one member of one team).
//
// Contract: POST .../members/[oid]/reset-budget, no body. 200
//   { data: { oid, litellmUserId, budgetId, previousBudgetId } } (ids from
//   LiteLLM's answer, null when absent); exactly one write; audit
//   litellm.member.reset-budget, before { budgetId: previous }, after
//   { budgetId: new }.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const PATTERN = "/api/litellm/teams/[teamId]/members/[oid]/reset-budget";
const url = (team: string, oid: string) =>
  `/api/litellm/teams/${team}/members/${oid}/reset-budget`;

defineMemberWriteContract(state, {
  method: "POST",
  pattern: PATTERN,
  action: "litellm.member.reset-budget",
  toggleOp: "resetMemberBudget",
  okStatus: 200,
  load,
  path: url,
});

describe("POST /api/litellm/teams/[teamId]/members/[oid]/reset-budget", () => {
  it("resets exactly one member of one team and audits both budget ids (Writes)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await send(await load(), {
      method: "POST",
      path: url("team-a", CALLERS.memberA.oid),
      params: { teamId: "team-a", oid: CALLERS.memberA.oid },
    });
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      oid: CALLERS.memberA.oid,
      litellmUserId: MEMBER_A_LUSER,
      budgetId: "budget-new",
      previousBudgetId: "b1",
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("POST");
    expect(writes[0]?.path).toBe(
      `/team/${LTEAM["team-a"]}/member/${encodeURIComponent(MEMBER_A_LUSER)}/reset_budget`,
    );
    const [record] = await memberAudit();
    expect(record).toMatchObject({
      action: "litellm.member.reset-budget",
      result: "success",
      target: { type: "litellm-user", id: MEMBER_A_LUSER },
      before: { budgetId: "b1" },
      after: { budgetId: "budget-new" },
    });
  });
});
