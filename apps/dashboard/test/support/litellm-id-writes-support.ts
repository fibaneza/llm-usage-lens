import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fakes/fake-litellm";
import {
  GHOST_USER_ID,
  LTEAM,
  enterProd,
  UNLINKED_LTEAM,
  expectError,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import type { RouteHandler, Suite } from "@/test/fakes/fake-litellm-views";
import { memberWritesHandler } from "@/test/support/litellm-member-writes-support";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Test-only harness for the RS2 routes keyed by LiteLLM ids (not imported by
// production code). Rule 60.22: DynamoDB Local, the real policy module, audit
// and ledger; only `@/auth` (mocked by each test file) and the in-process fake
// LiteLLM are injected (Rule 60.24).
// Source: docs/specs/2026-11-10-litellm.md - LD39, LT35-LT37, "Writes"
// (resetUserSpend, resetMemberSpend, resetMemberBudget), "API routes";
// Access Control - "Permission matrix", "Reset by LiteLLM ids"; Data Model -
// "BudgetReset" (RS2 amendment: scopes, keys); plan RS2 D-RS3..D-RS8.

export {
  CALLERS,
  GHOST_USER_ID,
  LTEAM,
  UNLINKED_LTEAM,
  enterProd,
  expectError,
  setToggles,
  signInAs,
  stubLiteLLMEnv,
};

export const AUDIT_DAY = "2026-11-14";
export const NOW = "2026-11-14T10:00:00.000Z";
export const BASE = "http://localhost:3000";
export const SAME_ORIGIN = { host: "localhost:3000", origin: BASE };

// LiteLLM users of the fake. a1 is linked to memberA (seedViews); every other
// one has no app identity. `spend` is the user's total in all of LiteLLM,
// `teams` the LiteLLM teams (by id) the user belongs to.
export const LU = {
  a1: "a1@company.com",
  ab: "ab@company.com",
  b1: "b1@company.com",
  c1: "c1@company.com",
  ul1: "ul1@company.com",
  lone: "lone@company.com",
} as const;
export const USER_TOTAL: Record<string, number> = {
  [LU.a1]: 7.5,
  [LU.ab]: 9,
  [LU.b1]: 4,
  [LU.c1]: 5,
  [LU.ul1]: 2.5,
  [LU.lone]: 1.75,
};
const USER_TEAMS: Record<string, string[]> = {
  [LU.a1]: [LTEAM["team-a"]],
  [LU.ab]: [LTEAM["team-a"], LTEAM["team-b"]],
  [LU.b1]: [LTEAM["team-b"]],
  [LU.c1]: [LTEAM["team-c"]],
  [LU.ul1]: [UNLINKED_LTEAM],
  [LU.lone]: [],
};
// Membership rows per LiteLLM team: spend and max budget IN that team.
type Row = { user: string; spend: number; max: number | null };
const TEAM_ROWS: Record<string, Row[]> = {
  [LTEAM["team-a"]]: [
    { user: LU.a1, spend: 3.25, max: 10 },
    { user: LU.ab, spend: 6, max: 10 },
  ],
  [LTEAM["team-b"]]: [
    { user: LU.b1, spend: 4, max: 10 },
    { user: LU.ab, spend: 2, max: null },
  ],
  [LTEAM["team-c"]]: [{ user: LU.c1, spend: 5, max: 10 }],
  [UNLINKED_LTEAM]: [{ user: LU.ul1, spend: 2.5, max: 5 }],
};
export const UNKNOWN_LTEAM = "ffffffff-ffff-4fff-8fff-ffffffffffff";

export type IdFakeOptions = {
  outage?: boolean;
  // GET /user/info `user_role` per LiteLLM user id (default internal_user).
  roles?: Record<string, string>;
  // A user's own max_budget on GET /user/info (default null).
  userBudgets?: Record<string, number>;
  // Make LTEAM["team-a"] hold this many extra members (the 200 cap, LD34).
  extraMembers?: number;
};

const membershipRow = (teamId: string, r: Row) => ({
  user_id: r.user,
  team_id: teamId,
  spend: r.spend,
  budget_id: "b1",
  internal_note: "MEMBERSHIP-SENTINEL",
  litellm_budget_table: r.max === null ? null : { max_budget: r.max },
});

export function idWritesHandler(opts: IdFakeOptions = {}): FakeHandler {
  const base = memberWritesHandler({ outage: opts.outage });
  return (call: FakeCall, attempt: number) => {
    if (opts.outage) return "network-error";
    const route = `${call.method} ${call.path}`;
    const q = new URL(call.url).searchParams;
    if (route === "GET /team/info") {
      const teamId = q.get("team_id") ?? "";
      const rows = TEAM_ROWS[teamId];
      if (!rows) return { status: 404, body: { detail: "team not found" } };
      const all =
        teamId === LTEAM["team-a"] && opts.extraMembers
          ? [
              ...rows,
              ...Array.from({ length: opts.extraMembers }, (_, i) => ({
                user: `bulk${i}@company.com`,
                spend: 1,
                max: null,
              })),
            ]
          : rows;
      return {
        status: 200,
        body: {
          team_id: teamId,
          team_info: {
            team_id: teamId,
            team_alias: teamId === UNLINKED_LTEAM ? "Shared platform" : "Alpha",
            max_budget: 100,
            spend: 12.5,
            models: ["claude-sonnet"],
            members_with_roles: all.map((r) => ({
              user_id: r.user,
              user_email: r.user,
              role: "user",
            })),
          },
          keys: [],
          team_memberships: all.map((r) => membershipRow(teamId, r)),
        },
      };
    }
    if (route === "GET /user/info") {
      const id = q.get("user_id") ?? "";
      if (id === GHOST_USER_ID || !(id in USER_TOTAL)) {
        return { status: 404, body: { detail: "user not found" } };
      }
      return {
        status: 200,
        body: {
          user_id: id,
          user_info: {
            user_id: id,
            user_email: id,
            user_role: opts.roles?.[id] ?? "internal_user",
            spend: USER_TOTAL[id],
            max_budget: opts.userBudgets?.[id] ?? null,
          },
          keys: [],
          teams: (USER_TEAMS[id] ?? []).map((t) => ({
            team_id: t,
            team_alias: "T",
            internal_note: "USERTEAM-SENTINEL",
          })),
        },
      };
    }
    if (route === "POST /user/update") {
      const body = (call.body ?? {}) as Record<string, unknown>;
      return { status: 200, body: { user_id: body.user_id } };
    }
    return base(call, attempt);
  };
}

export function installIdFake(state: Suite, opts: IdFakeOptions = {}) {
  state.fake = createFakeLiteLLM(idWritesHandler(opts));
  vi.stubGlobal("fetch", state.fake.fetch);
}

// The L3 org + links + identity links (memberA = a1@), with the fake above.
export function setupIdWritesSuite(): Suite {
  const state = setupViewsSuite();
  beforeEach(() => installIdFake(state));
  return state;
}

// ---- requests, calls, audit, ledger -----------------------------------------

export const writeCalls = (state: Suite) =>
  state.fake.calls.filter((c) => c.method !== "GET");
export const bodyOf = (call: FakeCall | undefined) =>
  (call?.body ?? {}) as Record<string, unknown>;

export async function send(
  handler: RouteHandler,
  path: string,
  params: Record<string, string>,
) {
  const res = await handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
    }),
    { params: Promise.resolve(params) },
  );
  const text = await res.clone().text();
  return { res, text, body: JSON.parse(text) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function auditOf(action: string) {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords(AUDIT_DAY)).filter((r) => r.action === action);
}

// Keys as the Data Model spec names them (RS2 amendment), written out here so
// the tests check the spec, not the code.
export async function ledgerRows(
  pk: string,
): Promise<Record<string, unknown>[]> {
  const res = await testDoc().send(
    new QueryCommand({
      TableName: TEST_TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": pk },
    }),
  );
  return res.Items ?? [];
}
export const teamLedger = (team: string) => ledgerRows(`BRESET#TEAM#${team}`);
export const lteamLedger = (id: string) => ledgerRows(`BRESET#LTEAM#${id}`);
export const luserLedger = (id: string) => ledgerRows(`BRESET#LUSER#${id}`);

export type Who = CallerName | "noRole";
export async function signIn(who: Who) {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
}

// A failed ledger write must surface (500) with no ledger item and no success
// audit record (MG-D8 / Rule 60.17): LiteLLM already reset the spend.
export async function withFailingLedger<T>(
  load: () => Promise<RouteHandler>,
  run: (handler: RouteHandler) => Promise<T>,
): Promise<T> {
  const handler = await load();
  const { getDocumentClient } = await import("@/lib/dynamodb");
  const client = getDocumentClient();
  const real = client.send.bind(client) as (c: unknown) => Promise<unknown>;
  const spy = vi
    .spyOn(client, "send")
    .mockImplementation(((command: { input?: unknown }) =>
      JSON.stringify(command.input ?? {}).includes("BRESET#")
        ? Promise.reject(new Error("ledger write failed"))
        : real(command)) as never);
  try {
    return await run(handler);
  } finally {
    spy.mockRestore();
  }
}

// ---- the shared contract of the two member routes ----------------------------

export type ProxyMemberSpec = {
  operation: "spend" | "budget";
  action: "litellm.member.reset-spend" | "litellm.member.reset-budget";
  toggleOp: "resetMemberSpend" | "resetMemberBudget";
  defaultOff: boolean;
  suffix: "reset-spend" | "reset-budget";
  upstream: "reset_spend" | "reset_budget";
  load: () => Promise<RouteHandler>;
};

// Registered once per member route file. Sources: plan RS2 D-RS3 (who), D-RS4
// (order, 404/403), D-RS5 (privileged), D-RS8 (audit, ledger); T-RS3, T-RS4,
// T-RS5, T-RS6; LiteLLM spec LT36, LD39; Access Control - permission matrix.
// The 401, 403-before-parse, 400, no-store and one-denied-per-refusal cases
// are the shared route-contract suite's (Rule 60.23).
export function defineProxyMemberResetContract(
  state: Suite,
  spec: ProxyMemberSpec,
) {
  const path = (team: string, user: string) =>
    `/api/litellm/proxy-teams/${team}/members/${encodeURIComponent(user)}/${spec.suffix}`;
  const run = async (team: string, user: string) =>
    send(await spec.load(), path(team, user), {
      litellmTeamId: team,
      litellmUserId: user,
    });
  const upstreamPath = (team: string, user: string) =>
    `/team/${team}/member/${encodeURIComponent(user)}/${spec.upstream}`;
  const ledgerPk = (team: string) =>
    Object.values(LTEAM).includes(team as never)
      ? `BRESET#TEAM#${Object.entries(LTEAM).find(([, id]) => id === team)?.[0]}`
      : `BRESET#LTEAM#${team}`;

  describe(`POST /api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/${spec.suffix}`, () => {
    beforeEach(async () => {
      await setToggles({ [spec.toggleOp]: true });
    });

    // [caller, LiteLLM team, member, expected] - complete role x team matrix
    // (security, Rule 60.24a): T-RS3 and the Access Control matrix rows.
    const MATRIX: Array<[Who, string, string, 200 | 403]> = [
      ["teamAdminA", LTEAM["team-a"], LU.ab, 200],
      ["teamAdminA", LTEAM["team-a"], LU.a1, 200],
      ["teamAdminA", LTEAM["team-b"], LU.b1, 403],
      ["teamAdminA", LTEAM["team-c"], LU.c1, 403],
      ["teamAdminA", UNLINKED_LTEAM, LU.ul1, 403],
      ["deptAdminEng", LTEAM["team-b"], LU.b1, 200],
      ["deptAdminEng", LTEAM["team-c"], LU.c1, 403],
      ["deptAdminEng", UNLINKED_LTEAM, LU.ul1, 403],
      ["orgAdmin", LTEAM["team-a"], LU.ab, 200],
      ["orgAdmin", LTEAM["team-c"], LU.c1, 200],
      ["orgAdmin", UNLINKED_LTEAM, LU.ul1, 200],
      ["admin", LTEAM["team-a"], LU.a1, 200],
      ["admin", LTEAM["team-b"], LU.ab, 200],
      ["admin", UNLINKED_LTEAM, LU.ul1, 200],
      ["auditor", LTEAM["team-a"], LU.ab, 403],
      ["auditor", UNLINKED_LTEAM, LU.ul1, 403],
      ["memberA", LTEAM["team-a"], LU.a1, 403],
      ["noRole", LTEAM["team-a"], LU.a1, 403],
    ];
    it.each(MATRIX)(
      "%s on %s for %s is %s (T-RS3; D-RS3)",
      async (who, team, user, expected) => {
        await signIn(who);
        const { res, body } = await run(team, user);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        if (expected === 200) {
          expect(res.status).toBe(200);
          expect(body.data).toMatchObject({ litellmUserId: user });
          const writes = writeCalls(state);
          expect(writes).toHaveLength(1);
          expect(writes[0]?.method).toBe("POST");
          expect(writes[0]?.path).toBe(upstreamPath(team, user));
          expect(await auditOf(spec.action)).toHaveLength(1);
          expect((await ledgerRows(ledgerPk(team))).length).toBe(1);
        } else {
          await expectError(res, 403, "FORBIDDEN");
          expect(writeCalls(state)).toHaveLength(0);
          expect(await ledgerRows(ledgerPk(team))).toEqual([]);
        }
      },
    );

    it("a refused Lead makes no LiteLLM write and the refusal is audited once as denied (D17; T-RS3)", async () => {
      signInAs("teamAdminA");
      const { res } = await run(UNLINKED_LTEAM, LU.ul1);
      await expectError(res, 403, "FORBIDDEN");
      expect(writeCalls(state)).toHaveLength(0);
      const records = await auditOf(spec.action);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: spec.action,
        result: "denied",
        code: "FORBIDDEN",
        actor: CALLERS.teamAdminA.oid,
      });
    });

    it("a member with no app identity on a linked team is reset by a Lead in scope: the ledger item has no oid and no GSI1 keys (D-RS8; T-RS6)", async () => {
      signInAs("teamAdminA");
      const { res } = await run(LTEAM["team-a"], LU.ab);
      expect(res.status).toBe(200);
      const [item] = await teamLedger("team-a");
      expect(item).toMatchObject({
        scope: "member",
        teamId: "team-a",
        departmentId: "dept-eng",
        litellmTeamId: LTEAM["team-a"],
        litellmUserId: LU.ab,
        operation: spec.operation,
        amount: 6,
        budget: 10,
        trigger: "direct",
        actorOid: CALLERS.teamAdminA.oid,
        timestamp: NOW,
      });
      expect(item).not.toHaveProperty("oid");
      expect(item).not.toHaveProperty("gsi1pk");
      expect(item).not.toHaveProperty("gsi1sk");
      expect(item?.expiresAt).toBe(Date.parse(NOW) / 1000 + 400 * 86_400);
    });

    it("a member who has an app identity keeps the oid and the GSI1 key (D-RS8: per-member counts stay keyed by oid)", async () => {
      signInAs("admin");
      expect((await run(LTEAM["team-a"], LU.a1)).res.status).toBe(200);
      const [item] = await teamLedger("team-a");
      expect(item).toMatchObject({
        oid: CALLERS.memberA.oid,
        gsi1pk: `BRESETS#IDENT#${CALLERS.memberA.oid}`,
      });
    });

    it("a reset on a LiteLLM team no app team links is keyed BRESET#LTEAM#<id> with no teamId or departmentId (D-RS8; ledger-key.md)", async () => {
      signInAs("orgAdmin");
      expect((await run(UNLINKED_LTEAM, LU.ul1)).res.status).toBe(200);
      const [item] = await lteamLedger(UNLINKED_LTEAM);
      expect(item).toMatchObject({
        scope: "member",
        litellmTeamId: UNLINKED_LTEAM,
        litellmUserId: LU.ul1,
        operation: spec.operation,
        amount: 2.5,
        budget: 5,
        trigger: "direct",
        actorOid: CALLERS.orgAdmin.oid,
      });
      for (const key of ["teamId", "departmentId", "oid", "gsi1pk"]) {
        expect(item).not.toHaveProperty(key);
      }
    });

    it("the audit record names the person; spend resets carry the spend before and after (Writes; D-RS8)", async () => {
      signInAs("admin");
      await run(LTEAM["team-a"], LU.ab);
      const [record] = await auditOf(spec.action);
      expect(record).toMatchObject({
        result: "success",
        actor: CALLERS.admin.oid,
        target: { type: "litellm-user", id: LU.ab },
      });
      if (spec.operation === "spend") {
        expect(record).toMatchObject({
          before: { spend: 6 },
          after: { spend: 0 },
        });
      } else {
        expect(record).toMatchObject({
          before: { budgetId: "b1" },
          after: { budgetId: "budget-new" },
        });
        expect(JSON.stringify(record)).toContain("budget-new");
      }
    });

    it("the spend is read before the write, so the ledger amount is the pre-reset spend (MG-D8; call order)", async () => {
      signInAs("admin");
      await run(LTEAM["team-a"], LU.ab);
      const order = state.fake.calls.map((c) => `${c.method} ${c.path}`);
      const read = order.indexOf("GET /team/info");
      const write = order.findIndex((p) => p.startsWith("POST /team/"));
      expect(read).toBeGreaterThanOrEqual(0);
      expect(read).toBeLessThan(write);
    });

    // T-RS4: same 404 body for a non-member, a missing user and a missing team.
    it("a user who is not in that team, an unknown user and an unknown team are the same 404 with no write (T-RS4; LT5)", async () => {
      signInAs("admin");
      const notMember = await run(LTEAM["team-a"], LU.b1);
      const ghost = await run(LTEAM["team-a"], GHOST_USER_ID);
      const noTeam = await run(UNKNOWN_LTEAM, LU.a1);
      for (const r of [notMember, ghost, noTeam]) {
        await expectError(r.res, 404, "NOT_FOUND");
      }
      expect(ghost.text).toBe(notMember.text);
      expect(noTeam.text).toBe(notMember.text);
      expect(writeCalls(state)).toHaveLength(0);
      expect(await teamLedger("team-a")).toEqual([]);
    });

    it("a Lead naming a user outside the team gets the 404 too, with no write (T-RS4)", async () => {
      signInAs("teamAdminA");
      await expectError(
        (await run(LTEAM["team-a"], LU.c1)).res,
        404,
        "NOT_FOUND",
      );
      expect(writeCalls(state)).toHaveLength(0);
    });

    // R5 (T-RS5): the LiteLLM service user is privileged through its proxy_admin
    // role, so a write aimed at it is refused with 409 PRIVILEGED_TARGET.
    it.each(["proxy_admin", "proxy_admin_viewer"])(
      "a %s target is 409 PRIVILEGED_TARGET with no write, one denied record, no ledger item (T-RS5; LT36; D-RS5)",
      async (role) => {
        installIdFake(state, { roles: { [LU.ab]: role } });
        signInAs("admin");
        const { res } = await run(LTEAM["team-a"], LU.ab);
        await expectError(res, 409, "PRIVILEGED_TARGET");
        expect(writeCalls(state)).toHaveLength(0);
        expect(await teamLedger("team-a")).toEqual([]);
        const records = await auditOf(spec.action);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          result: "denied",
          code: "PRIVILEGED_TARGET",
        });
      },
    );

    it("a privileged target on an unlinked team is 409 too (T-RS5)", async () => {
      installIdFake(state, { roles: { [LU.ul1]: "proxy_admin" } });
      signInAs("orgAdmin");
      await expectError(
        (await run(UNLINKED_LTEAM, LU.ul1)).res,
        409,
        "PRIVILEGED_TARGET",
      );
      expect(writeCalls(state)).toHaveLength(0);
    });

    it("an internal_user_viewer target is not privileged (LD12)", async () => {
      installIdFake(state, { roles: { [LU.ab]: "internal_user_viewer" } });
      signInAs("admin");
      expect((await run(LTEAM["team-a"], LU.ab)).res.status).toBe(200);
    });

    it(`a disabled ${spec.toggleOp} is 403 OPERATION_DISABLED before any LiteLLM call, nothing audited or kept (D-RS4 order; LD19)`, async () => {
      await setToggles({ [spec.toggleOp]: false });
      signInAs("admin");
      await expectError(
        (await run(LTEAM["team-a"], LU.ab)).res,
        403,
        "OPERATION_DISABLED",
      );
      expect(state.fake.calls).toHaveLength(0);
      expect(await auditOf(spec.action)).toHaveLength(0);
      expect(await teamLedger("team-a")).toEqual([]);
    });

    it("the permission is checked before the toggle: an auditor with the operation off is 403 FORBIDDEN (D-RS4 order)", async () => {
      await setToggles({ [spec.toggleOp]: false });
      signInAs("auditor");
      await expectError(
        (await run(LTEAM["team-a"], LU.ab)).res,
        403,
        "FORBIDDEN",
      );
    });

    if (spec.defaultOff) {
      it(`${spec.toggleOp} is off by default: 403 OPERATION_DISABLED (D-RS2 / LD10: destructive)`, async () => {
        await setToggles({});
        signInAs("admin");
        await expectError(
          (await run(LTEAM["team-a"], LU.ab)).res,
          403,
          "OPERATION_DISABLED",
        );
        expect(state.fake.calls).toHaveLength(0);
      });
    }

    it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE with no detail, no success audit and no ledger item (error codes; LT12)", async () => {
      installIdFake(state, { outage: true });
      signInAs("admin");
      const { res, text } = await run(LTEAM["team-a"], LU.ab);
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
      expect(text).not.toContain("fetch failed");
      expect(await teamLedger("team-a")).toEqual([]);
      expect(
        (await auditOf(spec.action)).filter((r) => r.result === "success"),
      ).toEqual([]);
    });

    it("a rejected LiteLLM write writes no ledger item (MG-D8: the reset did not happen)", async () => {
      const base = idWritesHandler();
      const re = new RegExp(`/${spec.upstream}$`);
      state.fake = createFakeLiteLLM((c, a) =>
        re.test(c.path)
          ? { status: 500, body: { error: "upstream boom" } }
          : base(c, a),
      );
      vi.stubGlobal("fetch", state.fake.fetch);
      signInAs("admin");
      const { res } = await run(LTEAM["team-a"], LU.ab);
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await teamLedger("team-a")).toEqual([]);
    });

    it("a failed ledger write is not swallowed: 500, no item, no success audit (MG-D8; Rule 60.17)", async () => {
      signInAs("admin");
      const { res } = await withFailingLedger(
        spec.load,
        async (handler) =>
          await send(handler, path(UNLINKED_LTEAM, LU.ul1), {
            litellmTeamId: UNLINKED_LTEAM,
            litellmUserId: LU.ul1,
          }),
      );
      expect(res.status).toBe(500);
      expect(await lteamLedger(UNLINKED_LTEAM)).toEqual([]);
      expect(
        (await auditOf(spec.action)).filter((r) => r.result === "success"),
      ).toEqual([]);
    });

    it("never writes anything but the one reset call: no /user/update, no key or member route (LT35; Budgets and limits)", async () => {
      signInAs("admin");
      await run(LTEAM["team-a"], LU.ab);
      const writes = writeCalls(state);
      expect(writes.map((c) => c.path)).toEqual([
        upstreamPath(LTEAM["team-a"], LU.ab),
      ]);
    });
  });
}
