import { describe, expect, it, vi } from "vitest";

import {
  DATES,
  LTEAM,
  call,
  defineTeamReadContract,
  expectError,
  expectNoSentinels,
  setupViewsSuite,
  stubLiteLLMEnv,
} from "@/test/fake-litellm-views";
import { signInAs } from "@/test/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId] GET: Lead in scope, Admin, Auditor), "Reads" (getTeam, getTeamDailySpend
// with timezone=0 per LD20), "Roles and rights", "Identity mapping and members"
// ("not connected"), "Cost visualisation and provenance" (loose rows reduced),
// implementation-phases L3 Verify (role x read matrix, 404 parity), Rules 10.3, 60.23.
//
// Contract for the developer (apps/dashboard/app/api/litellm/teams/[teamId]/route.ts, GET):
//   query: dateFrom, dateTo (DateRangeQuerySchema, 90-day cap -> 400).
//   200 data = { connected: false } for an in-scope unlinked team, else
//   { connected: true,
//     team: { alias, spend, maxBudget, softBudget, budgetDuration, models, rpmLimit, tpmLimit },
//     daily: [{ date, spend, ... }],           // allowlisted fields only
//     enabledOperations: string[] }.
//   Out of scope, missing, Viewer/member, no role: 404 NOT_FOUND (same body).
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
  full: true,
  load,
  suffix: "",
  query: `?${DATES}`,
  toggleOp: "getTeam",
  upstreamPath: "/team/info",
});

describe("GET /api/litellm/teams/[teamId]", () => {
  const get = async (query = `?${DATES}`) =>
    call(await load(), `/api/litellm/teams/team-a${query}`, {
      teamId: "team-a",
    });

  it("returns the team's LiteLLM-reported spend, budget and models (Reads: getTeam)", async () => {
    signInAs("admin");
    const { body } = await get();
    expect(body.data.team).toMatchObject({
      alias: "Alpha",
      spend: 12.5,
      maxBudget: 100,
      models: ["claude-sonnet"],
    });
    expect(body.data.daily[0]).toMatchObject({
      date: "2026-11-02",
      spend: 1.5,
    });
    expect(Array.isArray(body.data.enabledOperations)).toBe(true);
    expect(body.data.enabledOperations).toContain("getTeam");
  });

  it("daily activity is queried in UTC with timezone=0 for the linked team and range (LD20)", async () => {
    signInAs("admin");
    await get();
    const daily = state.fake.calls.find(
      (c) => c.path === "/team/daily/activity/aggregated",
    )!;
    const q = new URL(daily.url).searchParams;
    expect(q.get("timezone")).toBe("0");
    expect(q.get("team_ids")).toBe(LTEAM["team-a"]);
    expect(q.get("start_date")).toBe("2026-11-01");
    expect(q.get("end_date")).toBe("2026-11-14");
  });

  it("loose upstream rows are reduced to allowlisted fields before the response (cost visualisation; LT1)", async () => {
    signInAs("admin");
    const { body } = await get();
    expectNoSentinels(body);
    const allowed = new Set([
      "date",
      "spend",
      "promptTokens",
      "completionTokens",
      "totalTokens",
      "apiRequests",
      "successfulRequests",
      "failedRequests",
    ]);
    for (const key of Object.keys(body.data.daily[0])) {
      expect(allowed.has(key), key).toBe(true);
    }
  });

  it.each([
    ["a range over 90 days", "?dateFrom=2026-01-01&dateTo=2026-06-01"],
    ["dateTo before dateFrom", "?dateFrom=2026-11-14&dateTo=2026-11-01"],
    ["a malformed date", "?dateFrom=nope&dateTo=2026-11-01"],
  ])(
    "returns 400 BAD_REQUEST for %s and makes no LiteLLM call (Rule 20.8, 60.16)",
    async (_n, query) => {
      signInAs("admin");
      const { res } = await get(query);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    },
  );
});
