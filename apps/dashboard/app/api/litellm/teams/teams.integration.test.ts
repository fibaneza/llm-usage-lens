import { describe, expect, it, vi } from "vitest";

import { ctxAt } from "@/lib/data/access/access-test-support";
import { getTeamLink, putTeamLink } from "@/lib/data/litellm/team-links";
import {
  CALLERS,
  LTEAM,
  NEW_LTEAM,
  auditWith,
  bodyOf,
  callsTo,
  expectError,
  installTeamWritesFake,
  send,
  setToggles,
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

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (createTeam: POST
// /team/new with team_alias, max_budget, budget_duration, rpm_limit,
// tpm_limit, models (subset of proxy models), metadata.{source:
// "llm-usage-lens", dashboardTeamId}; Admin; toggle on; audit new team_id with
// alias, budget, limits, models), "Roles and rights" and LD24 (team creation
// stays internal-admin only; the org-admin 403 is asserted by the shared route
// contract), "Identity mapping" (team link one-to-one), "API routes"
// (/api/litellm/teams POST Admin: createTeam + link), LT4, LT14, LD14.
//
// Contract: POST /api/litellm/teams, strict body
//   { teamId (a known dashboard team), teamAlias, maxBudget?, budgetDuration?,
//     rpmLimit?, tpmLimit?, models? }  (limits positive integers; models a
//   non-empty subset of /models).
//   201 { data: { teamId, litellmTeamId } } - the new team is linked to the
//   dashboard team in the same request. A dashboard team that already has a
//   link is 409 CONFLICT before any LiteLLM call; an unknown dashboard team is
//   404 NOT_FOUND. Audit litellm.team.create, teamId = dashboard team, target
//   { type: "litellm-team", id: <new litellm team id> }, after { teamId,
//   teamAlias, maxBudget?, budgetDuration?, rpmLimit?, tpmLimit?, models? }.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const create = async (payload: unknown) =>
  send(await load(), {
    method: "POST",
    path: "/api/litellm/teams",
    params: {},
    body: payload,
  });
const NEW = { teamId: "team-u", teamAlias: "U team" };

describe("POST /api/litellm/teams", () => {
  it("creates the LiteLLM team with the fixed fields and provenance metadata, then links it to the dashboard team (Writes: createTeam; LT4)", async () => {
    signInAs("admin");
    const { res, body } = await create({
      ...NEW,
      maxBudget: 100,
      budgetDuration: "30d",
      rpmLimit: 60,
      models: ["claude-sonnet"],
    });
    expect(res.status).toBe(201);
    expect(body.data).toEqual({ teamId: "team-u", litellmTeamId: NEW_LTEAM });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/team/new");
    expect(bodyOf(writes[0])).toEqual({
      team_alias: "U team",
      max_budget: 100,
      budget_duration: "30d",
      rpm_limit: 60,
      models: ["claude-sonnet"],
      metadata: { source: "llm-usage-lens", dashboardTeamId: "team-u" },
    });
    expect(writes[0]?.headers["litellm-changed-by"]).toBe(
      `llm-usage-lens:${CALLERS.admin.email}`,
    );
    expect((await getTeamLink("team-u"))?.litellmTeamId).toBe(NEW_LTEAM);
  });

  it("omits every optional field that is not given - never 0 or null (LT10)", async () => {
    signInAs("admin");
    await create(NEW);
    expect(bodyOf(writeCalls(state)[0])).toEqual({
      team_alias: "U team",
      metadata: { source: "llm-usage-lens", dashboardTeamId: "team-u" },
    });
  });

  it("audits the creation against the new LiteLLM team id with alias, budget, limits and models (Writes)", async () => {
    signInAs("admin");
    await create({
      ...NEW,
      maxBudget: 100,
      rpmLimit: 60,
      models: ["claude-sonnet"],
    });
    const created = (await auditWith("litellm.team.")).filter(
      (r) => r.action === "litellm.team.create",
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      result: "success",
      category: "change",
      actor: CALLERS.admin.oid,
      teamId: "team-u",
      target: { type: "litellm-team", id: NEW_LTEAM },
      after: {
        teamId: "team-u",
        teamAlias: "U team",
        maxBudget: 100,
        rpmLimit: 60,
        models: ["claude-sonnet"],
      },
    });
  });

  it("a dashboard team that is already linked is 409 CONFLICT with no LiteLLM call and the link unchanged (Identity mapping: one-to-one)", async () => {
    signInAs("admin");
    await expectError(
      (await create({ teamId: "team-a", teamAlias: "Again" })).res,
      409,
      "CONFLICT",
    );
    expect(state.fake.calls).toHaveLength(0);
    expect((await getTeamLink("team-a"))?.litellmTeamId).toBe(LTEAM["team-a"]);
  });

  it("an unknown dashboard team is 404 NOT_FOUND with no LiteLLM write", async () => {
    signInAs("admin");
    await expectError(
      (await create({ teamId: "team-zzz", teamAlias: "X" })).res,
      404,
      "NOT_FOUND",
    );
    expect(writeCalls(state)).toHaveLength(0);
  });

  it.each([
    ["a model /models does not list", { models: ["gpt-unknown"] }],
    ["an empty model list", { models: [] }],
    ["the all-proxy-models wildcard", { models: ["all-proxy-models"] }],
    ["zero rpm (LiteLLM may read 0 as block)", { rpmLimit: 0 }],
    ["a fractional tpm", { tpmLimit: 1.5 }],
    ["a negative budget", { maxBudget: -1 }],
    ["a malformed duration", { budgetDuration: "monthly" }],
    ["an empty alias", { teamAlias: "" }],
    ["a missing dashboard team id", { teamId: undefined }],
    ["an unknown field (team_id)", { team_id: LTEAM["team-b"] }],
    ["an unknown field (metadata)", { metadata: { source: "x" } }],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM write and no link (LT4, LT14)",
    async (_n, extra) => {
      signInAs("admin");
      await expectError(
        (await create({ ...NEW, ...extra })).res,
        400,
        "BAD_REQUEST",
      );
      expect(writeCalls(state)).toHaveLength(0);
      expect(await getTeamLink("team-u")).toBeNull();
    },
  );

  it("validates the models against /models before creating (LT14)", async () => {
    signInAs("admin");
    await create({ ...NEW, models: ["claude-haiku"] });
    expect(callsTo(state, "GET /models").length).toBeGreaterThan(0);
  });

  it("a disabled createTeam is 403 OPERATION_DISABLED before any LiteLLM call, nothing audited (Toggles narrow only)", async () => {
    await setToggles({ createTeam: false });
    signInAs("admin");
    await expectError((await create(NEW)).res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
    expect(await auditWith("litellm.team.")).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE with one failed audit record and no link (error codes; Audit)", async () => {
    installTeamWritesFake(state, { outage: true });
    signInAs("admin");
    const { res, text } = await create(NEW);
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
    const records = await auditWith("litellm.team.");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.team.create",
      result: "failed",
    });
    expect(await getTeamLink("team-u")).toBeNull();
  });

  it("a link that loses the race after /team/new is 409 CONFLICT and still audits the upstream create (W2; Audit: every LiteLLM write is recorded)", async () => {
    // Another dashboard team already holds the claim on the id /team/new returns.
    const rival = await getTeamLink("team-c");
    await putTeamLink(
      {
        teamId: "team-c",
        litellmTeamId: NEW_LTEAM,
        version: rival?.version ?? null,
      },
      ctxAt(undefined, "req-rival-claim"),
    );
    signInAs("admin");
    const { res } = await create(NEW);
    await expectError(res, 409, "CONFLICT");
    expect(callsTo(state, "POST /team/new")).toHaveLength(1);
    expect(await getTeamLink("team-u")).toBeNull();
    const created = (await auditWith("litellm.team.")).filter(
      (r) => r.action === "litellm.team.create",
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      teamId: "team-u",
      actor: CALLERS.admin.oid,
      target: { type: "litellm-team", id: NEW_LTEAM },
    });
  });
});
