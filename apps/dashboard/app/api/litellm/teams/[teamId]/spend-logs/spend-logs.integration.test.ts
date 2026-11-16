import { describe, expect, it, vi } from "vitest";

import {
  DATES,
  LTEAM,
  LUSER,
  call,
  defineTeamReadContract,
  enterProd,
  expectError,
  expectNoSentinels,
  setupViewsSuite,
  stubLiteLLMEnv,
} from "@/test/fake-litellm-views";
import { signInAs } from "@/test/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/spend-logs GET in scope), "Reads" (listSpendLogs: team_id, dates
// <= 90 days, page, page_size <= 100; request rows are loose and reduced),
// implementation-phases L3 Verify, Rules 20.8, 60.23.
//
// Contract for the developer (.../spend-logs/route.ts, GET):
//   query: dateFrom, dateTo (<= 90 days inclusive), page (>= 1), pageSize (1..100).
//   200 data = { connected: false, items: [] } when unlinked, else
//   { connected: true, items: [{ requestId, startTime, model, spend, ... }], page, totalPages, total }.
//   Prompt / response text, api_key, metadata and tags are never returned.
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
  suffix: "/spend-logs",
  query: `?${DATES}`,
  toggleOp: "listSpendLogs",
  upstreamPath: "/spend/logs/v2",
});

describe("GET /api/litellm/teams/[teamId]/spend-logs", () => {
  const get = async (query: string) =>
    call(await load(), `/api/litellm/teams/team-a/spend-logs${query}`, {
      teamId: "team-a",
    });

  it("returns reduced request rows and forwards the built query (Reads: listSpendLogs)", async () => {
    signInAs("teamAdminA");
    const { body } = await get(`?${DATES}&page=2&pageSize=50`);
    expect(body.data.items[0]).toMatchObject({
      requestId: "req-1",
      model: "claude-sonnet",
      spend: 0.01,
    });
    const logs = state.fake.calls.find((c) => c.path === "/spend/logs/v2")!;
    const q = new URL(logs.url).searchParams;
    expect(q.get("team_id")).toBe(LTEAM["team-a"]);
    expect(q.get("start_date")).toBe("2026-11-01");
    expect(q.get("end_date")).toBe("2026-11-14");
    expect(q.get("page")).toBe("2");
    expect(q.get("page_size")).toBe("50");
  });

  it("loose request rows are reduced to allowlisted fields (cost visualisation; LT1)", async () => {
    signInAs("admin");
    const { body } = await get(`?${DATES}`);
    expectNoSentinels(body);
    const allowed = new Set([
      "requestId",
      "startTime",
      "model",
      "spend",
      "promptTokens",
      "completionTokens",
      "totalTokens",
      "user",
      "status",
    ]);
    for (const key of Object.keys(body.data.items[0])) {
      expect(allowed.has(key), key).toBe(true);
    }
  });

  it.each([
    ["a range over 90 days", "?dateFrom=2026-01-01&dateTo=2026-06-01"],
    ["pageSize 101", `?${DATES}&pageSize=101`],
    ["page 0", `?${DATES}&page=0`],
    ["no dates", ""],
  ])(
    "returns 400 BAD_REQUEST for %s with no LiteLLM call (Reads bounds)",
    async (_n, query) => {
      signInAs("admin");
      const { res } = await get(query);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    },
  );
});

// LD23, T16: while the Organisation cap applies the cost stays, the person goes:
// spend-log rows omit `user` (absent, not null).
describe("GET /api/litellm/teams/[teamId]/spend-logs - Organisation cap (LD23, T16)", () => {
  const get = async () =>
    call(await load(), `/api/litellm/teams/team-a/spend-logs?${DATES}`, {
      teamId: "team-a",
    });

  it.each([
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s in prod without the approval gets request spend but no user",
    async (who) => {
      await enterProd();
      signInAs(who);
      const { res, body } = await get();
      expect(res.status).toBe(200);
      expect(body.data.items.length).toBeGreaterThan(0);
      for (const item of body.data.items) {
        expect(item, "user").not.toHaveProperty("user");
        expect(item.spend).toBe(0.01);
        expect(item.requestId).toBe("req-1");
      }
    },
  );

  it.each(["admin", "teamAdminA"] as const)(
    "%s in prod with the approval recorded gets user again (LD23)",
    async (who) => {
      await enterProd({ approved: true });
      signInAs(who);
      const { body } = await get();
      expect(body.data.items[0]).toMatchObject({
        user: LUSER.memberA,
        spend: 0.01,
      });
    },
  );

  it("outside prod (dev) user is present without any approval (LD23)", async () => {
    signInAs("teamAdminA");
    const { body } = await get();
    expect(body.data.items[0].user).toBe(LUSER.memberA);
  });
});
