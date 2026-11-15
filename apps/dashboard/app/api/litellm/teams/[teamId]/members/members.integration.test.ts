import { describe, expect, it, vi } from "vitest";

import {
  LTEAM,
  call,
  defineTeamReadContract,
  expectNoSentinels,
  setupViewsSuite,
  stubLiteLLMEnv,
} from "@/test/fake-litellm-views";
import { signInAs } from "@/test/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/members GET in scope), "Roles and rights" (Lead sees members' spend,
// budgets and limits), "Reads" (getTeam; team_memberships are loose rows),
// "Identity mapping and members", implementation-phases L3 Verify, Rule 60.23.
//
// Contract for the developer (.../members/route.ts, GET):
//   200 data = { connected: false, items: [] } when unlinked, else
//   { connected: true,
//     items: [{ email, spend, maxBudget, rpmLimit, tpmLimit, ... }] }  (allowlisted fields only)
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).GET;
};

defineTeamReadContract(state, {
  full: false,
  load,
  suffix: "/members",
  query: "",
  toggleOp: "getTeam",
  upstreamPath: "/team/info",
});

describe("GET /api/litellm/teams/[teamId]/members", () => {
  it("lists members with their LiteLLM-reported spend, budget and limits (Roles and rights: Lead)", async () => {
    signInAs("teamAdminA");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      {
        teamId: "team-a",
      },
    );
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      email: "a1@company.com",
      spend: 3.25,
      maxBudget: 10,
      rpmLimit: 5,
      tpmLimit: 500,
    });
    expect(JSON.stringify(state.fake.calls.map((c) => c.url))).toContain(
      LTEAM["team-a"],
    );
  });

  it("membership rows are reduced to allowlisted fields (cost visualisation; LT1)", async () => {
    signInAs("admin");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      {
        teamId: "team-a",
      },
    );
    expectNoSentinels(body);
    for (const banned of ["budget_id", "created_by", "litellm_budget_table"]) {
      expect(JSON.stringify(body)).not.toContain(banned);
    }
  });
});
