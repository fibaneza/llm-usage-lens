import { describe, expect, it, vi } from "vitest";

import {
  LTEAM,
  auditWith,
  bodyOf,
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

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setTeamLimits: POST
// /team/update with team_id, rpm_limit, tpm_limit, model_rpm_limit,
// model_tpm_limit (keys <= team models), team_member_rpm_limit,
// team_member_tpm_limit; Admin set/raise, Lead (incl. org-admin, LD26) lower
// only; audit team_id
// before/after limits), "Budgets and limits" (positive integers or unset,
// never 0; per-model limits only for models the team already has; a Lead
// raising is 400 with no call), LT10, LT13.
//
// Contract: PATCH /api/litellm/teams/[teamId]/limits, strict body
//   { rpmLimit?, tpmLimit?, teamMemberRpmLimit?, teamMemberTpmLimit?: integer >= 1,
//     modelRpmLimit?, modelTpmLimit?: { [model in team models]: integer >= 1 } },
//   at least one; only the fields given are sent. A Lead may set rpmLimit and
//   tpmLimit no higher than the team's current value (unset counts as
//   unlimited); higher is 400 BAD_REQUEST before any write. Only
//   internal-admin may raise; internal-org-admin is a Lead (LD26).
//   200 { data: { teamId, litellmTeamId, ...fields given } };
//   audit litellm.team.limits, target { type: "litellm-team", id: <litellm team id> },
//   before/after { rpmLimit?, tpmLimit?, teamMemberRpmLimit?, teamMemberTpmLimit?,
//   modelRpmLimit?, modelTpmLimit? }; the two per-model maps are stored as
//   string[] of "<model>=<limit>" entries (snapshot values cannot be objects).
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).PATCH;
};
const url = (team: string) => `/api/litellm/teams/${team}/limits`;

defineTeamScopedWriteContract(state, {
  method: "PATCH",
  pattern: "/api/litellm/teams/[teamId]/limits",
  action: "litellm.team.limits",
  auditPrefix: "litellm.team.",
  toggleOp: "setTeamLimits",
  okStatus: 200,
  load,
  path: url,
  params: (team) => ({ teamId: team }),
  body: { rpmLimit: 30 },
  targetType: "litellm-team",
});

describe("PATCH /api/litellm/teams/[teamId]/limits", () => {
  const patch = async (payload: unknown) =>
    send(await load(), {
      method: "PATCH",
      path: url("team-a"),
      params: { teamId: "team-a" },
      body: payload,
    });

  it("sends only the limit given - the unset one is omitted, never 0 or null - and audits before/after (LT10; Writes)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await patch({ rpmLimit: 30 });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      teamId: "team-a",
      litellmTeamId: LTEAM["team-a"],
      rpmLimit: 30,
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/team/update");
    expect(bodyOf(writes[0])).toEqual({
      team_id: LTEAM["team-a"],
      rpm_limit: 30,
    });
    const [record] = await auditWith("litellm.team.");
    expect(record).toMatchObject({
      result: "success",
      target: { type: "litellm-team", id: LTEAM["team-a"] },
      before: { rpmLimit: 60 },
      after: { rpmLimit: 30 },
    });
  });

  it("sends per-model and per-member limits under their LiteLLM names (Writes)", async () => {
    signInAs("admin");
    const { res } = await patch({
      tpmLimit: 7000,
      modelRpmLimit: { "claude-sonnet": 20 },
      modelTpmLimit: { "claude-sonnet": 2000 },
      teamMemberRpmLimit: 10,
      teamMemberTpmLimit: 1000,
    });
    expect(res.status).toBe(200);
    expect(bodyOf(writeCalls(state)[0])).toEqual({
      team_id: LTEAM["team-a"],
      tpm_limit: 7000,
      model_rpm_limit: { "claude-sonnet": 20 },
      model_tpm_limit: { "claude-sonnet": 2000 },
      team_member_rpm_limit: 10,
      team_member_tpm_limit: 1000,
    });
    const [record] = await auditWith("litellm.team.");
    expect(record?.after).toMatchObject({
      modelRpmLimit: ["claude-sonnet=20"],
      teamMemberRpmLimit: 10,
    });
  });

  // LT13: role x direction matrix against the team's 60 rpm / 6000 tpm.
  it.each([
    ["teamAdminA", { rpmLimit: 60 }, 200],
    ["teamAdminA", { tpmLimit: 5000 }, 200],
    ["teamAdminA", { rpmLimit: 61 }, 400],
    ["teamAdminA", { tpmLimit: 6001 }, 400],
    ["deptAdminEng", { rpmLimit: 61 }, 400],
    ["deptAdminEng", { rpmLimit: 10 }, 200],
    ["orgAdmin", { rpmLimit: 30 }, 200],
    ["orgAdmin", { rpmLimit: 120 }, 400],
    ["orgAdmin", { tpmLimit: 6001 }, 400],
    ["admin", { tpmLimit: 12000 }, 200],
  ] as const)(
    "%s sending %j against the team's 60 rpm / 6000 tpm is %i (Lead incl. org-admin lowers only; Admin set/raise; LD26, LT13)",
    async (who, payload, status) => {
      signInAs(who);
      const { res } = await patch(payload);
      expect(res.status).toBe(status);
      if (status === 400) {
        await expectError(res, 400, "BAD_REQUEST");
        expect(writeCalls(state)).toHaveLength(0);
        expect(await auditWith("litellm.team.")).toHaveLength(0);
      }
    },
  );

  it("a Lead may set a limit on a team that has none (unlimited -> bounded is lowering)", async () => {
    installTeamWritesFake(state, { team: { rpm_limit: null } });
    signInAs("teamAdminA");
    expect((await patch({ rpmLimit: 500 })).res.status).toBe(200);
  });

  it.each([
    ["zero (LiteLLM may read 0 as block)", { rpmLimit: 0 }],
    ["a negative limit", { tpmLimit: -5 }],
    ["a fractional limit", { rpmLimit: 1.5 }],
    ["a string limit", { rpmLimit: "5" }],
    ["null (unset means omitted)", { rpmLimit: null }],
    ["a zero per-model limit", { modelRpmLimit: { "claude-sonnet": 0 } }],
    ["a zero member limit", { teamMemberTpmLimit: 0 }],
    [
      "a per-model limit for a model the team does not have",
      { modelRpmLimit: { "claude-haiku": 5 } },
    ],
    [
      "a per-model tpm for a model the team does not have",
      { modelTpmLimit: { "gpt-x": 5 } },
    ],
    ["an empty body (nothing to change)", {}],
    ["an unknown field (max_budget)", { rpmLimit: 5, max_budget: 1 }],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM write (LT10; Budgets and limits)",
    async (_n, payload) => {
      signInAs("admin");
      await expectError((await patch(payload)).res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );
});

// Orchestrator ruling (fail closed; Budgets and limits: "A Lead may only lower
// team limits"): per-model and per-member limits have no comparable current
// value, so a Lead sending them is 400 with no write and no audit record.
describe("PATCH /api/litellm/teams/[teamId]/limits - uncomparable fields", () => {
  const patch = async (payload: unknown) =>
    send(await load(), {
      method: "PATCH",
      path: url("team-a"),
      params: { teamId: "team-a" },
      body: payload,
    });
  const FIELDS: Array<[string, Record<string, unknown>]> = [
    ["modelRpmLimit", { modelRpmLimit: { "claude-sonnet": 20 } }],
    ["modelTpmLimit", { modelTpmLimit: { "claude-sonnet": 2000 } }],
    ["teamMemberRpmLimit", { teamMemberRpmLimit: 10 }],
    ["teamMemberTpmLimit", { teamMemberTpmLimit: 1000 }],
  ];

  it.each(
    (["teamAdminA", "deptAdminEng", "orgAdmin"] as const).flatMap((who) =>
      FIELDS.map(([name, payload]) => [who, name, payload] as const),
    ),
  )(
    "a Lead (incl. org-admin, LD26) (%s) sending %s is 400 BAD_REQUEST, no write, no audit (fail closed)",
    async (who, _name, payload) => {
      signInAs(who);
      await expectError((await patch(payload)).res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
      expect(await auditWith("litellm.team.")).toHaveLength(0);
    },
  );

  it("a Lead sending a lowering rpmLimit together with an uncomparable field is still 400", async () => {
    signInAs("teamAdminA");
    await expectError(
      (await patch({ rpmLimit: 10, teamMemberRpmLimit: 5 })).res,
      400,
      "BAD_REQUEST",
    );
    expect(writeCalls(state)).toHaveLength(0);
  });

  it("only internal-admin may set the per-model and per-member limits (LD26)", async () => {
    signInAs("admin");
    const { res } = await patch({
      modelRpmLimit: { "claude-sonnet": 20 },
      teamMemberTpmLimit: 1000,
    });
    expect(res.status).toBe(200);
  });
});
