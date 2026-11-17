import { MemberSumSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import { getIdentityLink } from "@/lib/data/access/identity-links";
import { clearTable } from "@/test/support/test-support";
import {
  DATES,
  LTEAM,
  call,
  defineTeamReadContract,
  enterProd,
  expectError,
  expectNoSentinels,
  seedViews,
  setToggles,
  setupViewsSuite,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import {
  SCENARIO,
  SCENARIO_FAKE,
  installMemberSumFake,
  seedBoundMember,
  seedScenario,
  seedUnlinkedTeam,
  userDailyCalls,
  userIdsRead,
} from "@/test/support/member-sum-support";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId] GET: Lead in scope, Admin, Auditor), "Reads" (getTeam, getTeamDailySpend
// with timezone=0 per LD20), "Roles and rights", "Identity mapping and members"
// ("not connected"), "Cost visualisation and provenance" (loose rows reduced),
// implementation-phases L3 Verify (role x read matrix, 404 parity), Rules 10.3, 60.23.
//
// Contract for the developer (apps/dashboard/app/api/litellm/teams/[teamId]/route.ts, GET):
//   query: dateFrom, dateTo (DateRangeQuerySchema, 90-day cap -> 400).
//   (L4b amends the unlinked case: see "spend source" at the end of this file.)
//   200 data = { connected: false, spendSource, ... } for an in-scope unlinked team, else
//   { connected: true,
//     team: { alias, spend, maxBudget, softBudget, budgetDuration, models, rpmLimit, tpmLimit },
//     daily: [{ date, spend, ... }],           // allowlisted fields only
//     enabledOperations: string[] }.
//   Out of scope, missing, Viewer/member, no role: 404 NOT_FOUND (same body).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
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
  unconfiguredIs200: true,
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

// ---- L4b: app-team spend (docs/specs/2026-11-17-app-teams.md) ----------------
//
// Contract for the developer (same route, GET):
//   Always returns `spendSource`.
//   Linked team   -> { connected: true, spendSource: "litellm-team", team, daily,
//                      enabledOperations }; plus `memberSum` only when the query
//                      has include=memberSum AND the caller is Admin, org-admin or
//                      Auditor (ATT6: ignored for a Lead).
//   Unlinked team -> { connected: false, spendSource: "member-sum", daily,
//                      memberSum: { total, daily, coverage, members } }, `daily`
//                      being the member-sum days. No getTeam/getTeamDailySpend
//                      call. 422 TOO_MANY_MEMBERS above 200 members, no LiteLLM
//                      call; any failed member read -> the standard 503; the
//                      getUserDailySpend toggle off -> 403 OPERATION_DISABLED.
//   Scoping is resolveLiteLLMTeam's, unchanged (out of scope = missing = 404).
describe("GET /api/litellm/teams/[teamId] - spend source (App Teams)", () => {
  const get = async (team: string, query = `?${DATES}`) =>
    call(await load(), `/api/litellm/teams/${team}${query}`, { teamId: team });

  describe("unlinked team: the member sum", () => {
    it("a Lead in scope gets spendSource member-sum, daily rows, a total equal to the member rows and the coverage counts (Spend source; Verify 1)", async () => {
      await seedScenario();
      installMemberSumFake(state, SCENARIO_FAKE);
      signInAs("deptAdminEng");
      const { res, body } = await get("team-u");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(body.data).toMatchObject({
        connected: false,
        spendSource: "member-sum",
      });
      expect(body.data).not.toHaveProperty("team");
      expect(body.data.daily).toMatchObject(SCENARIO.daily);
      const sum = MemberSumSchema.parse(body.data.memberSum);
      expect(sum.total).toBe(SCENARIO.total);
      expect(sum.coverage).toEqual(SCENARIO.coverage);
      const rows = sum.members.flatMap((m) =>
        m.spend === undefined ? [] : [m.spend],
      );
      expect(rows.reduce((a, b) => a + b, 0)).toBe(sum.total);
      expectNoSentinels(body);
    });

    it("reads only the requested team's members, in UTC for the range, and never the team's LiteLLM views (ATT1; LD20)", async () => {
      await seedScenario();
      installMemberSumFake(state, SCENARIO_FAKE);
      signInAs("deptAdminEng");
      await get("team-u");
      expect(userIdsRead(state)).toEqual(
        [SCENARIO.luserU1, SCENARIO.luserU2].sort(),
      );
      const q = new URL(userDailyCalls(state)[0]!.url).searchParams;
      expect(q.get("timezone")).toBe("0");
      expect(q.get("start_date")).toBe("2026-11-01");
      expect(q.get("end_date")).toBe("2026-11-14");
      expect(state.fake.calls.some((c) => c.path.startsWith("/team/"))).toBe(
        false,
      );
      expect(await getIdentityLink(SCENARIO.u2.oid)).toBeNull();
    });

    it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
      "%s reads the same member sum for an unlinked team",
      async (who) => {
        await seedScenario();
        installMemberSumFake(state, SCENARIO_FAKE);
        signInAs(who);
        const { res, body } = await get("team-u");
        expect(res.status).toBe(200);
        expect(body.data.spendSource).toBe("member-sum");
        expect(body.data.memberSum.total).toBe(SCENARIO.total);
      },
    );

    it("a team with no members is a zero sum, not an error (Member sum step 1)", async () => {
      installMemberSumFake(state);
      signInAs("admin");
      const { res, body } = await get("team-u");
      expect(res.status).toBe(200);
      expect(body.data.memberSum).toMatchObject({
        total: 0,
        coverage: { members: 0, matched: 0, unmatched: 0, pending: 0 },
      });
    });

    it("an out-of-scope or missing unlinked team answers the same 404 and reads no member (ATT1; Enforcement 2)", async () => {
      await seedScenario();
      installMemberSumFake(state, SCENARIO_FAKE);
      signInAs("teamAdminA");
      const outOfScope = await get("team-u");
      const missing = await get("team-zzz");
      expect(outOfScope.res.status).toBe(404);
      expect(outOfScope.text).toBe(missing.text);
      expect(state.fake.calls).toHaveLength(0);
    });

    it.each(["memberA", "viewerNone"] as CallerName[])(
      "%s (a Viewer) gets no team view of an unlinked team: 404 and no LiteLLM call (Roles and rights)",
      async (who) => {
        await seedScenario();
        installMemberSumFake(state, SCENARIO_FAKE);
        signInAs(who);
        const { res } = await get("team-u");
        await expectError(res, 404, "NOT_FOUND");
        expect(state.fake.calls).toHaveLength(0);
      },
    );

    it("201 members is 422 TOO_MANY_MEMBERS with no LiteLLM call (AT6, ATT3)", async () => {
      await seedUnlinkedTeam("team-big", 6);
      for (let n = 1; n <= 201; n += 1) {
        await seedBoundMember("team-big", {
          oid: `oid-big-${n}`,
          litellmUserId: `lu-big-${n}`,
        });
      }
      installMemberSumFake(state);
      signInAs("admin");
      const { res } = await get("team-big");
      await expectError(res, 422, "TOO_MANY_MEMBERS");
      expect(state.fake.calls).toHaveLength(0);
    });

    it("one failing member read fails the request: 503, no partial sum (AT7)", async () => {
      await seedScenario();
      installMemberSumFake(state, {
        ...SCENARIO_FAKE,
        failUsers: [SCENARIO.luserU1],
      });
      signInAs("admin");
      const { res, text } = await get("team-u");
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
      expect(text).not.toContain("memberSum");
    });

    it("getUserDailySpend off is 403 OPERATION_DISABLED before any LiteLLM call (step 7; LD19)", async () => {
      await seedScenario();
      await setToggles({ getUserDailySpend: false });
      installMemberSumFake(state, SCENARIO_FAKE);
      signInAs("admin");
      const { res } = await get("team-u");
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
    });

    it("a range over 90 days is 400 and reads no member (Rule 20.8)", async () => {
      await seedScenario();
      installMemberSumFake(state, SCENARIO_FAKE);
      signInAs("admin");
      const { res } = await get(
        "team-u",
        "?dateFrom=2026-01-01&dateTo=2026-06-01",
      );
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    });
  });

  describe("Organisation cap on the member rows (AT3; LD23)", () => {
    it("in prod without the per-user approval the member rows carry no spend but the total is present", async () => {
      await seedScenario();
      await enterProd();
      installMemberSumFake(state, SCENARIO_FAKE);
      signInAs("deptAdminEng");
      const { res, body } = await get("team-u");
      expect(res.status).toBe(200);
      expect(body.data.memberSum.total).toBe(SCENARIO.total);
      expect(body.data.memberSum.members).toHaveLength(3);
      for (const m of body.data.memberSum.members) {
        expect(m).not.toHaveProperty("spend");
      }
    });

    it("with the approval recorded the member rows carry their spend", async () => {
      await seedScenario();
      await enterProd({ approved: true });
      installMemberSumFake(state, SCENARIO_FAKE);
      signInAs("deptAdminEng");
      const { body } = await get("team-u");
      const spends = body.data.memberSum.members
        .filter((m: { matched: boolean }) => m.matched)
        .map((m: { spend: number }) => m.spend)
        .sort();
      expect(spends).toEqual([0.5, 3.5]);
    });
  });

  describe("linked team: the LiteLLM team figure first (AT1; ATT6)", () => {
    const withMemberA = () =>
      installMemberSumFake(state, {
        daily: { "a1@company.com": [{ date: "2026-11-02", spend: 2.25 }] },
      });

    it.each([
      ["without include", `?${DATES}`],
      ["with include=memberSum", `?${DATES}&include=memberSum`],
    ])(
      "a Lead gets the LiteLLM team figures and no memberSum %s, and no member is read (AT1, ATT6)",
      async (_n, query) => {
        withMemberA();
        signInAs("teamAdminA");
        const { res, body } = await get("team-a", query);
        expect(res.status).toBe(200);
        expect(body.data).toMatchObject({
          connected: true,
          spendSource: "litellm-team",
        });
        expect(body.data.team.spend).toBe(12.5);
        expect(body.data).not.toHaveProperty("memberSum");
        expect(userDailyCalls(state)).toHaveLength(0);
      },
    );

    it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
      "%s with include=memberSum gets the team figure and the member sum",
      async (who) => {
        withMemberA();
        signInAs(who);
        const { body } = await get("team-a", `?${DATES}&include=memberSum`);
        expect(body.data.spendSource).toBe("litellm-team");
        expect(body.data.team.spend).toBe(12.5);
        const sum = MemberSumSchema.parse(body.data.memberSum);
        expect(sum.total).toBe(2.25);
        expect(sum.coverage).toMatchObject({
          members: 1,
          matched: 1,
          unmatched: 0,
          pending: 0,
        });
        expect(sum.members[0]).toMatchObject({
          oid: CALLERS.memberA.oid,
          matched: true,
        });
        expect(userIdsRead(state)).toEqual(["a1@company.com"]);
      },
    );

    it("an admin without include=memberSum gets no member sum and no member read (on request only)", async () => {
      withMemberA();
      signInAs("admin");
      const { body } = await get("team-a");
      expect(body.data).not.toHaveProperty("memberSum");
      expect(userDailyCalls(state)).toHaveLength(0);
    });

    it("include=memberSum with getUserDailySpend off is 403 OPERATION_DISABLED, as every read (step 7)", async () => {
      await setToggles({ getUserDailySpend: false });
      withMemberA();
      signInAs("admin");
      const { res } = await get("team-a", `?${DATES}&include=memberSum`);
      await expectError(res, 403, "OPERATION_DISABLED");
    });

    // Q1 (LD36): the page's "Spend" is the range, i.e. the sum of `daily`;
    // `team.spend` stays LiteLLM's budget-period figure for the BudgetBar only.
    it("Q1: daily is the range spend of the linked team and team.spend stays the budget-period figure (LD36)", async () => {
      installMemberSumFake(state, {
        teamDaily: { [LTEAM["team-a"]]: 2 },
      });
      signInAs("admin");
      const { body } = await get("team-a");
      expect(
        body.data.daily.reduce(
          (s: number, d: { spend: number }) => s + d.spend,
          0,
        ),
      ).toBe(2);
      expect(body.data.team.spend).toBe(12.5);
    });

    it("an include value other than memberSum is 400 BAD_REQUEST in the standard error shape and reads nothing (API changes; Rule 60.16)", async () => {
      signInAs("admin");
      const { res } = await get("team-a", `?${DATES}&include=other`);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    });

    it("a linked team still reads only its own LiteLLM team (identity mapping)", async () => {
      withMemberA();
      signInAs("admin");
      await get("team-b", `?${DATES}&include=memberSum`);
      const urls = JSON.stringify(state.fake.calls.map((c) => c.url));
      expect(urls).toContain(LTEAM["team-b"]);
      expect(urls).not.toContain(LTEAM["team-a"]);
    });
  });
});

// LD37 (docs/specs/2026-11-10-litellm.md, Decisions; Design System - LiteLLM
// Page, States). Contract: when no connection is stored (or no service key) the
// route answers 200 `{ configured: false, connected: <team has a link>,
// spendSource: "litellm-team" | "member-sum", daily: [] }` with no `team`, no
// `memberSum` and no LiteLLM call. A configured response omits the marker.
describe("GET /api/litellm/teams/[teamId] - LiteLLM not configured (LD37)", () => {
  const get = async (team: string) =>
    call(await load(), `/api/litellm/teams/${team}?${DATES}`, { teamId: team });

  it.each([
    ["an unlinked team", "team-u", false, "member-sum"],
    ["a linked team", "team-a", true, "litellm-team"],
  ] as const)(
    "%s: no stored connection is 200 configured:false and no LiteLLM call (LD37)",
    async (_n, team, connected, spendSource) => {
      await clearTable();
      await seedViews({ connection: false });
      signInAs("admin");
      const { res, body } = await get(team);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(body.data).toMatchObject({
        configured: false,
        connected,
        spendSource,
        daily: [],
      });
      expect(body.data).not.toHaveProperty("team");
      expect(body.data).not.toHaveProperty("memberSum");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("an out-of-scope team is still the 404 when not configured (Enforcement 2)", async () => {
    await clearTable();
    await seedViews({ connection: false });
    signInAs("teamAdminA");
    const { res } = await get("team-b");
    await expectError(res, 404, "NOT_FOUND");
  });

  it("a configured response does not carry configured:false (LD37)", async () => {
    signInAs("admin");
    const { body } = await get("team-a");
    expect(body.data.configured).not.toBe(false);
  });
});
