import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fakes/fake-litellm";
import { call } from "@/test/fakes/fake-litellm-views";
import {
  CALLERS,
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
import { seedIdentity } from "@/test/support/matrix-route-support";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Sources: Design System - "LiteLLM team page (unit LP1)", T-LP3; LiteLLM spec
// - "API routes" row GET /api/litellm/proxy-teams/[litellmTeamId] (admin,
// org-admin, auditor 200; a Lead 403; unknown 404; alias, spend, budget and
// its reset time, member count, models, linked app team with lead names; no
// key, key alias or secret), LD19 (off -> 403 before any call), LD23 (the cap
// omits spend and budget), LD37 (not configured -> 200, no call), LT1
// (service key and key data never leave). The 401, no-store and 403-before-
// parse cases are the shared route-contract suite's (Rule 60.23; registry
// entry in test/route-registry.ts).
//
// Guard order, copied from the sibling members/route.ts (lines in that file;
// the new route/route.ts must keep the same order, same helpers):
//   openModeRefusal()            sibling :44   (open-mode refusal)
//   teamAccess().orgWide -> 403  sibling :47   (Lead/member/no-role refused)
//   parseInput(PathLiteLLMId)    sibling :50   (400 on a bad id)
//   requireEnabled(["getTeam"])  sibling :53   (LD19, 403 before any call)
//   LiteLLMError 404 -> 404      sibling :55   (unknown team)
//   perUserCostHidden (LD23)     sibling :78   (omit spend and maxBudget)
// Contract: apps/dashboard/app/api/litellm/proxy-teams/[litellmTeamId]/route.ts
// exports GET; the gateway must read `budget_reset_at` from /team/info (the
// TeamInfoResponse schema in lib/litellm/operations.ts drops it today).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const RESET_AT = "2026-12-01T00:00:00Z";
const KEY_ALIAS = "KEYALIAS-SENTINEL";
const KEY_HASH = "keyhash-sentinel-0123456789";
const BAD_RESET = "BADRESET-SENTINEL";
let resetValue: string = RESET_AT;

// The id fake's /team/info plus what the page reads: a budget reset time, and
// one key row that must never reach the answer (LT1).
function withTeamExtras(): FakeHandler {
  const base = idWritesHandler();
  return (c: FakeCall, attempt: number) => {
    const out = base(c, attempt);
    if (
      typeof out === "object" &&
      out !== null &&
      "body" in out &&
      (out as { status?: number }).status !== 404 &&
      `${c.method} ${c.path}` === "GET /team/info"
    ) {
      const body = out.body as {
        team_info?: Record<string, unknown>;
        keys: unknown[];
      };
      if (!body.team_info) return out;
      body.team_info.budget_reset_at = resetValue;
      body.keys = [{ token: KEY_HASH, key_alias: KEY_ALIAS, spend: 1 }];
    }
    return out;
  };
}

const state = setupIdWritesSuite();
beforeEach(() => {
  resetValue = RESET_AT;
});
const get = async (team: string) => {
  stubLiteLLMEnv();
  state.fake = createFakeLiteLLM(withTeamExtras());
  vi.stubGlobal("fetch", state.fake.fetch);
  const { GET } = await import("./route");
  return call(GET, `/api/litellm/proxy-teams/${team}`, {
    litellmTeamId: team,
  });
};

describe("GET /api/litellm/proxy-teams/[litellmTeamId] (T-LP3)", () => {
  // Complete role matrix (security, Rule 60.24a). Guard: sibling :47, the new
  // route's orgWide check after openModeRefusal.
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
    "%s is %s (T-LP3; LiteLLM spec API routes; guard: teamAccess().orgWide, sibling members/route.ts:47)",
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

  it("answers alias, spend, budget, reset time, member count and models from getTeam (T-LP3; spec row)", async () => {
    await signIn("admin");
    const { res, body } = await get(LTEAM["team-a"]);
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      litellmTeamId: LTEAM["team-a"],
      alias: "Alpha",
      spend: 12.5,
      maxBudget: 100,
      budgetResetAt: RESET_AT,
      memberCount: 2,
      models: ["claude-sonnet"],
    });
    expect(Array.isArray(body.data.enabledOperations)).toBe(true);
    expect(writeCalls(state)).toHaveLength(0);
  });

  it("a linked team answers the app team and its lead names, an unlinked team answers null (T-LP3, T-LP4; spec row)", async () => {
    await seedIdentity(CALLERS.teamAdminA.oid, {
      email: CALLERS.teamAdminA.email,
      name: "Tara Lead",
    });
    await signIn("admin");
    const linked = await get(LTEAM["team-a"]);
    expect(linked.body.data.linkedAppTeam).toMatchObject({ teamId: "team-a" });
    const leadNames = (
      linked.body.data.linkedAppTeam.leads as Array<{ name: string }>
    ).map((l) => l.name);
    expect(leadNames).toContain("Tara Lead");
    expect(leadNames).not.toContain(CALLERS.memberA.email);
    expect(typeof linked.body.data.linkedAppTeam.name).toBe("string");
    const unlinked = await get(UNLINKED_LTEAM);
    expect(unlinked.res.status).toBe(200);
    expect(unlinked.body.data.linkedAppTeam).toBeNull();
  });

  it("while the Organisation cap hides cost, spend and maxBudget are omitted but the rest stays (LD23; T-LP3; guard: perUserCostHidden, sibling :78)", async () => {
    await enterProd();
    await signIn("admin");
    const { res, body } = await get(LTEAM["team-a"]);
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ alias: "Alpha", memberCount: 2 });
    expect(body.data).not.toHaveProperty("spend");
    expect(body.data).not.toHaveProperty("maxBudget");
  });

  it("an unparseable budget_reset_at answers budgetResetAt null and the raw string is not in the body (T-LP3; LiteLLM spec API routes, LT1: nothing upstream leaks)", async () => {
    resetValue = BAD_RESET;
    await signIn("admin");
    const { res, body, text } = await get(LTEAM["team-a"]);
    expect(res.status).toBe(200);
    expect(body.data.budgetResetAt).toBeNull();
    expect(text).not.toContain(BAD_RESET);
  });

  it("no key, key alias, token or secret is in the serialized answer (LT1; T-LP3)", async () => {
    await signIn("admin");
    const { text } = await get(LTEAM["team-a"]);
    expect(text).not.toContain(KEY_ALIAS);
    expect(text).not.toContain(KEY_HASH);
    expect(text).not.toContain("MEMBERSHIP-SENTINEL");
    expect(text).not.toMatch(/sk-/);
    expect(text).not.toMatch(
      /"(keys?|keyAlias|key_alias|token|apiKey|secret)"/i,
    );
  });

  it("an unknown LiteLLM team is 404 NOT_FOUND without upstream detail (T-LP3, LT5; guard: LiteLLMError 404 -> NotFoundError, sibling :55)", async () => {
    await signIn("admin");
    const { res, text } = await get(UNKNOWN_LTEAM);
    await expectError(res, 404, "NOT_FOUND");
    expect(text).not.toContain("team not found");
  });

  it("a malformed team id is 400 BAD_REQUEST for an allowed caller, with no LiteLLM call (T-LP3; guard: parseInput(PathLiteLLMId), sibling :50)", async () => {
    await signIn("admin");
    await expectError((await get("../team/delete")).res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a Lead is 403 before the id is parsed: a malformed id still gets 403 (T-LP3; guard order orgWide :47 before parseInput :50)", async () => {
    await signIn("teamAdminA");
    await expectError((await get("../team/delete")).res, 403, "FORBIDDEN");
    expect(state.fake.calls).toHaveLength(0);
  });

  it('a disabled getTeam is 403 OPERATION_DISABLED before any LiteLLM call (LD19; T-LP3; guard: requireEnabled(["getTeam"]), sibling :53)', async () => {
    await setToggles({ getTeam: false });
    await signIn("admin");
    await expectError(
      (await get(LTEAM["team-a"])).res,
      403,
      "OPERATION_DISABLED",
    );
    expect(state.fake.calls).toHaveLength(0);
  });

  it("with no LiteLLM connection stored the read is 200 and makes no LiteLLM call (LD37; T-LP3)", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    await signIn("admin");
    const { res, body } = await get(LTEAM["team-a"]);
    expect(res.status).toBe(200);
    expect(state.fake.calls).toHaveLength(0);
    expect(body.data.spend).toBeUndefined();
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
    await signIn("admin");
    stubLiteLLMEnv();
    state.fake = createFakeLiteLLM(idWritesHandler({ outage: true }));
    vi.stubGlobal("fetch", state.fake.fetch);
    const { GET } = await import("./route");
    const { res, text } = await call(
      GET,
      `/api/litellm/proxy-teams/${LTEAM["team-a"]}`,
      { litellmTeamId: LTEAM["team-a"] },
    );
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });
});
