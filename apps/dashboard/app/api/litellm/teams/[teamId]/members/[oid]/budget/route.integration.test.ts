import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  LTEAM,
  MEMBER_A_LUSER,
  bodyOf,
  defineMemberWriteContract,
  expectError,
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

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setMemberBudget: POST
// /team/member_update with team_id, user_id, max_budget_in_team, budget_duration
// only; Lead + Admin; audit litellmUserId, before/after), "Budgets and limits"
// (member max_budget_in_team <= the team's max_budget, else 400 with no
// LiteLLM write), LT13, LT10.
//
// Contract: PATCH .../members/[oid]/budget, strict body
//   { maxBudgetInTeam?: number > 0, budgetDuration?: "<n>(s|m|h|d|w|mo)" }
//   with at least one field. 200 { data: { oid, litellmUserId,
//   maxBudgetInTeam?, budgetDuration? } } echoing what was set. The route
//   reads the team (GET /team/info) first for the ceiling and the "before"
//   value; audit litellm.member.budget, before/after { maxBudgetInTeam }.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).PATCH;
};
const PATTERN = "/api/litellm/teams/[teamId]/members/[oid]/budget";
const url = (team: string, oid: string) =>
  `/api/litellm/teams/${team}/members/${oid}/budget`;

defineMemberWriteContract(state, {
  method: "PATCH",
  pattern: PATTERN,
  action: "litellm.member.budget",
  toggleOp: "setMemberBudget",
  okStatus: 200,
  load,
  path: url,
  body: { maxBudgetInTeam: 20 },
});

describe("PATCH /api/litellm/teams/[teamId]/members/[oid]/budget", () => {
  const patch = async (payload: unknown, oid = CALLERS.memberA.oid) =>
    send(await load(), {
      method: "PATCH",
      path: url("team-a", oid),
      params: { teamId: "team-a", oid },
      body: payload,
    });

  it("sets the member budget with the exact LiteLLM body and audits before/after (Writes)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await patch({ maxBudgetInTeam: 20 });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      oid: CALLERS.memberA.oid,
      litellmUserId: MEMBER_A_LUSER,
      maxBudgetInTeam: 20,
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(`${writes[0]?.method} ${writes[0]?.path}`).toBe(
      "POST /team/member_update",
    );
    expect(bodyOf(writes[0])).toEqual({
      team_id: LTEAM["team-a"],
      user_id: MEMBER_A_LUSER,
      max_budget_in_team: 20,
    });
    const [record] = await memberAudit();
    expect(record).toMatchObject({
      action: "litellm.member.budget",
      result: "success",
      target: { type: "litellm-user", id: MEMBER_A_LUSER },
      before: { litellmUserId: MEMBER_A_LUSER, maxBudgetInTeam: 10 },
      after: { litellmUserId: MEMBER_A_LUSER, maxBudgetInTeam: 20 },
    });
  });

  it("passes budgetDuration through and sends nothing else (no limits, no role)", async () => {
    signInAs("admin");
    const { res } = await patch({ maxBudgetInTeam: 5, budgetDuration: "30d" });
    expect(res.status).toBe(200);
    const sent = bodyOf(writeCalls(state)[0]);
    expect(sent.budget_duration).toBe("30d");
    expect(Object.keys(sent).sort()).toEqual([
      "budget_duration",
      "max_budget_in_team",
      "team_id",
      "user_id",
    ]);
  });

  it.each([
    [100, 200],
    [100.01, 400],
    [250, 400],
  ])(
    "a member budget of %s against the team max_budget of 100 is %i; over the team's is refused with no LiteLLM write (LT13)",
    async (amount, status) => {
      signInAs("admin");
      const { res } = await patch({ maxBudgetInTeam: amount });
      expect(res.status).toBe(status);
      if (status === 400) {
        await expectError(res, 400, "BAD_REQUEST");
        expect(writeCalls(state)).toHaveLength(0);
      }
    },
  );

  it.each([
    ["an empty body (nothing to change)", {}],
    ["a negative budget", { maxBudgetInTeam: -1 }],
    [
      "a zero budget (LiteLLM reads 0 as blocked; B3 PositiveBudget)",
      { maxBudgetInTeam: 0 },
    ],
    ["a string budget", { maxBudgetInTeam: "20" }],
    ["a malformed duration", { maxBudgetInTeam: 5, budgetDuration: "30 days" }],
    ["an unknown field (strict body)", { maxBudgetInTeam: 5, rpmLimit: 3 }],
    [
      "a client-supplied LiteLLM id",
      { maxBudgetInTeam: 5, user_id: "x@y.com" },
    ],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM write (Allowlist: strict inputs)",
    async (_n, payload) => {
      signInAs("admin");
      await expectError((await patch(payload)).res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );
});
