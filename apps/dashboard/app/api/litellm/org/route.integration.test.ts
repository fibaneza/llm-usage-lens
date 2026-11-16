import { describe, expect, it, vi } from "vitest";

import {
  DATES,
  LTEAM,
  call,
  expectError,
  expectNoSentinels,
  installFake,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import { signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "Views by role (L3b)" (Organisation
// tab: totals across every linked team via getTeamDailySpend with all linked
// team_ids, per-team table of spend, budget, members), "API routes"
// (/api/litellm/org GET: org-admin, Admin, Auditor), "Reads" (timezone=0, LD20),
// error codes, LD19, LT11, Rules 10.3, 60.23.
//
// Contract for the developer (.../org/route.ts, GET):
//   query: dateFrom, dateTo (DateRangeQuerySchema, 90-day cap -> 400).
//   200 data = { totals: { spend: number },
//                daily: [{ date, spend, ... }],
//                teams: [{ teamId, teamName, spend, maxBudget, memberCount }],
//                enabledOperations: string[] }
//   `teams` lists only teams linked to LiteLLM, by DASHBOARD teamId (never a
//   LiteLLM id). Calls: ONE getTeamDailySpend (team_ids = every linked LiteLLM
//   team id, comma separated, timezone=0) + one getTeam per linked team.
//   org-admin, Admin, Auditor only; every other caller 403 FORBIDDEN, before
//   query parsing and before any LiteLLM call.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
const get = async (query = `?${DATES}`) => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, `/api/litellm/org${query}`);
};

describe("GET /api/litellm/org", () => {
  it("401 without a session, no-store (Rule 10.3)", async () => {
    signInAs(null);
    const { res } = await get();
    await expectError(res, 401, "UNAUTHORIZED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each([
    ["orgAdmin", true],
    ["admin", true],
    ["auditor", true],
    ["teamAdminA", false],
    ["deptAdminEng", false],
    ["memberA", false],
    ["viewerNone", false],
    ["noRole", false],
  ] as Array<[CallerName | "noRole", boolean]>)(
    "%s -> allowed: %s (API routes: org-admin, Admin, Auditor)",
    async (who, allowed) => {
      if (who === "noRole") await signInWithRoles([]);
      else signInAs(who);
      const { res, body } = await get();
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      if (allowed) {
        expect(res.status).toBe(200);
        expect(body.data).toBeDefined();
      } else {
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
      }
    },
  );

  it("403 comes before input parsing: a refused caller with a bad range still gets 403 (Rule 10.3)", async () => {
    signInAs("teamAdminA");
    const { res } = await get("?dateFrom=2026-01-01&dateTo=2026-06-01");
    await expectError(res, 403, "FORBIDDEN");
  });

  it("totals come from ONE getTeamDailySpend call carrying every linked team id, in UTC (Views: Organisation; LD20)", async () => {
    signInAs("orgAdmin");
    const { body } = await get();
    const daily = state.fake.calls.filter(
      (c) => c.path === "/team/daily/activity/aggregated",
    );
    expect(daily).toHaveLength(1);
    const q = new URL(daily[0]!.url).searchParams;
    expect(q.get("timezone")).toBe("0");
    expect(q.get("start_date")).toBe("2026-11-01");
    expect(q.get("end_date")).toBe("2026-11-14");
    const ids = (q.get("team_ids") ?? "").split(",").sort();
    expect(ids).toEqual(Object.values(LTEAM).sort());
    expect(body.data.totals.spend).toBe(1.5);
    expect(body.data.daily[0]).toMatchObject({
      date: "2026-11-02",
      spend: 1.5,
    });
  });

  it("the per-team table lists each linked team by dashboard id with spend, budget and members; the unlinked team and LiteLLM ids are absent (Views: Organisation; identity mapping)", async () => {
    signInAs("auditor");
    const { body, text } = await get();
    const rows = body.data.teams as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.teamId).sort()).toEqual([
      "team-a",
      "team-b",
      "team-c",
      "team-m",
    ]);
    expect(rows[0]).toMatchObject({
      spend: 12.5,
      maxBudget: 100,
      memberCount: 1,
    });
    expect(rows.every((r) => typeof r.teamName === "string")).toBe(true);
    for (const id of Object.values(LTEAM)) expect(text).not.toContain(id);
    expectNoSentinels(body);
  });

  it("reports enabledOperations (Toggles narrow only)", async () => {
    signInAs("admin");
    const { body } = await get();
    expect(body.data.enabledOperations).toContain("getTeamDailySpend");
  });

  it("a disabled getTeamDailySpend is 403 OPERATION_DISABLED before any LiteLLM call (LD19)", async () => {
    await setToggles({ getTeamDailySpend: false });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res, text } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });

  it("400 BAD_REQUEST for a range over 90 days, no LiteLLM call (Rule 20.8)", async () => {
    signInAs("admin");
    const { res } = await get("?dateFrom=2026-01-01&dateTo=2026-06-01");
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });
});
