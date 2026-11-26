import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fakes/fake-litellm";
import { DATES, call } from "@/test/fakes/fake-litellm-views";
import {
  LTEAM,
  UNKNOWN_LTEAM,
  UNLINKED_LTEAM,
  enterProd,
  expectError,
  idWritesHandler,
  setToggles,
  setupIdWritesSuite,
  signIn,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-id-writes-support";
import type { Who } from "@/test/support/litellm-id-writes-support";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Sources: LiteLLM spec - "API routes" row GET /api/litellm/proxy-teams/
// [litellmTeamId]/daily (unit LP3, T-LP12; admin, org-admin, auditor; a Lead
// 403; `DateRangeQuerySchema` 90-day cap; one `getTeamDailySpend` call; answer
// `litellmTeamId`, `daily[]` of date, spend, requests, tokens, `enabledOperations`;
// `daily` omitted while the cap hides cost, LD23; not configured 200, an empty
// list, no call, LD37; the operation off 403 before any call, LD19; an unknown
// team answers an empty list with no existence call, D-P-10; no key, key alias,
// user, member or per-user figure, LT1), "Reads" (timezone=0, LD20). The 401,
// 400-on-a-bad-range, no-store and viewer 403-before-parsing cases are the shared
// route-contract suite's (Rule 60.23; entry in test/route-registry.ts).
//
// Guard order, as the sibling ../route.ts: openModeRefusal(), then
// teamAccess().orgWide else 403 (before the id and the range are parsed), then
// parseInput(PathLiteLLMId), then the range through DateRangeQuerySchema, then
// requireEnabled(["getTeamDailySpend"]), then isLiteLLMConfigured (no call),
// then perUserCostHidden (no daily, no call), then one getTeamDailySpend.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const KEY_ALIAS = "DAILY-SENTINEL";

// The id fake's team daily row carries an api_keys breakdown with a key alias
// and a raw_secret field that must never reach the answer (LT1). The unknown
// team gets what LiteLLM answers for a team with no spend: no rows.
function teamDailyHandler(): FakeHandler {
  const base = idWritesHandler();
  return (c: FakeCall, attempt: number) => {
    if (
      `${c.method} ${c.path}` === "GET /team/daily/activity/aggregated" &&
      new URL(c.url).searchParams.get("team_ids") === UNKNOWN_LTEAM
    ) {
      return { status: 200, body: { results: [], metadata: {} } };
    }
    return base(c, attempt);
  };
}

const state = setupIdWritesSuite();
const get = async (team: string, query = DATES) => {
  stubLiteLLMEnv();
  state.fake = createFakeLiteLLM(teamDailyHandler());
  vi.stubGlobal("fetch", state.fake.fetch);
  const { GET } = await import("./route");
  return call(
    GET,
    `/api/litellm/proxy-teams/${encodeURIComponent(team)}/daily?${query}`,
    { litellmTeamId: team },
  );
};
const dailyCalls = () =>
  state.fake.calls.filter((c) => c.path === "/team/daily/activity/aggregated");

describe("GET /api/litellm/proxy-teams/[litellmTeamId]/daily (T-LP12)", () => {
  // Complete role matrix (security, Rule 60.24a). Guard: teamAccess().orgWide.
  const MATRIX: Array<[Who, 200 | 403]> = [
    ["admin", 200],
    ["orgAdmin", 200],
    ["auditor", 200],
    ["teamAdminA", 403],
    ["deptAdminEng", 403],
    ["memberA", 403],
    ["noRole", 403],
  ];
  it.each(MATRIX)(
    "%s is %s (T-LP12; LiteLLM spec API routes; guard: orgWide, before parsing)",
    async (who, status) => {
      await signIn(who);
      const { res } = await get(LTEAM["team-a"]);
      if (status === 200) expect(res.status).toBe(200);
      else {
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
      }
    },
  );

  it.each(["teamAdminA", "memberA"] as const)(
    "%s with a malformed id and a range over 90 days still gets 403, not 400 (T-LP12: 403 before input parsing)",
    async (who) => {
      await signIn(who);
      const { res } = await get(
        "../team/delete",
        "dateFrom=2026-01-01&dateTo=2026-11-14",
      );
      await expectError(res, 403, "FORBIDDEN");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("answers the team's daily rows: date, spend, requests, tokens, with the id and the enabled operations (T-LP12)", async () => {
    await signIn("admin");
    const { res, body } = await get(LTEAM["team-a"]);
    expect(res.status).toBe(200);
    expect(Object.keys(body.data).sort()).toEqual([
      "daily",
      "enabledOperations",
      "litellmTeamId",
    ]);
    expect(body.data.litellmTeamId).toBe(LTEAM["team-a"]);
    expect(body.data.daily).toEqual([
      { date: "2026-11-02", spend: 1.5, requests: 3, tokens: 15 },
    ]);
    expect(body.data.enabledOperations).toContain("getTeamDailySpend");
  });

  it("makes exactly one LiteLLM call, a GET of getTeamDailySpend for that team and the range in UTC (T-LP12; LD20)", async () => {
    await signIn("auditor");
    await get(LTEAM["team-a"]);
    expect(state.fake.calls).toHaveLength(1);
    expect(writeCalls(state)).toHaveLength(0);
    const q = new URL(dailyCalls()[0]!.url).searchParams;
    expect(q.get("team_ids")).toBe(LTEAM["team-a"]);
    expect(q.get("start_date")).toBe("2026-11-01");
    expect(q.get("end_date")).toBe("2026-11-14");
    expect(q.get("timezone")).toBe("0");
  });

  it("no key, key alias, token, user, member or per-user figure is in the answer (LT1; T-LP12)", async () => {
    await signIn("admin");
    const { text } = await get(LTEAM["team-a"]);
    expect(text).not.toContain(KEY_ALIAS);
    expect(text).not.toContain("raw_secret");
    expect(text).not.toMatch(/sk-/);
    expect(text).not.toMatch(
      /"(keys?|keyAlias|key_alias|api_keys|token|apiKey|secret|users?|userId|members?|breakdown)"/i,
    );
  });

  it("a range over 90 days is 400 BAD_REQUEST for an allowed caller, with no LiteLLM call (Rule 20.8; T-LP12)", async () => {
    await signIn("admin");
    const { res } = await get(
      LTEAM["team-a"],
      "dateFrom=2026-01-01&dateTo=2026-11-14",
    );
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a malformed team id is 400 BAD_REQUEST for an allowed caller, with no LiteLLM call (path parameter; T-LP12)", async () => {
    await signIn("admin");
    await expectError((await get("../team/delete")).res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it('a disabled getTeamDailySpend is 403 OPERATION_DISABLED before any LiteLLM call (LD19; T-LP12; guard: requireEnabled(["getTeamDailySpend"]))', async () => {
    await setToggles({ getTeamDailySpend: false });
    await signIn("admin");
    await expectError(
      (await get(LTEAM["team-a"])).res,
      403,
      "OPERATION_DISABLED",
    );
    expect(state.fake.calls).toHaveLength(0);
  });

  it("with no LiteLLM connection stored the answer is 200 with an empty list and no LiteLLM call (LD37; T-LP12)", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    await signIn("admin");
    const { res, body } = await get(LTEAM["team-a"]);
    expect(res.status).toBe(200);
    expect(body.data.daily).toEqual([]);
    expect(body.data.litellmTeamId).toBe(LTEAM["team-a"]);
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each(["admin", "orgAdmin", "auditor"] as const)(
    "%s while the Organisation cap hides cost: daily is absent, no requests or tokens, and no LiteLLM call (LD23; T-LP12)",
    async (who) => {
      await enterProd();
      await signIn(who);
      const { res, body, text } = await get(LTEAM["team-a"]);
      expect(res.status).toBe(200);
      expect(body.data).not.toHaveProperty("daily");
      expect(body.data.litellmTeamId).toBe(LTEAM["team-a"]);
      expect(text).not.toMatch(/"(requests|tokens|spend)"/);
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("an unknown team answers 200 and an empty list, and no existence call (team info) is made (D-P-10; T-LP12)", async () => {
    await signIn("admin");
    const { res, body } = await get(UNKNOWN_LTEAM);
    expect(res.status).toBe(200);
    expect(body.data.daily).toEqual([]);
    expect(
      state.fake.calls.filter((c) => c.path.startsWith("/team/info")),
    ).toHaveLength(0);
    expect(state.fake.calls).toHaveLength(1);
  });

  it("a team no app team links to is read the same way: one daily call, no member or link read (T-LP12)", async () => {
    await signIn("admin");
    const { res } = await get(UNLINKED_LTEAM);
    expect(res.status).toBe(200);
    expect(state.fake.calls.map((c) => c.path)).toEqual([
      "/team/daily/activity/aggregated",
    ]);
  });
});
