import { describe, expect, it, vi } from "vitest";

import {
  DATES,
  GHOST_USER_ID,
  call,
  expectError,
  expectNoSentinels,
  installFake,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fake-litellm-views";
import { signInAs } from "@/test/scope-fixtures";
import type { CallerName } from "@/test/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/users/
// [litellmUserId] GET: Lead for a member of a team in scope, org-admin, Admin,
// Auditor; otherwise 404), "Views by role (L3b)" (Users tab: spend, budget,
// daily spend via getUser + getUserDailySpend; Scope: out of scope is the same
// 404 as missing), "Reads" (getUser user_id required; getUserDailySpend
// timezone=0, LD20), LT21, LD22, Access Control "Enforcement" item 2, LD19,
// Rules 10.3, 60.23.
//
// Contract for the developer (.../users/[litellmUserId]/route.ts, GET):
//   path: litellmUserId (a LiteLLM user id; a malformed id -> 400 BAD_REQUEST
//   after the role check, no LiteLLM call). query: dateFrom, dateTo (90-day cap).
//   200 data = { userId, email, spend, maxBudget,
//                daily: [{ date, spend, ... }], enabledOperations: string[] }
//   No keys, no teams from LiteLLM, no ids of LiteLLM teams in the body.
//   Membership for a Lead = getUser's `teams` intersected with the LiteLLM ids
//   linked to teams in the Lead's scope. Out of scope, missing (upstream 404),
//   Viewer and no role: the SAME 404 NOT_FOUND body. A Lead's refused read
//   makes no getUserDailySpend call; a Viewer / no-role caller makes no
//   LiteLLM call at all.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
const get = async (userId: string, query = `?${DATES}`) => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, `/api/litellm/users/${encodeURIComponent(userId)}${query}`, {
    litellmUserId: userId,
  });
};
const dailyCalls = () =>
  state.fake.calls.filter((c) => c.path === "/user/daily/activity");

type Who = CallerName | "noRole";
const as = async (who: Who) => {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
};

describe("GET /api/litellm/users/[litellmUserId]", () => {
  it("401 without a session, no-store (Rule 10.3)", async () => {
    signInAs(null);
    const { res } = await get("a1@company.com");
    await expectError(res, 401, "UNAUTHORIZED");
    expect(state.fake.calls).toHaveLength(0);
  });

  // [caller, target user, status] (complete matrix: security, Rule 60.24a)
  const MATRIX: Array<[Who, string, 200 | 404]> = [
    ["memberA", "a1@company.com", 404],
    ["viewerNone", "a1@company.com", 404],
    ["noRole", "a1@company.com", 404],
    ["teamAdminA", "a1@company.com", 200],
    ["teamAdminA", "ab@company.com", 200],
    ["teamAdminA", "mix@company.com", 200], // member of team-a and team-c
    ["teamAdminA", "b1@company.com", 404],
    ["teamAdminA", "c1@company.com", 404],
    ["teamAdminA", "lone@company.com", 404], // no team at all
    ["deptAdminEng", "a1@company.com", 200],
    ["deptAdminEng", "b1@company.com", 200],
    ["deptAdminEng", "c1@company.com", 404],
    ["deptAdminEng", "lone@company.com", 404],
    ["orgAdmin", "c1@company.com", 200],
    ["orgAdmin", "lone@company.com", 200],
    ["auditor", "c1@company.com", 200],
    ["auditor", "lone@company.com", 200],
    ["admin", "c1@company.com", 200],
    ["admin", "lone@company.com", 200],
  ];
  it.each(MATRIX)(
    "%s reading %s is %i (LT21; Enforcement 2)",
    async (who, user, status) => {
      await as(who);
      const { res, body } = await get(user);
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      if (status === 404) {
        expect(body.error.code).toBe("NOT_FOUND");
        expect(dailyCalls()).toHaveLength(0);
      } else {
        expect(body.data.userId).toBe(user);
      }
    },
  );

  it("a Viewer or no-role caller makes no LiteLLM call at all (LT21)", async () => {
    await as("memberA");
    await get("a1@company.com");
    await as("noRole");
    await get("a1@company.com");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("an out-of-scope user answers the same 404 body as a missing user and as a Viewer (Enforcement 2; LT21)", async () => {
    signInAs("teamAdminA");
    const outOfScope = await get("c1@company.com");
    const missing = await get(GHOST_USER_ID);
    await as("memberA");
    const viewer = await get("a1@company.com");
    expect(outOfScope.res.status).toBe(404);
    expect(missing.res.status).toBe(404);
    expect(viewer.res.status).toBe(404);
    expect(outOfScope.text).toBe(missing.text);
    expect(outOfScope.text).toBe(viewer.text);
  });

  it("an org-wide reader asking for a missing user also gets 404 NOT_FOUND (upstream 404, no leak)", async () => {
    signInAs("admin");
    const { res, text } = await get(GHOST_USER_ID);
    await expectError(res, 404, "NOT_FOUND");
    expect(text).not.toContain("user not found");
  });

  it("returns one user's spend, budget and daily spend via getUser + getUserDailySpend, in UTC (Views: Users; LD20)", async () => {
    signInAs("teamAdminA");
    const { body } = await get("ab@company.com");
    expect(body.data).toMatchObject({
      userId: "ab@company.com",
      email: "ab@company.com",
      spend: 6,
      maxBudget: 10,
    });
    expect(body.data.daily[0]).toMatchObject({
      date: "2026-11-02",
      spend: 1.5,
    });
    const info = state.fake.calls.find((c) => c.path === "/user/info")!;
    expect(new URL(info.url).searchParams.get("user_id")).toBe(
      "ab@company.com",
    );
    const q = new URL(dailyCalls()[0]!.url).searchParams;
    expect(q.get("user_id")).toBe("ab@company.com");
    expect(q.get("timezone")).toBe("0");
    expect(q.get("start_date")).toBe("2026-11-01");
    expect(q.get("end_date")).toBe("2026-11-14");
    expect(body.data.enabledOperations).toContain("getUser");
  });

  it("returns no keys, no key values and no LiteLLM team ids (LT1, LT9; reduction)", async () => {
    signInAs("admin");
    const { body, text } = await get("a1@company.com");
    expectNoSentinels(body);
    expect(body.data).not.toHaveProperty("keys");
    expect(body.data).not.toHaveProperty("teams");
    expect(text).not.toMatch(/sk-/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
  });

  it("a malformed user id is 400 BAD_REQUEST for an allowed caller, no LiteLLM call (path parameter)", async () => {
    signInAs("admin");
    const { res } = await get("../team/delete");
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("400 BAD_REQUEST for a range over 90 days, no LiteLLM call (Rule 20.8)", async () => {
    signInAs("admin");
    const { res } = await get(
      "a1@company.com",
      "?dateFrom=2026-01-01&dateTo=2026-06-01",
    );
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each([["getUser"], ["getUserDailySpend"]])(
    "a disabled %s is 403 OPERATION_DISABLED before any LiteLLM call (LD19)",
    async (op) => {
      await setToggles({ [op]: false });
      signInAs("admin");
      const { res } = await get("a1@company.com");
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res, text } = await get("a1@company.com");
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("admin");
    const { res } = await get("a1@company.com");
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });
});
