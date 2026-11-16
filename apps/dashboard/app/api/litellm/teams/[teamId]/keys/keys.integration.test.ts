import { describe, expect, it, vi } from "vitest";

import {
  LTEAM,
  LUSER,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
  call,
  defineTeamReadContract,
  enterProd,
  expectNoSentinels,
  setupViewsSuite,
  stubLiteLLMEnv,
} from "@/test/fake-litellm-views";
import { signInAs } from "@/test/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/keys GET in scope), "Roles and rights" (keys' metadata, never key
// values), "Reads" (listKeys: team_id required, return_full_object=true,
// size <= 100; rows filtered to the caller's scope), threats LT1, LT9,
// implementation-phases L3 Verify, Rule 60.23.
//
// Contract for the developer (.../keys/route.ts, GET):
//   200 data = { connected: false, items: [] } when unlinked, else
//   { connected: true,
//     items: [{ tokenId, keyAlias, blocked, expires, models, spend, maxBudget, ... }] }
//   tokenId = the token HASH from /key/list; the key value is never returned.
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
  suffix: "/keys",
  query: "",
  toggleOp: "listKeys",
  upstreamPath: "/key/list",
});

describe("GET /api/litellm/teams/[teamId]/keys", () => {
  const get = async () =>
    call(await load(), "/api/litellm/teams/team-a/keys", { teamId: "team-a" });

  it("lists key metadata of the linked team only, dropping rows of other teams (listKeys filtered to scope)", async () => {
    signInAs("teamAdminA");
    const { body } = await get();
    const tokens = body.data.items.map((k: { tokenId: string }) => k.tokenId);
    expect(tokens).toEqual([TOKEN_A, TOKEN_B]);
    expect(tokens).not.toContain(TOKEN_C);
    expect(body.data.items[0]).toMatchObject({
      keyAlias: "alias-a",
      blocked: false,
      models: ["claude-sonnet"],
      spend: 2.5,
      maxBudget: 10,
    });
  });

  it("never returns a key value, even when LiteLLM sends one (Roles and rights; LT1, LT9)", async () => {
    signInAs("admin");
    const { body, text } = await get();
    expectNoSentinels(body);
    expect(text).not.toMatch(/sk-/);
    for (const item of body.data.items) {
      expect(item).not.toHaveProperty("key");
      expect(item).not.toHaveProperty("key_name");
    }
  });

  it("calls /key/list filtered by the linked team with full objects and size <= 100 (Reads: listKeys)", async () => {
    signInAs("admin");
    await get();
    const list = state.fake.calls.find((c) => c.path === "/key/list")!;
    const q = new URL(list.url).searchParams;
    expect(q.get("team_id")).toBe(LTEAM["team-a"]);
    expect(q.get("return_full_object")).toBe("true");
    expect(Number(q.get("size") ?? 100)).toBeLessThanOrEqual(100);
  });
});

// LD23, T16: while the Organisation cap applies (prod, no per-user approval)
// the cost stays but the person goes: key rows omit `userId` (absent, not null).
describe("GET /api/litellm/teams/[teamId]/keys - Organisation cap (LD23, T16)", () => {
  const get = async () =>
    call(await load(), "/api/litellm/teams/team-a/keys", { teamId: "team-a" });

  it.each([
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s in prod without the approval gets key spend but no userId",
    async (who) => {
      await enterProd();
      signInAs(who);
      const { res, body } = await get();
      expect(res.status).toBe(200);
      expect(body.data.items.length).toBeGreaterThan(0);
      for (const item of body.data.items) {
        expect(item, "userId").not.toHaveProperty("userId");
        expect(item.spend).toBe(2.5);
        expect(item.tokenId).toBeTruthy();
      }
    },
  );

  it.each(["admin", "teamAdminA"] as const)(
    "%s in prod with the approval recorded gets userId again (LD23)",
    async (who) => {
      await enterProd({ approved: true });
      signInAs(who);
      const { body } = await get();
      expect(body.data.items[0]).toMatchObject({
        userId: LUSER.memberA,
        spend: 2.5,
      });
    },
  );

  it("outside prod (dev) userId is present without any approval (LD23)", async () => {
    signInAs("teamAdminA");
    const { body } = await get();
    expect(body.data.items[0].userId).toBe(LUSER.memberA);
  });
});
