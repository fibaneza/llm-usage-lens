import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  LTEAM,
  LU,
  UNKNOWN_LTEAM,
  UNLINKED_LTEAM,
  enterProd,
  expectError,
  installIdFake,
  setToggles,
  setupIdWritesSuite,
  signIn,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-id-writes-support";
import type { Who } from "@/test/support/litellm-id-writes-support";
import { call } from "@/test/fakes/fake-litellm-views";

// Source: docs/specs/2026-11-10-litellm.md - "API routes" (GET
// /api/litellm/proxy-teams/[litellmTeamId]/members: Admin, org-admin, Auditor;
// a Lead 403; email, spend, budget, the linked app person or null; at most 200
// members, then truncated: true, LD34; the person lookups run at most 10 at
// once - a concurrency bound the fake cannot observe, so R2 tests the marker only), LD19 (a disabled read is 403 before any call), LT1/LT9 (loose
// upstream fields never leave), LT5 (unknown team is 404); Access Control -
// permission matrix row "Read a LiteLLM team's members"; plan RS2 D-RS6,
// T-RS8. The 401 and no-store cases are the shared suite's (Rule 60.23).
//
// Contract for the developer: GET
// app/api/litellm/proxy-teams/[litellmTeamId]/members/route.ts, exports GET.
// 200 { data: { litellmTeamId, enabledOperations, items: [{ userId, email,
// spend?, maxBudget?, person }] } } (spec row, agent decision 2026-11-23);
// spend/maxBudget are absent while the Organisation cap hides them (LD23):
// `userId` the LiteLLM user id, `spend`/`maxBudget` the person's spend and
// budget IN THAT TEAM (the team_memberships row; maxBudget null = unlimited),
// `person` = { oid, name } of the app identity linked to that LiteLLM user, or
// null. Reads only (getTeam; at most one call per request).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupIdWritesSuite();
const get = async (team: string) => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, `/api/litellm/proxy-teams/${team}/members`, {
    litellmTeamId: team,
  });
};
const byUser = (body: { data: { items: Array<{ userId: string }> } }) =>
  [...body.data.items].sort((a, b) => a.userId.localeCompare(b.userId));

describe("GET /api/litellm/proxy-teams/[litellmTeamId]/members (T-RS8)", () => {
  // Complete role matrix (security, Rule 60.24a).
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
    "%s is %s (D-RS6; permission matrix)",
    async (who, status) => {
      await signIn(who);
      const { res } = await get(LTEAM["team-a"]);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      if (status === 200) expect(res.status).toBe(200);
      else {
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
      }
    },
  );

  it("lists each member with email, spend and budget in that team, and the linked app person or null (D-RS6)", async () => {
    await signIn("auditor");
    const { body } = await get(LTEAM["team-a"]);
    const items = byUser(body as never);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      userId: LU.a1,
      email: LU.a1,
      spend: 3.25,
      maxBudget: 10,
      person: { oid: CALLERS.memberA.oid },
    });
    expect(items[1]).toMatchObject({
      userId: LU.ab,
      email: LU.ab,
      spend: 6,
      maxBudget: 10,
      person: null,
    });
  });

  it("echoes litellmTeamId and lists enabledOperations (spec row, D-RS6)", async () => {
    // resetMemberSpend is off by default (LD10); enable it so it is listed.
    await setToggles({ resetMemberSpend: true, resetMemberBudget: true });
    await signIn("admin");
    const { body } = await get(LTEAM["team-a"]);
    expect(body.data.litellmTeamId).toBe(LTEAM["team-a"]);
    expect(body.data.enabledOperations).toEqual(
      expect.arrayContaining(["resetMemberSpend", "resetMemberBudget"]),
    );
  });

  it("while the Organisation cap hides per-user cost, items omit spend and maxBudget but keep identity (LD23, D-RS6)", async () => {
    await enterProd();
    await signIn("admin");
    const { res, body } = await get(LTEAM["team-a"]);
    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    for (const item of body.data.items) {
      expect(item).toHaveProperty("email");
      expect(item).toHaveProperty("userId");
      expect(item).toHaveProperty("person");
      expect(item).not.toHaveProperty("spend");
      expect(item).not.toHaveProperty("maxBudget");
    }
  });

  it("a member with no budget has maxBudget null, not 0 (D-RS6)", async () => {
    await signIn("admin");
    const { body } = await get(LTEAM["team-b"]);
    const ab = byUser(body as never).find((i) => i.userId === LU.ab);
    expect(ab).toMatchObject({ spend: 2, maxBudget: null, person: null });
  });

  it("an admin reads a LiteLLM team no app team links (unlinked teams are listed, D-RS6)", async () => {
    await signIn("orgAdmin");
    const { res, body } = await get(UNLINKED_LTEAM);
    expect(res.status).toBe(200);
    expect(byUser(body as never).map((i) => i.userId)).toEqual([LU.ul1]);
  });

  it("returns at most 200 members however many the team holds (LD34)", async () => {
    installIdFake(state, { extraMembers: 250 });
    await signIn("admin");
    const { res, body } = await get(LTEAM["team-a"]);
    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(200);
  });

  // R2 (review RS2 r1): LD34 - the cap is marked, never silent
  it("marks truncated: true when the team holds more than 200 members (R2; LD34)", async () => {
    installIdFake(state, { extraMembers: 250 });
    await signIn("admin");
    const { body } = await get(LTEAM["team-a"]);
    expect(body.data.items).toHaveLength(200);
    expect(body.data.truncated).toBe(true);
  });

  it("carries no truncated marker at exactly 200 members, nor for a small team (R2; LD34)", async () => {
    installIdFake(state, { extraMembers: 198 });
    await signIn("admin");
    const full = await get(LTEAM["team-a"]);
    expect(full.body.data.items).toHaveLength(200);
    expect(full.body.data.truncated ?? false).toBe(false);
    installIdFake(state, {});
    const small = await get(LTEAM["team-a"]);
    expect(small.body.data.truncated ?? false).toBe(false);
  });

  it("an unknown LiteLLM team is 404 NOT_FOUND with no upstream detail (LT5; LT12)", async () => {
    await signIn("admin");
    const { res, text } = await get(UNKNOWN_LTEAM);
    await expectError(res, 404, "NOT_FOUND");
    expect(text).not.toContain("team not found");
  });

  it("only reads: no write is ever sent, and no loose field, key or secret leaves the server (LT1, LT9)", async () => {
    await signIn("admin");
    const { text } = await get(LTEAM["team-a"]);
    expect(writeCalls(state)).toHaveLength(0);
    expect(text).not.toContain("MEMBERSHIP-SENTINEL");
    expect(text).not.toMatch(/sk-/);
  });

  it("a malformed team id is 400 BAD_REQUEST for an allowed caller, with no LiteLLM call (path parameter)", async () => {
    await signIn("admin");
    await expectError((await get("../team/delete")).res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a disabled getTeam is 403 OPERATION_DISABLED before any LiteLLM call (LD19)", async () => {
    await setToggles({ getTeam: false });
    await signIn("admin");
    await expectError(
      (await get(LTEAM["team-a"])).res,
      403,
      "OPERATION_DISABLED",
    );
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
    installIdFake(state, { outage: true });
    await signIn("admin");
    const { res, text } = await get(LTEAM["team-a"]);
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });
});
