import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DATES,
  LTEAM,
  SHARED_ALIAS,
  UNLINKED_LTEAM,
  call,
  expectError,
  expectNoSentinels,
  installFake,
  seedViews,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import { createAppTeam } from "@/lib/data/access/app-teams";
import { putTeamLink } from "@/lib/data/litellm/team-links";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { signInAs } from "@/test/fixtures/scope-fixtures";
import { clearTable } from "@/test/support/test-support";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import {
  SCENARIO,
  SCENARIO_FAKE,
  TEAM_DAILY_SPEND,
  TEAM_DAILY_TOTAL,
  installMemberSumFake,
  seedBoundMember,
  seedLinkedMembers,
  seedScenario,
  seedUnlinkedTeam,
  userIdsRead,
} from "@/test/support/member-sum-support";
import { holdFetch, macrotask, trackSettled } from "@/test/support/fetch-hold";

// Source: docs/specs/2026-11-10-litellm.md — "Views by role (L3b)" (Organisation
// tab: totals across every linked team via getTeamDailySpend with all linked
// team_ids, per-team table of spend, budget, members), "API routes"
// (/api/litellm/org GET: org-admin, Admin, Auditor), "Reads" (timezone=0, LD20),
// error codes, LD19, LT11, Rules 10.3, 60.23.
//
// Contract for the developer (.../org/route.ts, GET):
//   query: dateFrom, dateTo (DateRangeQuerySchema, 90-day cap -> 400).
//   The 200 shape is the L4b one (docs/specs/2026-11-17-app-teams.md -
//   Organisation view), described above the first L4b case below; it replaced
//   the L3b `teams[]` table.
//   org-admin, Admin, Auditor only; every other caller 403 FORBIDDEN, before
//   query parsing and before any LiteLLM call.
const authMock = vi.hoisted(() => vi.fn());
// Counts membership reads per team and lets a test change what a later read
// returns (Q2: membership is read once per team, LD34). Plain functions, so
// vi.restoreAllMocks cannot unset the pass-through.
const membership = vi.hoisted(() => ({
  reads: [] as string[],
  override: null as null | ((teamId: string, nth: number) => string[] | null),
}));
vi.mock("@/lib/data/access/team-member-lookup", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/data/access/team-member-lookup")
    >();
  return {
    ...actual,
    listAllTeamMemberOids: async (teamId: string) => {
      membership.reads.push(teamId);
      const nth = membership.reads.filter((t) => t === teamId).length;
      return (
        membership.override?.(teamId, nth) ??
        actual.listAllTeamMemberOids(teamId)
      );
    },
  };
});
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
beforeEach(() => {
  membership.reads.length = 0;
  membership.override = null;
});
// The views fake plus range spend that differs per team (LD36).
const withRangeSpend = () =>
  installMemberSumFake(state, { teamDaily: TEAM_DAILY_SPEND });
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

  // L4b (docs/specs/2026-11-17-app-teams.md - Organisation view, AT5):
  //   200 data = { totals: { spend }, daily, enabledOperations,
  //     litellmTeams: [{ litellmTeamId, alias, spend, maxBudget, memberCount,
  //                      linkedAppTeam: { teamId, teamName } | null }],
  //     appTeams: [{ teamId, teamName, spendSource, spend: number | null,
  //                  reason?: "open-team", coverage? }] }          (no `teams`)
  //   Calls: one listProxyTeams, ONE getTeamDailySpend with every proxy team id
  //   (linked or not), one getTeam per proxy team. The total is the LiteLLM
  //   teams' total, never a sum of app teams. A linked app team's spend is its
  //   LiteLLM team row; an unlinked team's is its member sum (coverage given);
  //   unlinked teams are summed smallest first within 200 member reads in all,
  //   and a team that does not fit is `spend: null, reason: "open-team"`.
  // Amended 2026-11-17 (LD36, L4b round 1): the rows are range spend from one
  // getTeamDailySpend read per proxy team, so the old single all-teams call
  // is no longer the contract. Reads stay UTC and in the selected range (LD20).
  it("range spend is read per proxy team, linked or not, in UTC for the range, one listProxyTeams (AT5; LD20; LD36)", async () => {
    withRangeSpend();
    signInAs("orgAdmin");
    await get();
    const lists = state.fake.calls.filter((c) => c.path === "/team/list");
    expect(lists).toHaveLength(1);
    const daily = state.fake.calls.filter(
      (c) => c.path === "/team/daily/activity/aggregated",
    );
    const covered = new Set<string>();
    for (const c of daily) {
      const q = new URL(c.url).searchParams;
      expect(q.get("timezone")).toBe("0");
      expect(q.get("start_date")).toBe("2026-11-01");
      expect(q.get("end_date")).toBe("2026-11-14");
      const ids = (q.get("team_ids") ?? "").split(",");
      if (ids.length === 1) covered.add(ids[0] ?? "");
    }
    expect([...covered].sort()).toEqual(
      [...Object.values(LTEAM), UNLINKED_LTEAM].sort(),
    );
  });

  // Q1 (LD36; app-teams - Organisation view; LT27): every Spend figure is the
  // selected range. The views fake's team_info.spend is 12.5 for every team, so
  // the budget-period figure cannot pass for a range figure.
  it("Q1: totals.spend equals the sum of the LiteLLM teams rows for the range, and each row is that team's range spend, not team_info.spend (LD36; LT27)", async () => {
    withRangeSpend();
    signInAs("orgAdmin");
    const { body } = await get();
    const rows = body.data.litellmTeams as Array<{
      litellmTeamId: string;
      spend: number;
    }>;
    for (const r of rows) {
      expect(r.spend, r.litellmTeamId).toBe(
        TEAM_DAILY_SPEND[r.litellmTeamId as keyof typeof TEAM_DAILY_SPEND],
      );
    }
    const rowSum = rows.reduce((sum, r) => sum + r.spend, 0);
    expect(rowSum).toBe(TEAM_DAILY_TOTAL);
    expect(body.data.totals.spend).toBe(rowSum);
    expect(body.data.daily[0]).toMatchObject({
      date: "2026-11-02",
      spend: TEAM_DAILY_TOTAL,
    });
    expect(body.data).not.toHaveProperty("teams");
  });

  it("Q1: a linked app team row carries its LiteLLM team's range spend from getTeamDailySpend, not team_info.spend (LD36; Organisation view)", async () => {
    withRangeSpend();
    signInAs("auditor");
    const { body } = await get();
    const rows = body.data.appTeams as Array<Record<string, unknown>>;
    const spendOf = (id: string) => rows.find((r) => r.teamId === id)?.spend;
    expect(spendOf("team-a")).toBe(2);
    expect(spendOf("team-b")).toBe(3);
    expect(spendOf("team-c")).toBe(0.5);
    expect(spendOf("team-m")).toBe(0.25);
  });

  it("the LiteLLM teams table lists every proxy team with alias, range spend, budget and members; an unlinked LiteLLM team appears with no app team (Organisation view; LD36)", async () => {
    withRangeSpend();
    signInAs("auditor");
    const { body } = await get();
    const rows = body.data.litellmTeams as Array<{
      litellmTeamId: string;
      alias: string | null;
      spend: number;
      maxBudget: number | null;
      memberCount: number;
      linkedAppTeam: { teamId: string; teamName: string } | null;
    }>;
    expect(rows.map((r) => r.litellmTeamId).sort()).toEqual(
      [...Object.values(LTEAM), UNLINKED_LTEAM].sort(),
    );
    const linked = rows.find((r) => r.litellmTeamId === LTEAM["team-a"])!;
    expect(linked).toMatchObject({
      alias: "Alpha",
      spend: 2,
      maxBudget: 100,
      memberCount: 1,
      linkedAppTeam: { teamId: "team-a", teamName: "A" },
    });
    const shared = rows.find((r) => r.litellmTeamId === UNLINKED_LTEAM)!;
    expect(shared).toMatchObject({ alias: SHARED_ALIAS, linkedAppTeam: null });
    expectNoSentinels(body);
  });

  it("the app teams table lists every app team: a linked team carries its LiteLLM team row's spend, an unlinked team its member sum with coverage (Organisation view)", async () => {
    await seedScenario();
    installMemberSumFake(state, {
      ...SCENARIO_FAKE,
      teamDaily: TEAM_DAILY_SPEND,
    });
    signInAs("admin");
    const { body } = await get();
    const rows = body.data.appTeams as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.teamId).sort()).toEqual([
      "team-a",
      "team-b",
      "team-c",
      "team-m",
      "team-u",
    ]);
    const a = rows.find((r) => r.teamId === "team-a")!;
    expect(a).toMatchObject({
      teamName: "A",
      spendSource: "litellm-team",
      spend: 2,
    });
    const u = rows.find((r) => r.teamId === "team-u")!;
    expect(u).toMatchObject({
      spendSource: "member-sum",
      spend: SCENARIO.total,
      coverage: SCENARIO.coverage,
    });
    expect(u).not.toHaveProperty("reason");
  });

  // Source: docs/specs/2026-11-17-app-teams.md - "Teams without an AWS account"
  // and "Organisation view" (the app teams table lists every app team; an
  // unlinked one shows the member sum, source "Sum of members"; a team with no
  // AWS account has no Bedrock figure). The route builds appTeams from the team
  // directory (M2 design 1, group M2-b).
  describe("a created team (App Teams; Organisation view)", () => {
    const makeCreated = async () =>
      ok(
        await createAppTeam(
          {
            name: "Guild",
            departmentId: "dept-eng",
            departmentName: "Engineering",
          },
          ctxAt(undefined, "req-org-created"),
        ),
      ).teamId;

    it("an unlinked created team is listed with the member-sum source and its members' spend, and only the app-team fields (no Bedrock figure)", async () => {
      const created = await makeCreated();
      await seedBoundMember(created, {
        oid: "oid-guild-1",
        litellmUserId: SCENARIO.luserU1,
      });
      installMemberSumFake(state, {
        ...SCENARIO_FAKE,
        teamDaily: TEAM_DAILY_SPEND,
      });
      signInAs("admin");
      const { res, body } = await get();
      expect(res.status).toBe(200);
      const row = (body.data.appTeams as Array<Record<string, unknown>>).find(
        (r) => r.teamId === created,
      )!;
      expect(row).toMatchObject({
        teamName: "Guild",
        spendSource: "member-sum",
        spend: 3.5,
      });
      expect(Object.keys(row).sort()).toEqual([
        "coverage",
        "spend",
        "spendSource",
        "teamId",
        "teamName",
      ]);
      expect(body.data.totals.spend).toBe(TEAM_DAILY_TOTAL);
    });

    it("a created team linked to a LiteLLM team shows that team's range spend, and the LiteLLM row names the created team (Organisation view)", async () => {
      const created = await makeCreated();
      ok(
        await putTeamLink(
          {
            teamId: created,
            litellmTeamId: UNLINKED_LTEAM,
            version: null,
          },
          ctxAt(undefined, "req-org-created-link"),
        ),
      );
      installMemberSumFake(state, {
        ...SCENARIO_FAKE,
        teamDaily: TEAM_DAILY_SPEND,
      });
      signInAs("orgAdmin");
      const { body } = await get();
      const row = (body.data.appTeams as Array<Record<string, unknown>>).find(
        (r) => r.teamId === created,
      );
      expect(row).toMatchObject({
        teamName: "Guild",
        spendSource: "litellm-team",
        spend: TEAM_DAILY_SPEND[UNLINKED_LTEAM],
      });
      const lrow = (
        body.data.litellmTeams as Array<{
          litellmTeamId: string;
          linkedAppTeam: unknown;
        }>
      ).find((t) => t.litellmTeamId === UNLINKED_LTEAM);
      expect(lrow?.linkedAppTeam).toEqual({
        teamId: created,
        teamName: "Guild",
      });
    });
  });

  it("the headline total never includes the app teams' member sums: an unlinked team with spend leaves it unchanged (AT5, ATT5)", async () => {
    await seedScenario();
    installMemberSumFake(state, {
      ...SCENARIO_FAKE,
      teamDaily: TEAM_DAILY_SPEND,
    });
    signInAs("admin");
    const { body } = await get();
    expect(body.data.totals.spend).toBe(TEAM_DAILY_TOTAL);
    const appSum = (body.data.appTeams as Array<{ spend: number | null }>)
      .map((r) => r.spend ?? 0)
      .reduce((a, b) => a + b, 0);
    expect(appSum).not.toBe(body.data.totals.spend);
  });

  describe("read budget: 200 member reads per request (AT6)", () => {
    it("sums unlinked teams smallest first; a team that does not fit is spend null with reason open-team", async () => {
      await seedScenario();
      await seedUnlinkedTeam("team-y", 6);
      await seedUnlinkedTeam("team-x", 7);
      await seedUnlinkedTeam("team-z", 8);
      await seedLinkedMembers("team-y", 60);
      await seedLinkedMembers("team-x", 150);
      for (let n = 1; n <= 201; n += 1) {
        await seedBoundMember("team-z", {
          oid: `oid-z-${n}`,
          litellmUserId: `lu-z-${n}`,
        });
      }
      const tracker = installMemberSumFake(state, SCENARIO_FAKE);
      signInAs("admin");
      const { res, body } = await get();
      expect(res.status).toBe(200);
      const rows = body.data.appTeams as Array<Record<string, unknown>>;
      const byId = (id: string) => rows.find((r) => r.teamId === id)!;
      expect(byId("team-u").spend).toBe(SCENARIO.total);
      expect(byId("team-y")).toMatchObject({ spendSource: "member-sum" });
      expect(typeof byId("team-y").spend).toBe("number");
      for (const id of ["team-x", "team-z"]) {
        expect(byId(id)).toMatchObject({
          spendSource: "member-sum",
          spend: null,
          reason: "open-team",
        });
      }
      const reads = state.fake.calls.filter(
        (c) => c.path === "/user/daily/activity",
      );
      expect(reads.length).toBeLessThanOrEqual(200);
      expect(reads).toHaveLength(2 + 60);
      expect(tracker.max).toBeLessThanOrEqual(5);
    });

    it("a team over the 200-member cap is an open-team row here, not a 422 (Organisation view; the 422 is the Team page's)", async () => {
      await seedUnlinkedTeam("team-z", 8);
      for (let n = 1; n <= 201; n += 1) {
        await seedBoundMember("team-z", {
          oid: `oid-z-${n}`,
          litellmUserId: `lu-z-${n}`,
        });
      }
      installMemberSumFake(state);
      signInAs("admin");
      const { res, body } = await get();
      expect(res.status).toBe(200);
      const z = (body.data.appTeams as Array<Record<string, unknown>>).find(
        (r) => r.teamId === "team-z",
      );
      expect(z).toMatchObject({ spend: null, reason: "open-team" });
    });
  });

  // Q2 (LD34 amended 2026-11-17): membership is read once per team and the
  // list is passed to the sum, so a team that crosses 200 between two reads is
  // judged on the one read. The override makes any second read return 201
  // members; the old code's second read threw TOO_MANY_MEMBERS (a 422 for the
  // whole Organisation view).
  it("Q2: membership is read once per team; a second read that would show 201 members changes nothing, no 422 (LD34; Organisation view)", async () => {
    await seedUnlinkedTeam("team-w", 7);
    await seedLinkedMembers("team-w", 150);
    membership.override = (teamId, nth) =>
      teamId === "team-w" && nth >= 2
        ? Array.from({ length: 201 }, (_, n) => `oid-late-${n}`)
        : null;
    installMemberSumFake(state);
    signInAs("admin");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(membership.reads.filter((t) => t === "team-w")).toHaveLength(1);
    const w = (body.data.appTeams as Array<Record<string, unknown>>).find(
      (r) => r.teamId === "team-w",
    );
    expect(w).toMatchObject({ spendSource: "member-sum", spend: 0 });
    expect(w).not.toHaveProperty("reason");
  });

  it("Q2: a team seen at 201 members by its one read is an open-team row, never a 422 (LD34)", async () => {
    await seedUnlinkedTeam("team-w", 7);
    membership.override = (teamId, nth) =>
      teamId === "team-w" && nth === 1
        ? Array.from({ length: 201 }, (_, n) => `oid-late-${n}`)
        : null;
    installMemberSumFake(state);
    signInAs("admin");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(membership.reads.filter((t) => t === "team-w")).toHaveLength(1);
    const w = (body.data.appTeams as Array<Record<string, unknown>>).find(
      (r) => r.teamId === "team-w",
    );
    expect(w).toMatchObject({ spend: null, reason: "open-team" });
  });

  // Q3 (LD34 amended): the 200 counts every LiteLLM call. Each member below has
  // no stored LiteLLM user id, so reading one costs a findUserByEmail and a
  // spend read. 50 + 60 members is 110 spend reads (fits a spend-only count)
  // but 220 calls with the lookups (does not).
  it("Q3: email lookups and per-team daily reads count toward the 200-call budget; the team that does not fit is open-team and the request stays within 200 calls (LD34)", async () => {
    const emailLookup: Record<string, { user_id: string; user_email: string }> =
      {};
    const seedLookupTeam = async (
      teamId: string,
      account: number,
      n: number,
    ) => {
      await seedUnlinkedTeam(teamId, account);
      for (let i = 1; i <= n; i += 1) {
        const email = `${teamId}-${i}@company.com`;
        await seedBoundMember(teamId, { oid: `oid-${teamId}-${i}`, email });
        emailLookup[email] = {
          user_id: `lu-${teamId}-${i}`,
          user_email: email,
        };
      }
    };
    await seedLookupTeam("team-x", 7, 50);
    await seedLookupTeam("team-y", 8, 60);
    installMemberSumFake(state, { emailLookup, teamDaily: TEAM_DAILY_SPEND });
    signInAs("admin");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    const rows = body.data.appTeams as Array<Record<string, unknown>>;
    const byId = (id: string) => rows.find((r) => r.teamId === id);
    expect(typeof byId("team-x")?.spend).toBe("number");
    expect(byId("team-y")).toMatchObject({ spend: null, reason: "open-team" });
    expect(
      state.fake.calls.filter((c) => c.path === "/user/list").length,
    ).toBeGreaterThan(0);
    expect(state.fake.calls.length).toBeLessThanOrEqual(200);
  });

  // L6 review round 1, Q3 (LD34 amended; LiteLLM spec - Combined usage ->
  // LiteLLM reads used, Person): getUserDailySpend pages (page_size 1000,
  // has_more), and every page is one LiteLLM call against the 200 of a request.
  // Each member below has a stored LiteLLM user id and 3 pages of daily rows.
  // team-big (70 members) needs 210 page reads: it cannot fit in 200 under any
  // counting, so it is an open-team row (no partial sum) and the request stays
  // within 200 calls (LD34 amended 2026-11-17, L6 review round 2: the per-member
  // reservation in the sum bounds the request; a team that runs out partway is
  // open-team with no partial sum). team-small (2 members, 6 pages) always fits and is summed
  // over every page.
  describe("Q3: pages count toward the 200-call budget (LD34)", () => {
    it("a team whose paged member reads would exceed 200 calls is open-team, never a partial sum, and the request makes at most 200 calls", async () => {
      await seedUnlinkedTeam("team-small", 7);
      await seedUnlinkedTeam("team-big", 8);
      await seedLinkedMembers("team-small", 2);
      await seedLinkedMembers("team-big", 70);
      installMemberSumFake(state, {
        teamDaily: TEAM_DAILY_SPEND,
        pagedDaily: 3,
      });
      signInAs("admin");
      const { res, body } = await get();
      expect(res.status).toBe(200);
      const rows = body.data.appTeams as Array<Record<string, unknown>>;
      const byId = (id: string) => rows.find((r) => r.teamId === id);
      expect(byId("team-small")).toMatchObject({
        spendSource: "member-sum",
        spend: 6,
      });
      expect(byId("team-big")).toMatchObject({
        spendSource: "member-sum",
        spend: null,
        reason: "open-team",
      });
      expect(state.fake.calls.length).toBeLessThanOrEqual(200);
    });

    it("a team that fits is summed over every page of every member and each page is read (control)", async () => {
      await seedUnlinkedTeam("team-small", 7);
      await seedLinkedMembers("team-small", 5);
      installMemberSumFake(state, {
        teamDaily: TEAM_DAILY_SPEND,
        pagedDaily: 3,
      });
      signInAs("admin");
      const { body } = await get();
      const rows = body.data.appTeams as Array<Record<string, unknown>>;
      expect(rows.find((r) => r.teamId === "team-small")?.spend).toBe(15);
      expect(
        state.fake.calls.filter((c) => c.path === "/user/daily/activity"),
      ).toHaveLength(15);
    });
  });

  it("a failing member read fails the request: 503, no partial table (AT7)", async () => {
    await seedScenario();
    installMemberSumFake(state, {
      ...SCENARIO_FAKE,
      failUsers: [SCENARIO.luserU1],
    });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  // LT25 (amended 2026-11-17) / LD34: on the first failed read no new LiteLLM
  // read starts and the in-flight ones settle before the response. u1's read
  // fails while u2's email lookup is in flight (held); u2's spend read must
  // never start and the 503 must wait for the lookup.
  it("on a failed member read no new read starts and the response waits for the in-flight one (LT25; LD34; AT7)", async () => {
    await seedScenario();
    installMemberSumFake(state, {
      ...SCENARIO_FAKE,
      failUsers: [SCENARIO.luserU1],
    });
    const failing = holdFetch(
      (u) =>
        u.pathname === "/user/daily/activity" &&
        u.searchParams.get("user_id") === SCENARIO.luserU1,
    );
    const lookup = holdFetch(
      (u) =>
        u.pathname === "/user/list" &&
        u.searchParams.get("user_email") === SCENARIO.u2.email,
    );
    signInAs("admin");
    const request = get();
    const answered = trackSettled(request);
    await Promise.all([failing.arrived, lookup.arrived]);
    failing.release();
    await failing.settled;
    await macrotask();
    expect(answered()).toBe(false);
    lookup.release();
    const { res } = await request;
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    const atResponse = state.fake.calls.length;
    await macrotask();
    await macrotask();
    expect(state.fake.calls).toHaveLength(atResponse);
    expect(userIdsRead(state)).toEqual([SCENARIO.luserU1]);
  });

  it("a disabled listProxyTeams is 403 OPERATION_DISABLED before any LiteLLM call (Allowlist changes; LD19)", async () => {
    await setToggles({ listProxyTeams: false });
    signInAs("orgAdmin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
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

  // LD37 (docs/specs/2026-11-10-litellm.md, Decisions; Design System -
  // LiteLLM Page, States): not configured is an explicit 200 state, never a
  // silent empty and never a 503. Marker contract: `configured: false` is sent
  // only when not configured; a configured response carries `configured: true`
  // (asserted below). Genuine failures keep their 503 (Rule 60.17).
  describe("LiteLLM not configured (LD37; Design System - LiteLLM Page, States)", () => {
    const expectUnconfigured = async (data: Record<string, unknown>) => {
      expect(data.configured).toBe(false);
      expect(data.litellmTeams).toEqual([]);
      expect(data.totals).toEqual({ spend: 0 });
      expect(data.daily).toEqual([]);
      const rows = data.appTeams as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.teamId).sort()).toEqual([
        "team-a",
        "team-b",
        "team-c",
        "team-m",
        "team-u",
      ]);
      for (const r of rows) {
        expect(r.spend, String(r.teamId)).toBeNull();
        expect(r.spendSource).toBe(
          r.teamId === "team-u" ? "member-sum" : "litellm-team",
        );
      }
      expect(state.fake.calls).toHaveLength(0);
    };

    it.each(["orgAdmin", "admin", "auditor"] as const)(
      "%s: no stored connection is 200 configured:false, app teams with spend null, no LiteLLM call (LD37)",
      async (who) => {
        await clearTable();
        await seedViews({ connection: false });
        signInAs(who);
        const { res, body } = await get();
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        await expectUnconfigured(body.data);
      },
    );

    it("no service key is 200 configured:false with the same shape and no LiteLLM call (LD37)", async () => {
      useEnv({ LITELLM_SERVICE_KEY: "" });
      signInAs("admin");
      const { res, body } = await get();
      expect(res.status).toBe(200);
      await expectUnconfigured(body.data);
    });

    it("no stored connection with listProxyTeams disabled is 403 OPERATION_DISABLED, not configured:false (LD19 before LD37)", async () => {
      await clearTable();
      await seedViews({ connection: false });
      await setToggles({ listProxyTeams: false });
      signInAs("orgAdmin");
      const { res } = await get();
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
    });

    it("a configured response carries configured:true (LD37)", async () => {
      signInAs("admin");
      const { body } = await get();
      expect(body.data.configured).toBe(true);
    });

    it("a configured but unreachable LiteLLM is still 503 LITELLM_UNAVAILABLE (LD37; Rule 60.17)", async () => {
      installFake(state, { outage: true });
      signInAs("admin");
      const { res } = await get();
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
    });
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
