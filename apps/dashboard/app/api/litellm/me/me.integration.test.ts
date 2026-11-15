import { describe, expect, it, vi } from "vitest";

import {
  LUSER,
  OTHER_USER_ID,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
  UNLINKED_LTEAM,
  DATES,
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
} from "@/test/fake-litellm-views";
import { signInAs } from "@/test/scope-fixtures";
import { clearTable } from "@/test/test-support";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/me GET,
// any signed-in role, own data), "Roles and rights" (Viewer: through their
// litellmUserId link, empty state if unlinked; own spend, budget, limits and
// own keys' metadata, never key values), "Reads" (getUser: user_id required,
// keys and teams filtered to the caller's scope; getUserDailySpend
// timezone=0, LD20), threats LT1, LT9, implementation-phases L3 Verify, Rule 60.23.
//
// Contract for the developer (.../me/route.ts, GET):
//   query: dateFrom, dateTo (90-day cap -> 400). No user-id input exists.
//   200 data = { linked: false } when the caller has no litellmUserId, with no LiteLLM call, else
//   { linked: true, spend, maxBudget, daily: [{ date, spend, ... }],
//     keys: [{ tokenId, keyAlias, blocked, expires, models, spend, maxBudget, ... }],
//     enabledOperations: string[] }.
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
const me = async (query = `?${DATES}`) =>
  call(await load(), `/api/litellm/me${query}`);

describe("GET /api/litellm/me", () => {
  it("401 without a session, no-store (Rule 10.3)", async () => {
    signInAs(null);
    const { res } = await me();
    await expectError(res, 401, "UNAUTHORIZED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each(["teamAdminA", "auditor", "admin"] as const)(
    "%s with no LiteLLM user link gets the empty 'unlinked' state with no LiteLLM call (Roles and rights: Viewer)",
    async (who) => {
      signInAs(who);
      const { res, body } = await me();
      expect(res.status).toBe(200);
      expect(body.data.linked).toBe(false);
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("a session with no role reads its own (empty) data: any signed-in role (API routes)", async () => {
    await signInWithRoles([]);
    const { res, body } = await me();
    expect(res.status).toBe(200);
    expect(body.data.linked).toBe(false);
  });

  it("a Viewer reads only their own LiteLLM user, never another (Viewer own vs other)", async () => {
    signInAs("memberA");
    const a = await me();
    expect(a.body.data.spend).toBe(7.5);
    const infoA = state.fake.calls.filter((c) => c.path === "/user/info");
    expect(
      infoA.map((c) => new URL(c.url).searchParams.get("user_id")),
    ).toEqual([LUSER.memberA]);
    installFake(state);
    signInAs("memberB");
    await me();
    const ids = state.fake.calls
      .filter(
        (c) => c.path === "/user/info" || c.path === "/user/daily/activity",
      )
      .map((c) => new URL(c.url).searchParams.get("user_id"));
    expect(new Set(ids)).toEqual(new Set([LUSER.memberB]));
  });

  it("a user id in the query is ignored: the identity link is the only source (LT5 class)", async () => {
    signInAs("memberA");
    await me(`?${DATES}&userId=${LUSER.memberB}&user_id=${OTHER_USER_ID}`);
    const ids = state.fake.calls.map((c) =>
      new URL(c.url).searchParams.get("user_id"),
    );
    expect(ids).not.toContain(LUSER.memberB);
    expect(ids).not.toContain(OTHER_USER_ID);
  });

  it("returns own spend, budget and only own keys' metadata, filtered to the caller's scope (Reads: getUser)", async () => {
    signInAs("memberA");
    const { body } = await me();
    expect(body.data).toMatchObject({
      linked: true,
      spend: 7.5,
      maxBudget: 20,
    });
    const tokens = body.data.keys.map((k: { tokenId: string }) => k.tokenId);
    // TOKEN_B belongs to another person; TOKEN_C to a team the dashboard does not link.
    expect(tokens).toEqual([TOKEN_A]);
    expect(tokens).not.toContain(TOKEN_B);
    expect(tokens).not.toContain(TOKEN_C);
    expect(JSON.stringify(body)).not.toContain(UNLINKED_LTEAM);
  });

  it("never returns a key value; loose team rows are dropped or reduced (LT1, LT9; reduction)", async () => {
    signInAs("memberA");
    const { body, text } = await me();
    expectNoSentinels(body);
    expect(text).not.toMatch(/sk-/);
    for (const k of body.data.keys) expect(k).not.toHaveProperty("key");
  });

  it("daily activity is queried for the linked user in UTC with timezone=0 (LD20)", async () => {
    signInAs("memberA");
    await me();
    const daily = state.fake.calls.find(
      (c) => c.path === "/user/daily/activity",
    )!;
    const q = new URL(daily.url).searchParams;
    expect(q.get("timezone")).toBe("0");
    expect(q.get("user_id")).toBe(LUSER.memberA);
    expect(q.get("start_date")).toBe("2026-11-01");
    expect(q.get("end_date")).toBe("2026-11-14");
  });

  it("reports the caller's enabledOperations (Toggles narrow only)", async () => {
    signInAs("memberA");
    const { body } = await me();
    expect(body.data.enabledOperations).toContain("getUser");
  });

  it("a disabled getUser is 403 OPERATION_DISABLED before any LiteLLM call (LD19)", async () => {
    await setToggles({ getUser: false });
    signInAs("memberA");
    const { res } = await me();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE (error codes)", async () => {
    installFake(state, { outage: true });
    signInAs("memberA");
    const { res, text } = await me();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  it("no stored connection is 503 LITELLM_UNAVAILABLE for a linked caller (error codes: not configured)", async () => {
    await clearTable();
    await seedViews({ connection: false });
    signInAs("memberA");
    const { res } = await me();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("memberA");
    const { res } = await me();
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });

  it("400 BAD_REQUEST for a range over 90 days, no LiteLLM call (Rule 20.8)", async () => {
    signInAs("memberA");
    const { res } = await me("?dateFrom=2026-01-01&dateTo=2026-06-01");
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a 200 carries Cache-Control private, no-store (API routes)", async () => {
    signInAs("memberA");
    const { res } = await me();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
