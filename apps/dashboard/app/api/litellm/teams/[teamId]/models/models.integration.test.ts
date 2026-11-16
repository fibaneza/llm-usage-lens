import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  LTEAM,
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
} from "@/test/litellm-team-writes-support";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupTeamWritesSuite();

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setTeamModels: POST
// /team/update with team_id and models (subset of /models); Lead + Admin; audit
// team_id before/after models), "Budgets and limits" (Model access: a team's
// models is a subset of /models; an unknown model returns 400; no model write
// exists), "Gateway guardrails" item 4 (no widening names), LT4, LT14.
//
// Contract: PUT /api/litellm/teams/[teamId]/models, strict body
//   { models: string[] }, non-empty, every name listed by GET /models, no
//   "all-proxy-models" / "all-team-models" (they widen). The list replaces the
//   team's models. 200 { data: { teamId, litellmTeamId, models } }; LiteLLM
//   body exactly { team_id, models }; the list must be a subset of the team's
//   CURRENT models (the /models list when the team lists none; LD26, LT14) -
//   a widening is 400. Audit litellm.team.models, target
//   { type: "litellm-team", id: <litellm team id> }, before { models } after { models }.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).PUT;
};
const url = (team: string) => `/api/litellm/teams/${team}/models`;
const BOTH = ["claude-sonnet", "claude-haiku"];

defineTeamScopedWriteContract(state, {
  method: "PUT",
  pattern: "/api/litellm/teams/[teamId]/models",
  action: "litellm.team.models",
  auditPrefix: "litellm.team.",
  toggleOp: "setTeamModels",
  okStatus: 200,
  load,
  path: url,
  params: (team) => ({ teamId: team }),
  body: { models: ["claude-sonnet"] },
  targetType: "litellm-team",
});

describe("PUT /api/litellm/teams/[teamId]/models", () => {
  const put = async (payload: unknown) =>
    send(await load(), {
      method: "PUT",
      path: url("team-a"),
      params: { teamId: "team-a" },
      body: payload,
    });

  it("replaces the team's models with a subset of its current models and audits before/after (Writes; LD26)", async () => {
    installTeamWritesFake(state, { team: { models: BOTH } });
    signInAs("teamAdminA");
    const { res, body } = await put({ models: ["claude-haiku"] });
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      teamId: "team-a",
      litellmTeamId: LTEAM["team-a"],
      models: ["claude-haiku"],
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/team/update");
    expect(bodyOf(writes[0])).toEqual({
      team_id: LTEAM["team-a"],
      models: ["claude-haiku"],
    });
    const [record] = await auditWith("litellm.team.");
    expect(record).toMatchObject({
      target: { type: "litellm-team", id: LTEAM["team-a"] },
      before: { models: BOTH },
      after: { models: ["claude-haiku"] },
    });
  });

  it("a team that lists no models falls back to /models as the ceiling (LD26)", async () => {
    installTeamWritesFake(state, { team: { models: [] } });
    signInAs("admin");
    expect((await put({ models: BOTH })).res.status).toBe(200);
  });

  it("validates against /models and never writes a model (no /model/* call; LT14)", async () => {
    installTeamWritesFake(state, { team: { models: BOTH } });
    signInAs("admin");
    await put({ models: ["claude-haiku"] });
    expect(callsTo(state, "GET /models").length).toBeGreaterThan(0);
    expect(state.fake.calls.some((c) => c.path.startsWith("/model/"))).toBe(
      false,
    );
  });

  it.each([
    [
      "a model /models does not list",
      { models: ["claude-sonnet", "gpt-unknown"] },
    ],
    [
      "a model the team does not currently have (widening; LD26, LT14)",
      { models: BOTH },
    ],
    ["an empty list (LiteLLM reads it as every model)", { models: [] }],
    ["the all-proxy-models wildcard", { models: ["all-proxy-models"] }],
    ["the all-team-models wildcard", { models: ["all-team-models"] }],
    ["a non-array", { models: "claude-sonnet" }],
    ["a missing list", {}],
    ["an unknown field (team_id)", { models: BOTH, team_id: LTEAM["team-b"] }],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM write (LT4, LT14)",
    async (_n, payload) => {
      signInAs("teamAdminA");
      await expectError((await put(payload)).res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
      expect(await auditWith("litellm.team.")).toHaveLength(0);
    },
  );

  it("a Lead acts for their own team only; the audit carries the acting oid", async () => {
    signInAs("teamAdminA");
    await put({ models: ["claude-sonnet"] });
    const [record] = await auditWith("litellm.team.");
    expect(record?.actor).toBe(CALLERS.teamAdminA.oid);
  });

  it("an unreachable /models is 503 LITELLM_UNAVAILABLE and never falls back to an unchecked write (LT14)", async () => {
    installTeamWritesFake(state, { outage: true });
    signInAs("admin");
    await expectError(
      (await put({ models: ["claude-sonnet"] })).res,
      503,
      "LITELLM_UNAVAILABLE",
    );
    expect(writeCalls(state)).toHaveLength(0);
  });
});
