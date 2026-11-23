import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  GHOST_USER_ID,
  LU,
  NOW,
  USER_TOTAL,
  auditOf,
  bodyOf,
  expectError,
  idWritesHandler,
  installIdFake,
  luserLedger,
  send,
  setToggles,
  setupIdWritesSuite,
  signIn,
  signInAs,
  stubLiteLLMEnv,
  withFailingLedger,
  writeCalls,
} from "@/test/support/litellm-id-writes-support";
import type { Who } from "@/test/support/litellm-id-writes-support";

// Source: docs/specs/2026-11-10-litellm.md - LD39, LT35 (wider body), LT36
// (privileged target), "Writes" (resetUserSpend: POST /user/update with exactly
// { user_id, spend: 0 }; admin/org-admin any user, a Lead only for a member of a
// team in scope else the unknown-user 404, auditor 403; default off), "API
// routes" (RS2 order); Access Control - permission matrix, "Reset by LiteLLM
// ids"; Data Model - BudgetReset (scope "user", BRESET#LUSER#); plan RS2
// D-RS1..D-RS5, D-RS8, T-RS2, T-RS5, T-RS6. The 401/403-before-parse/400/
// no-store/denied cases are the shared route-contract suite's (Rule 60.23).
//
// Contract for the developer: POST
// app/api/litellm/users/[litellmUserId]/reset-spend/route.ts, no body; exports
// POST. 200 { data: { litellmUserId } }; exactly one LiteLLM write, POST
// /user/update with body { user_id, spend: 0 }; one audit record
// litellm.user.reset-spend (target { type: "litellm-user", id }, before
// { spend: <the user's total before> }, after { spend: 0 }); one ledger item
// under PK BRESET#LUSER#<litellmUserId>, scope "user", operation "spend".
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupIdWritesSuite();
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const reset = async (user: string) =>
  send(
    await load(),
    `/api/litellm/users/${encodeURIComponent(user)}/reset-spend`,
    { litellmUserId: user },
  );

describe("POST /api/litellm/users/[litellmUserId]/reset-spend", () => {
  beforeEach(async () => {
    await setToggles({ resetUserSpend: true });
  });

  // Complete role x target matrix (security, Rule 60.24a): D-RS3, T-RS2.
  const MATRIX: Array<[Who, string, 200 | 403 | 404]> = [
    ["admin", LU.a1, 200],
    ["admin", LU.ab, 200],
    ["admin", LU.ul1, 200],
    ["admin", LU.lone, 200],
    ["admin", GHOST_USER_ID, 404],
    ["orgAdmin", LU.a1, 200],
    ["orgAdmin", LU.ab, 200],
    ["orgAdmin", LU.ul1, 200],
    ["orgAdmin", LU.lone, 200],
    ["teamAdminA", LU.a1, 200],
    ["teamAdminA", LU.ab, 200],
    ["teamAdminA", LU.b1, 404],
    ["teamAdminA", LU.c1, 404],
    ["teamAdminA", LU.ul1, 404],
    ["teamAdminA", LU.lone, 404],
    ["teamAdminA", GHOST_USER_ID, 404],
    ["deptAdminEng", LU.b1, 200],
    ["deptAdminEng", LU.ab, 200],
    ["deptAdminEng", LU.c1, 404],
    ["deptAdminEng", LU.lone, 404],
    ["auditor", LU.a1, 403],
    ["auditor", LU.lone, 403],
    ["memberA", LU.a1, 403],
    ["noRole", LU.a1, 403],
  ];
  it.each(MATRIX)(
    "%s resetting %s is %s (T-RS2; D-RS3)",
    async (who, user, expected) => {
      await signIn(who);
      const { res } = await reset(user);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      if (expected === 200) {
        expect(res.status).toBe(200);
        const writes = writeCalls(state);
        expect(writes).toHaveLength(1);
        expect(writes[0]?.method).toBe("POST");
        expect(writes[0]?.path).toBe("/user/update");
        expect(await auditOf("litellm.user.reset-spend")).toHaveLength(1);
        expect(await luserLedger(user)).toHaveLength(1);
        return;
      }
      await expectError(
        res,
        expected,
        expected === 403 ? "FORBIDDEN" : "NOT_FOUND",
      );
      expect(writeCalls(state)).toHaveLength(0);
      expect(await luserLedger(user)).toEqual([]);
      if (expected === 403) expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("an auditor's refusal is audited once as denied and makes no LiteLLM call (D17; T-RS2)", async () => {
    signInAs("auditor");
    await expectError((await reset(LU.a1)).res, 403, "FORBIDDEN");
    const records = await auditOf("litellm.user.reset-spend");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      result: "denied",
      code: "FORBIDDEN",
      actor: CALLERS.auditor.oid,
    });
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a Lead gets the same 404 body for a user outside their teams, a user in no team and a missing user (LT5; D-RS4)", async () => {
    signInAs("teamAdminA");
    const other = await reset(LU.b1);
    const none = await reset(LU.lone);
    const ghost = await reset(GHOST_USER_ID);
    for (const r of [other, none, ghost]) {
      await expectError(r.res, 404, "NOT_FOUND");
    }
    expect(none.text).toBe(other.text);
    expect(ghost.text).toBe(other.text);
    expect(writeCalls(state)).toHaveLength(0);
  });

  // Q-B1 (review RS2 r1): LT37 / D17 - a refused out-of-reach reset is audited
  it("a Lead naming an existing user outside their reach gets the unknown-user 404 body and exactly one denied NOT_FOUND record (Q-B1; LT37; D17)", async () => {
    signInAs("teamAdminA");
    const ghost = await reset(GHOST_USER_ID);
    expect(await auditOf("litellm.user.reset-spend")).toHaveLength(0);
    const other = await reset(LU.b1);
    await expectError(other.res, 404, "NOT_FOUND");
    expect(other.text).toBe(ghost.text);
    const records = await auditOf("litellm.user.reset-spend");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      result: "denied",
      code: "NOT_FOUND",
      actor: CALLERS.teamAdminA.oid,
      target: { type: "litellm-user", id: LU.b1 },
    });
    expect(writeCalls(state)).toHaveLength(0);
  });

  it("an unknown user id writes no audit record and returns the same 404 (Q-B1; LT37)", async () => {
    signInAs("teamAdminA");
    await expectError((await reset(GHOST_USER_ID)).res, 404, "NOT_FOUND");
    expect(await auditOf("litellm.user.reset-spend")).toEqual([]);
  });

  it("sends exactly { user_id, spend: 0 } and nothing else (D-RS1; T-RS1 at the route; LT35)", async () => {
    signInAs("admin");
    await reset(LU.ab);
    const [write] = writeCalls(state);
    expect(bodyOf(write)).toEqual({ user_id: LU.ab, spend: 0 });
    expect(Object.keys(bodyOf(write)).sort()).toEqual(["spend", "user_id"]);
  });

  it("the only LiteLLM write is /user/update, never /user/delete or a member route (D-RS1; T-RS1)", async () => {
    signInAs("admin");
    await reset(LU.ab);
    expect(writeCalls(state).map((c) => c.path)).toEqual(["/user/update"]);
  });

  it("the audit record carries the user's spend before and 0 after, and says whose spend (D-RS8)", async () => {
    signInAs("admin");
    await reset(LU.ab);
    const [record] = await auditOf("litellm.user.reset-spend");
    expect(record).toMatchObject({
      result: "success",
      category: "change",
      actor: CALLERS.admin.oid,
      target: { type: "litellm-user", id: LU.ab },
      before: { spend: USER_TOTAL[LU.ab] },
      after: { spend: 0 },
    });
  });

  it("the ledger item of a user with no app identity is scope user under BRESET#LUSER# with no oid, no teamId and no GSI1 keys (D-RS8; T-RS6)", async () => {
    signInAs("admin");
    await reset(LU.ab);
    const [item] = await luserLedger(LU.ab);
    expect(item).toMatchObject({
      scope: "user",
      litellmUserId: LU.ab,
      operation: "spend",
      amount: USER_TOTAL[LU.ab],
      trigger: "direct",
      actorOid: CALLERS.admin.oid,
      timestamp: NOW,
    });
    for (const key of ["oid", "teamId", "departmentId", "litellmTeamId"]) {
      expect(item).not.toHaveProperty(key);
    }
    expect(item).not.toHaveProperty("gsi1pk");
    expect(item).not.toHaveProperty("gsi1sk");
    expect(item?.expiresAt).toBe(Date.parse(NOW) / 1000 + 400 * 86_400);
  });

  // R2-B1 (review RS2 r2; Data Model - BudgetReset, scope user): budget is the
  // user's own max_budget from getUser, or null when the user has none.
  it("the user-scope ledger item stores the user's max_budget from getUser as budget (R2-B1)", async () => {
    installIdFake(state, { userBudgets: { [LU.ab]: 42.5 } });
    signInAs("admin");
    await reset(LU.ab);
    const [item] = await luserLedger(LU.ab);
    expect(item?.budget).toBe(42.5);
  });

  it("the user-scope ledger item stores budget null when the user has no max_budget (R2-B1)", async () => {
    signInAs("admin");
    await reset(LU.ab);
    const [item] = await luserLedger(LU.ab);
    expect(item).toHaveProperty("budget", null);
  });

  it("a user with an app identity keeps the oid and the GSI1 key, so the reset counts for that person (D-RS8)", async () => {
    signInAs("teamAdminA");
    expect((await reset(LU.a1)).res.status).toBe(200);
    const [item] = await luserLedger(LU.a1);
    expect(item).toMatchObject({
      scope: "user",
      oid: CALLERS.memberA.oid,
      gsi1pk: `BRESETS#IDENT#${CALLERS.memberA.oid}`,
    });
  });

  it("the user's spend is read before the write (call order; MG-D8)", async () => {
    signInAs("admin");
    await reset(LU.ab);
    const order = state.fake.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf("GET /user/info")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("GET /user/info")).toBeLessThan(
      order.indexOf("POST /user/update"),
    );
  });

  // T-RS5: the service user is privileged through its proxy_admin role (LT36).
  it.each(["proxy_admin", "proxy_admin_viewer"])(
    "a %s target is 409 PRIVILEGED_TARGET with no write, no ledger item and one denied record (T-RS5; LT36; the service user is a proxy_admin; D-RS5)",
    async (role) => {
      installIdFake(state, { roles: { [LU.lone]: role, [LU.ab]: role } });
      for (const who of ["admin", "teamAdminA"] as const) {
        signInAs(who);
        const user = who === "admin" ? LU.lone : LU.ab;
        await expectError((await reset(user)).res, 409, "PRIVILEGED_TARGET");
        expect(await luserLedger(user)).toEqual([]);
      }
      expect(writeCalls(state)).toHaveLength(0);
      const records = await auditOf("litellm.user.reset-spend");
      expect(records).toHaveLength(2);
      for (const r of records) {
        expect(r).toMatchObject({
          result: "denied",
          code: "PRIVILEGED_TARGET",
        });
      }
    },
  );

  it("an internal_user_viewer target is not privileged (LD12)", async () => {
    installIdFake(state, { roles: { [LU.ab]: "internal_user_viewer" } });
    signInAs("admin");
    expect((await reset(LU.ab)).res.status).toBe(200);
  });

  // D-RS2, D-RS4 order
  it("resetUserSpend is off by default: 403 OPERATION_DISABLED before any LiteLLM call (D-RS2; LD10)", async () => {
    await setToggles({});
    signInAs("admin");
    await expectError((await reset(LU.ab)).res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
    expect(await auditOf("litellm.user.reset-spend")).toHaveLength(0);
    expect(await luserLedger(LU.ab)).toEqual([]);
  });

  it("the toggle is checked before the target: a Lead out of scope with the operation off is 403 OPERATION_DISABLED, not 404 (D-RS4 order)", async () => {
    await setToggles({ resetUserSpend: false });
    signInAs("teamAdminA");
    await expectError((await reset(LU.b1)).res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("the permission is checked before the toggle: an auditor with the operation off is 403 FORBIDDEN (D-RS4 order)", async () => {
    await setToggles({ resetUserSpend: false });
    signInAs("auditor");
    await expectError((await reset(LU.a1)).res, 403, "FORBIDDEN");
  });

  it("a malformed user id is 400 BAD_REQUEST for an allowed caller, with no LiteLLM call (D-RS4: path ids by Zod)", async () => {
    signInAs("admin");
    const { res } = await reset("../user/delete");
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE with no detail, no ledger item and no success audit (error codes; LT12)", async () => {
    installIdFake(state, { outage: true });
    signInAs("admin");
    const { res, text } = await reset(LU.ab);
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
    expect(await luserLedger(LU.ab)).toEqual([]);
    expect(
      (await auditOf("litellm.user.reset-spend")).filter(
        (r) => r.result === "success",
      ),
    ).toEqual([]);
  });

  it("a rejected /user/update writes no ledger item (MG-D8: the reset did not happen)", async () => {
    const base = idWritesHandler();
    const { createFakeLiteLLM } = await import("@/test/fakes/fake-litellm");
    state.fake = createFakeLiteLLM((c, a) =>
      c.path === "/user/update"
        ? { status: 500, body: { error: "upstream boom" } }
        : base(c, a),
    );
    vi.stubGlobal("fetch", state.fake.fetch);
    signInAs("admin");
    expect((await reset(LU.ab)).res.status).toBeGreaterThanOrEqual(500);
    expect(await luserLedger(LU.ab)).toEqual([]);
  });

  it("a failed ledger write is not swallowed: 500, no item, no success audit (MG-D8; Rule 60.17)", async () => {
    signInAs("admin");
    const { res } = await withFailingLedger(load, (handler) =>
      send(
        handler,
        `/api/litellm/users/${encodeURIComponent(LU.ab)}/reset-spend`,
        { litellmUserId: LU.ab },
      ),
    );
    expect(res.status).toBe(500);
    expect(await luserLedger(LU.ab)).toEqual([]);
    expect(
      (await auditOf("litellm.user.reset-spend")).filter(
        (r) => r.result === "success",
      ),
    ).toEqual([]);
  });

  it("the response carries no loose upstream field (LT1, LT9)", async () => {
    signInAs("admin");
    const { text } = await reset(LU.ab);
    expect(text).not.toContain("USERTEAM-SENTINEL");
    expect(text).not.toMatch(/sk-/);
  });
});
