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
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import {
  CALLERS,
  MEMBER_A_LUSER,
  NEW_KEY_VALUE,
  NEW_TOKEN,
  PEOPLE,
  auditWith,
  bodyOf,
  callsTo,
  defineTeamScopedWriteContract,
  expectError,
  expectNotLogged,
  expectValueNeverStored,
  installTeamWritesFake,
  send,
  setupTeamWritesSuite,
  spyOnLogs,
  writeCalls,
} from "@/test/support/litellm-team-writes-support";
import { signInAs } from "@/test/fixtures/scope-fixtures";

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
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupTeamWritesSuite();
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).GET;
};
const loadPost = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
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
        // LD27: an alias often names its owner; absent, not null.
        expect(item, "keyAlias").not.toHaveProperty("keyAlias");
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
        keyAlias: "alias-a",
        spend: 2.5,
      });
    },
  );

  it("outside prod (dev) userId is present without any approval (LD23)", async () => {
    signInAs("teamAdminA");
    const { body } = await get();
    expect(body.data.items[0].userId).toBe(LUSER.memberA);
    expect(body.data.items[0].keyAlias).toBe("alias-a"); // LD27
  });
});

// ---- POST: generateMemberKey (L4 slice 2) -----------------------------------
// Source: docs/specs/2026-11-10-litellm.md - "Writes" (generateMemberKey:
// POST /key/generate with team_id, user_id, models <= team, max_budget,
// budget_duration, rpm_limit, tpm_limit, max_parallel_requests <= member and
// team, duration, key_alias, metadata.{source, dashboardTeamId, createdByOid};
// Lead + Admin; audit new token id with alias, models, limits - never the
// value), "Privileged targets are refused", "Budgets and limits", "API routes"
// (no-store also on key-value responses), LT4, LT5, LT9, LT10, LT14, LT18.
//
// Contract: POST /api/litellm/teams/[teamId]/keys, strict body
//   { oid, keyAlias?, models?, maxBudget?, budgetDuration?, rpmLimit?,
//     tpmLimit?, maxParallelRequests?, duration? }   (oid = the key owner, a
//   member of the linked LiteLLM team; limits positive integers, unset fields
//   are omitted from the LiteLLM body).
//   201 { data: { tokenId, key, oid, litellmUserId, ...given fields } } - the
//   key value is `data.key`, returned in this one response only.
//   Audit litellm.key.generate, target { type: "litellm-key", id: <new token> },
//   after { litellmUserId, keyAlias?, models?, maxBudget?, budgetDuration?,
//   rpmLimit?, tpmLimit?, maxParallelRequests?, duration? }; never `key`.
const KEY_PATTERN = "/api/litellm/teams/[teamId]/keys";

defineTeamScopedWriteContract(state, {
  method: "POST",
  pattern: KEY_PATTERN,
  action: "litellm.key.generate",
  auditPrefix: "litellm.key.",
  toggleOp: "generateMemberKey",
  okStatus: 201,
  load: loadPost,
  path: (team) => `/api/litellm/teams/${team}/keys`,
  params: (team) => ({ teamId: team }),
  body: { oid: CALLERS.memberA.oid },
  targetType: "litellm-key",
});

describe("POST /api/litellm/teams/[teamId]/keys", () => {
  const generate = async (payload: unknown) =>
    send(await loadPost(), {
      method: "POST",
      path: "/api/litellm/teams/team-a/keys",
      params: { teamId: "team-a" },
      body: payload,
    });
  const base = { oid: CALLERS.memberA.oid };

  it("sends exactly the fixed fields plus the given ones, the owner's LiteLLM id and the creator oid in metadata (Writes; LT4, LT10)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await generate({
      ...base,
      keyAlias: "ci-runner",
      models: ["claude-sonnet"],
      rpmLimit: 3,
      duration: "30d",
    });
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({
      tokenId: NEW_TOKEN,
      key: NEW_KEY_VALUE,
      oid: CALLERS.memberA.oid,
      litellmUserId: MEMBER_A_LUSER,
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/key/generate");
    expect(bodyOf(writes[0])).toEqual({
      team_id: LTEAM["team-a"],
      user_id: MEMBER_A_LUSER,
      models: ["claude-sonnet"],
      rpm_limit: 3,
      duration: "30d",
      key_alias: "ci-runner",
      metadata: {
        source: "llm-usage-lens",
        dashboardTeamId: "team-a",
        createdByOid: CALLERS.teamAdminA.oid,
      },
    });
  });

  it("returns the key value exactly once, with Cache-Control no-store, and never stores, sends, logs or re-lists it (LT9)", async () => {
    const spies = spyOnLogs();
    signInAs("admin");
    const { res, text } = await generate(base);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(text.split(NEW_KEY_VALUE)).toHaveLength(2);

    const records = await auditWith("litellm.key.");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.key.generate",
      target: { type: "litellm-key", id: NEW_TOKEN },
    });
    expect(JSON.stringify(records)).not.toContain(NEW_KEY_VALUE);
    await expectValueNeverStored(NEW_KEY_VALUE, state);
    expectNotLogged(spies, NEW_KEY_VALUE);

    const list = await call(await load(), "/api/litellm/teams/team-a/keys", {
      teamId: "team-a",
    });
    expect(list.text).not.toContain(NEW_KEY_VALUE);
  });

  it("audits the alias, models and limits given, as before-less after fields (Writes: audit sanitised fields)", async () => {
    signInAs("admin");
    await generate({
      ...base,
      keyAlias: "ci",
      models: ["claude-sonnet"],
      rpmLimit: 2,
    });
    const [record] = await auditWith("litellm.key.");
    expect(record?.after).toMatchObject({
      litellmUserId: MEMBER_A_LUSER,
      keyAlias: "ci",
      models: ["claude-sonnet"],
      rpmLimit: 2,
    });
  });

  it("an owner with only an identity email that matches a LiteLLM team member is resolved by email (LD13)", async () => {
    signInAs("admin");
    const { res, body } = await generate({ oid: PEOPLE.dave.oid });
    expect(res.status).toBe(201);
    expect(body.data.litellmUserId).toBe(MEMBER_A_LUSER);
  });

  it.each([
    ["a person who is not in the linked LiteLLM team", CALLERS.memberB.oid],
    ["a person with no link and no LiteLLM user by email", PEOPLE.carol.oid],
  ])(
    "%s is 404 NOT_FOUND with no LiteLLM write (LT5; Resolution)",
    async (_n, oid) => {
      signInAs("admin");
      await expectError((await generate({ oid })).res, 404, "NOT_FOUND");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );

  it.each(["proxy_admin", "proxy_admin_viewer"])(
    "a %s owner is 409 PRIVILEGED_TARGET with no /key/generate call, recorded as a denied attempt (LT18, LD12)",
    async (role) => {
      installTeamWritesFake(state, { roles: { [MEMBER_A_LUSER]: role } });
      signInAs("teamAdminA");
      const { res } = await generate(base);
      await expectError(res, 409, "PRIVILEGED_TARGET");
      expect(callsTo(state, "POST /key/generate")).toHaveLength(0);
      const records = await auditWith("litellm.key.");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "litellm.key.generate",
        result: "denied",
        code: "PRIVILEGED_TARGET",
        actor: CALLERS.teamAdminA.oid,
      });
    },
  );

  it.each([
    ["a model the team does not have", { models: ["claude-haiku"] }],
    ["an empty model list (LiteLLM reads it as every model)", { models: [] }],
    ["the all-team-models wildcard", { models: ["all-team-models"] }],
    ["an rpm above the member's 5 (key <= member)", { rpmLimit: 6 }],
    ["a tpm above the member's 500", { tpmLimit: 501 }],
    ["a budget above the member's 10", { maxBudget: 11 }],
    ["zero rpm (LiteLLM may read 0 as block)", { rpmLimit: 0 }],
    ["a negative tpm", { tpmLimit: -1 }],
    ["a fractional rpm", { rpmLimit: 1.5 }],
    ["a null limit (unset means omitted)", { rpmLimit: null }],
    ["zero parallel requests", { maxParallelRequests: 0 }],
    [
      "parallel requests above the member's 3 (B4: key <= member and team)",
      { maxParallelRequests: 4 },
    ],
    ["a malformed duration", { duration: "forever" }],
    ["a body field outside the schema (user_id)", { user_id: "evil@x.com" }],
    ["a body field outside the schema (team_id)", { team_id: LTEAM["team-b"] }],
    [
      "a body field outside the schema (allowed_routes)",
      { allowed_routes: ["/*"] },
    ],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM write (Budgets and limits; LT4, LT10, LT14)",
    async (_n, extra) => {
      signInAs("admin");
      await expectError(
        (await generate({ ...base, ...extra })).res,
        400,
        "BAD_REQUEST",
      );
      expect(writeCalls(state)).toHaveLength(0);
    },
  );

  it.each([
    [{ rpmLimit: 5 }, 201],
    [{ tpmLimit: 500 }, 201],
    [{ maxBudget: 10 }, 201],
  ])(
    "a limit equal to the member's ceiling %j is allowed",
    async (extra, status) => {
      signInAs("admin");
      expect((await generate({ ...base, ...extra })).res.status).toBe(status);
    },
  );

  it.each([
    [3, 201],
    [4, 400],
  ])(
    "max_parallel_requests %i against the member's 3 is %i, with no /key/generate call on a refusal (Writes: <= member and team; B4)",
    async (maxParallelRequests, status) => {
      signInAs("admin");
      const { res } = await generate({ ...base, maxParallelRequests });
      expect(res.status).toBe(status);
      if (status === 400) {
        await expectError(res, 400, "BAD_REQUEST");
        expect(callsTo(state, "POST /key/generate")).toHaveLength(0);
      }
    },
  );

  it.each([
    [4, 201],
    [5, 400],
  ])(
    "a member with no limits of their own is capped by the team's max_parallel_requests of 4: %i is %i (B4)",
    async (maxParallelRequests, status) => {
      installTeamWritesFake(state, { noMemberLimits: true });
      signInAs("admin");
      const { res } = await generate({ ...base, maxParallelRequests });
      expect(res.status).toBe(status);
      if (status === 400) {
        expect(callsTo(state, "POST /key/generate")).toHaveLength(0);
      }
    },
  );

  it.each([
    [60, 201],
    [61, 400],
  ])(
    "a member with no limits of their own is capped by the team's 60 rpm: %i is %i (Budgets and limits: key <= member and team)",
    async (rpmLimit, status) => {
      installTeamWritesFake(state, { noMemberLimits: true });
      signInAs("admin");
      expect((await generate({ ...base, rpmLimit })).res.status).toBe(status);
    },
  );
});
