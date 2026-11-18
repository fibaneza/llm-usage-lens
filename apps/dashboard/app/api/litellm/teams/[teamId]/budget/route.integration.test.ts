import { describe, expect, it, vi } from "vitest";

import { createAppTeam } from "@/lib/data/access/app-teams";
import { putTeamLink } from "@/lib/data/litellm/team-links";
import { ctxAt, ok } from "@/test/support/access-test-support";
import {
  CALLERS,
  LTEAM,
  UNLINKED_LTEAM,
  auditWith,
  bodyOf,
  callsTo,
  defineTeamScopedWriteContract,
  expectError,
  installTeamWritesFake,
  send,
  setupTeamWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-team-writes-support";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupTeamWritesSuite();

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setTeamBudget: POST
// /team/update with team_id, max_budget, budget_duration, soft_budget; Admin
// set/raise, Lead (incl. org-admin) lower only; audit team_id before/after
// budget), "Budgets and limits" (a Lead raising team values gets 400
// BAD_REQUEST with no LiteLLM call), LD26 (least privilege: org-admin is a
// Lead on every team, so it lowers only), LT13.
//
// Contract: PATCH /api/litellm/teams/[teamId]/budget, strict body
//   { maxBudget?: number > 0, budgetDuration?: duration, softBudget?: number > 0 },
//   at least one; only the fields given are sent. A Lead (scope-only caller)
//   may set a value no higher than the team's current one (an unset current
//   value counts as unlimited, so setting one is lowering); a higher value is
//   400 BAD_REQUEST before any write. Only internal-admin may raise or set
//   budgetDuration; internal-org-admin is a Lead (LD26).
//   200 { data: { teamId, litellmTeamId, maxBudget?, budgetDuration?, softBudget? } };
//   audit litellm.team.budget, target { type: "litellm-team", id: <litellm team id> },
//   before/after { maxBudget?, budgetDuration?, softBudget? } of the fields changed.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).PATCH;
};
const url = (team: string) => `/api/litellm/teams/${team}/budget`;

defineTeamScopedWriteContract(state, {
  method: "PATCH",
  pattern: "/api/litellm/teams/[teamId]/budget",
  action: "litellm.team.budget",
  auditPrefix: "litellm.team.",
  toggleOp: "setTeamBudget",
  okStatus: 200,
  load,
  path: url,
  params: (team) => ({ teamId: team }),
  body: { maxBudget: 50 },
  targetType: "litellm-team",
});

describe("PATCH /api/litellm/teams/[teamId]/budget", () => {
  const patch = async (payload: unknown) =>
    send(await load(), {
      method: "PATCH",
      path: url("team-a"),
      params: { teamId: "team-a" },
      body: payload,
    });

  it("sends only the fields given and audits the before/after budget (Writes; LT10)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await patch({ maxBudget: 50 });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      teamId: "team-a",
      litellmTeamId: LTEAM["team-a"],
      maxBudget: 50,
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/team/update");
    expect(bodyOf(writes[0])).toEqual({
      team_id: LTEAM["team-a"],
      max_budget: 50,
    });
    const [record] = await auditWith("litellm.team.");
    expect(record).toMatchObject({
      result: "success",
      target: { type: "litellm-team", id: LTEAM["team-a"] },
      before: { maxBudget: 100 },
      after: { maxBudget: 50 },
    });
  });

  it("sends the soft budget and duration under their LiteLLM names (Writes)", async () => {
    signInAs("admin");
    await patch({ softBudget: 70, budgetDuration: "7d" });
    expect(bodyOf(writeCalls(state)[0])).toEqual({
      team_id: LTEAM["team-a"],
      soft_budget: 70,
      budget_duration: "7d",
    });
  });

  // LT13: complete role x direction matrix against the team's max_budget 100.
  it.each([
    ["teamAdminA", 100, 200],
    ["teamAdminA", 50, 200],
    ["teamAdminA", 101, 400],
    ["deptAdminEng", 50, 200],
    ["deptAdminEng", 150, 400],
    ["orgAdmin", 100, 200],
    ["orgAdmin", 50, 200],
    ["orgAdmin", 150, 400],
    ["admin", 150, 200],
  ] as const)(
    "%s setting max_budget to %i against the team's 100 is %i (Lead incl. org-admin lowers only; Admin set/raise; LD26, LT13)",
    async (who, amount, status) => {
      signInAs(who);
      const { res } = await patch({ maxBudget: amount });
      expect(res.status).toBe(status);
      if (status === 400) {
        await expectError(res, 400, "BAD_REQUEST");
        expect(writeCalls(state)).toHaveLength(0);
        expect(await auditWith("litellm.team.")).toHaveLength(0);
      }
    },
  );

  it.each([
    [80, 200],
    [81, 400],
  ])(
    "a Lead setting soft_budget to %i against the team's 80 is %i (Budgets and limits: lower max_budget and soft_budget)",
    async (softBudget, status) => {
      signInAs("teamAdminA");
      const { res } = await patch({ softBudget });
      expect(res.status).toBe(status);
      if (status === 400) expect(writeCalls(state)).toHaveLength(0);
    },
  );

  it("a Lead lowering one field while raising another is 400 with no write (LT13)", async () => {
    signInAs("teamAdminA");
    await expectError(
      (await patch({ maxBudget: 50, softBudget: 90 })).res,
      400,
      "BAD_REQUEST",
    );
    expect(writeCalls(state)).toHaveLength(0);
  });

  it("a Lead may set a budget on a team that has none (unlimited -> bounded is lowering)", async () => {
    installTeamWritesFake(state, { team: { max_budget: null } });
    signInAs("teamAdminA");
    expect((await patch({ maxBudget: 500 })).res.status).toBe(200);
  });

  it("reads the team's current values from LiteLLM, never from the request (LT13)", async () => {
    signInAs("teamAdminA");
    await patch({ maxBudget: 10 });
    expect(callsTo(state, "GET /team/info").length).toBeGreaterThan(0);
  });

  it.each([
    ["a negative budget", { maxBudget: -1 }],
    ["a string budget", { maxBudget: "50" }],
    ["a null budget", { maxBudget: null }],
    ["a malformed duration", { budgetDuration: "monthly" }],
    ["an empty body (nothing to change)", {}],
    ["an unknown field (models)", { maxBudget: 1, models: ["x"] }],
    ["an unknown field (team_id)", { maxBudget: 1, team_id: LTEAM["team-b"] }],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM write (strict input schema)",
    async (_n, payload) => {
      signInAs("admin");
      await expectError((await patch(payload)).res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );

  it("audit records carry the acting oid", async () => {
    signInAs("teamAdminA");
    await patch({ maxBudget: 50 });
    const [record] = await auditWith("litellm.team.");
    expect(record?.actor).toBe(CALLERS.teamAdminA.oid);
  });
});

// Orchestrator ruling (fail closed; Budgets and limits: "a Lead may only lower
// max_budget and soft_budget"): the duration has no comparable current value,
// so a Lead sending budgetDuration is 400 with no write and no audit record.
describe("PATCH /api/litellm/teams/[teamId]/budget - budgetDuration", () => {
  const patch = async (payload: unknown) =>
    send(await load(), {
      method: "PATCH",
      path: url("team-a"),
      params: { teamId: "team-a" },
      body: payload,
    });

  it.each([
    ["teamAdminA", { budgetDuration: "7d" }],
    ["deptAdminEng", { budgetDuration: "7d" }],
    ["orgAdmin", { budgetDuration: "7d" }],
    ["orgAdmin", { softBudget: 90 }],
    ["teamAdminA", { maxBudget: 50, budgetDuration: "7d" }],
  ] as const)(
    "a Lead (%s) sending %j is 400 BAD_REQUEST, no write, no audit (fail closed)",
    async (who, payload) => {
      signInAs(who);
      await expectError((await patch(payload)).res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
      expect(await auditWith("litellm.team.")).toHaveLength(0);
    },
  );

  it("only internal-admin may set budgetDuration (LD26)", async () => {
    signInAs("admin");
    expect((await patch({ budgetDuration: "7d" })).res.status).toBe(200);
    expect(bodyOf(writeCalls(state)[0])).toEqual({
      team_id: LTEAM["team-a"],
      budget_duration: "7d",
    });
  });
});

// Source: docs/specs/2026-11-17-app-teams.md - "Teams without an AWS account"
// (a created team takes a link, then the team writes); LiteLLM spec - "Roles
// and rights" (a Lead writes the teams in its scope); Access Control MI-D7
// (a department scope covers a created team by its stored departmentId),
// T-MI4, Enforcement 2. runTeamWrite (lib/litellm/team-write.ts, shared by the
// team and key write routes) reads the team directory (M2 design 1, M2-b), so
// one route proves it for all of them.
describe("PATCH /api/litellm/teams/[teamId]/budget - a linked created team (MI-D7; T-MI4)", () => {
  const createLinked = async (name: string, departmentId: string) => {
    const teamId = ok(
      await createAppTeam(
        { name, departmentId, departmentName: departmentId },
        ctxAt(undefined, `req-budget-${name}`),
      ),
    ).teamId;
    ok(
      await putTeamLink(
        { teamId, litellmTeamId: UNLINKED_LTEAM, version: null },
        ctxAt(undefined, `req-budget-link-${name}`),
      ),
    );
    return teamId;
  };
  const patch = async (teamId: string) =>
    send(await load(), {
      method: "PATCH",
      path: url(teamId),
      params: { teamId },
      body: { maxBudget: 50 },
    });

  it("a department-scope Lead lowers the budget of a linked created team of its department; the audit record carries the created team id", async () => {
    const teamId = await createLinked("Eng Guild", "dept-eng");
    signInAs("deptAdminEng");
    const { res } = await patch(teamId);
    expect(res.status).toBe(200);
    const [record] = await auditWith("litellm.team.");
    expect(record).toMatchObject({ result: "success", teamId });
  });

  it("the same Lead gets the 404 of a missing team for a created team of another department: no LiteLLM call (T-MI4; Enforcement 2)", async () => {
    const teamId = await createLinked("Ops Guild", "dept-ops");
    signInAs("deptAdminEng");
    const outOfScope = await patch(teamId);
    const missing = await patch("appteam-00000000-0000-4000-8000-00000000dead");
    expect(outOfScope.res.status).toBe(404);
    expect(outOfScope.text).toBe(missing.text);
    expect(state.fake.calls).toHaveLength(0);
  });
});
