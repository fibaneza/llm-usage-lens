import { beforeEach, describe, expect, it, vi } from "vitest";

import { removeMember } from "@/lib/data/access/affiliations";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fakes/fake-litellm";
import {
  BASE_URL,
  HOST,
  LTEAM,
  expectError,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  viewsHandler,
} from "@/test/fakes/fake-litellm-views";
import type { RouteHandler, Suite } from "@/test/fakes/fake-litellm-views";
import {
  PEOPLE,
  seedIdentity,
  seedMember,
} from "@/test/support/matrix-route-support";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";

// Test-only harness for the L4 slice 1 member-write route suites (not imported
// by production code). Rule 60.22: DynamoDB Local, the real policy module and
// audit; only `@/auth` (mocked by each test file) and the in-process fake
// LiteLLM are injected (Rule 60.24).
// Source: docs/specs/2026-11-10-litellm.md - "Allowlist -> Writes" (member
// rows), "Roles and rights", "Identity mapping and members", "Budgets and
// limits", "Audit", decisions LD2, LD10, threats LT5, LT10, LT13, LT18.
// Access Control spec: "Permission matrix", "Enforcement" items 2 and 6, "Audit
// log" D17 (one `denied` record per authorization refusal; an out-of-scope
// team is the missing-team 404 and still records `denied`/NOT_FOUND).

export { expectError, setToggles, stubLiteLLMEnv, HOST, BASE_URL, LTEAM };
export { PEOPLE, CALLERS, signInAs };

export const AUDIT_DAY = "2026-11-14";
export const MEMBER_A_LUSER = "a1@company.com";
export const BOB_LUSER = "bob@company.com";
export const ROUTE_BASE = "/api/litellm/teams/[teamId]/members";
export const SAME_ORIGIN = { host: HOST, origin: BASE_URL };

// ---- fake LiteLLM with the member write routes ------------------------------

export type MemberFakeOptions = {
  outage?: boolean;
  // GET /user/info `user_role` per LiteLLM user id (default internal_user).
  roles?: Record<string, string>;
};

const BOB_ROW = {
  user_id: BOB_LUSER,
  user_email: BOB_LUSER,
  spend: 0,
  max_budget: null,
  teams: [] as string[],
};

export function memberWritesHandler(opts: MemberFakeOptions = {}): FakeHandler {
  const base = viewsHandler({ extraUsers: [BOB_ROW] });
  return (call: FakeCall, attempt: number) => {
    if (opts.outage) return "network-error";
    const route = `${call.method} ${call.path}`;
    const body = (call.body ?? {}) as Record<string, unknown>;
    if (route === "GET /user/info") {
      const id = new URL(call.url).searchParams.get("user_id") ?? "";
      const reply = base(call, attempt);
      const role = opts.roles?.[id];
      if (role === undefined || typeof reply === "string") return reply;
      const payload = reply.body as {
        user_info: Record<string, unknown>;
      };
      return {
        status: reply.status,
        body: {
          ...payload,
          user_info: { ...payload.user_info, user_role: role },
        },
      };
    }
    if (route === "POST /user/new") {
      return {
        status: 200,
        body: {
          user_id: body.user_id,
          user_email: body.user_email,
          key: "sk-AUTOCREATED-TRAP",
        },
      };
    }
    if (route === "POST /team/member_add") {
      return { status: 200, body: { team_id: body.team_id } };
    }
    if (route === "POST /team/member_delete") return { status: 200, body: {} };
    if (route === "POST /team/member_update") {
      return {
        status: 200,
        body: { team_id: body.team_id, user_id: body.user_id },
      };
    }
    if (/^\/team\/[^/]+\/member\/[^/]+\/reset_spend$/.test(call.path)) {
      return { status: 200, body: {} };
    }
    if (/^\/team\/[^/]+\/member\/[^/]+\/reset_budget$/.test(call.path)) {
      return {
        status: 200,
        body: { budget_id: "budget-new", previous_budget_id: "b1" },
      };
    }
    if (route === "POST /key/block" || route === "POST /key/unblock") {
      return { status: 200, body: {} };
    }
    return base(call, attempt);
  };
}

export function installMemberWritesFake(
  state: Suite,
  opts: MemberFakeOptions = {},
) {
  state.fake = createFakeLiteLLM(memberWritesHandler(opts));
  vi.stubGlobal("fetch", state.fake.fetch);
}

// Alice and Bob are dashboard members of team-a with an identity (email) and
// no identity link; Alice is unknown to LiteLLM, Bob is a LiteLLM user. Carol
// has an identity only (not a member, no link).
export async function seedMemberPeople() {
  for (const p of [PEOPLE.alice, PEOPLE.bob, PEOPLE.carol]) {
    await seedIdentity(p.oid, { email: p.email, name: p.name });
  }
  // Dave has no stored IdentityLink, but his verified email is that of a
  // LiteLLM user who is a member of the linked team (resolved by email).
  await seedIdentity(PEOPLE.dave.oid, {
    email: MEMBER_A_LUSER,
    name: PEOPLE.dave.name,
  });
  await seedMember(PEOPLE.alice.oid, "team-a");
  await seedMember(PEOPLE.bob.oid, "team-a");
}

// Registers the suite hooks: the L3 org + links + identity links, the two
// extra people, and a fake LiteLLM that accepts the member writes.
export function setupMemberWritesSuite(): Suite {
  const state = setupViewsSuite();
  beforeEach(async () => {
    await seedMemberPeople();
    installMemberWritesFake(state);
  });
  return state;
}

// ---- requests, calls, audit -------------------------------------------------

export const writeCalls = (state: Suite) =>
  state.fake.calls.filter((c) => c.method !== "GET");
export const callsTo = (state: Suite, route: string) =>
  state.fake.calls.filter((c) => `${c.method} ${c.path}` === route);
export const bodyOf = (call: FakeCall | undefined) =>
  (call?.body ?? {}) as Record<string, unknown>;

export async function send(
  handler: RouteHandler,
  o: {
    method: string;
    path: string;
    params: Record<string, string>;
    body?: unknown;
  },
) {
  const res = await handler(
    new Request(`${BASE_URL}${o.path}`, {
      method: o.method,
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    }),
    { params: Promise.resolve(o.params) },
  );
  const text = await res.clone().text();
  return { res, text, body: JSON.parse(text) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function memberAudit() {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords(AUDIT_DAY)).filter((r) =>
    r.action.startsWith("litellm.member."),
  );
}

// Dashboard member removed (affiliation deleted): the LiteLLM membership stays
// (Identity mapping and members: removing a dashboard membership never changes
// LiteLLM).
export async function removeDashboardMembership(oid: string, teamId: string) {
  ok(
    await removeMember({ oid, teamId, version: 1 }, ctxAt(undefined, "req-rm")),
  );
}

// ---- the shared role x operation contract ------------------------------------

type Who = CallerName | "noRole";
const signIn = async (who: Who) => {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
};

export type MemberWriteSpec = {
  // Verb of the route and the fixed route pattern (recorded on `denied`).
  method: "POST" | "PATCH" | "DELETE";
  pattern: string;
  // The audit action of the operation (also the `denied` action).
  action: string;
  // The operation toggle (LD10); `defaultOff` operations are switched on first.
  toggleOp: string;
  defaultOff?: boolean;
  okStatus: 200 | 201;
  load: () => Promise<RouteHandler>;
  path: (teamId: string, oid: string) => string;
  // A body that would succeed for `oid` (the target of an allowed call).
  body?: unknown;
  // The dashboard person the allowed calls act on (default: member A).
  target?: string;
  // Add acts on a dashboard member; the other routes on a LiteLLM member.
  isAdd?: boolean;
};

const MATRIX: Array<[Who, string, "allow" | 403 | 404]> = [
  ["teamAdminA", "team-a", "allow"],
  ["deptAdminEng", "team-a", "allow"],
  ["orgAdmin", "team-a", "allow"],
  ["admin", "team-a", "allow"],
  ["teamAdminA", "team-b", 404],
  ["deptAdminEng", "team-c", 404],
  ["memberA", "team-a", 403],
  ["auditor", "team-a", 403],
  ["noRole", "team-a", 403],
];

// Registered once per route file. Sources: LiteLLM spec "Roles and rights"
// (Lead in scope, org-admin and Admin write; Viewer, member, Auditor never),
// "Writes" (Who, toggle default, audit), "Identity mapping and members", LT5,
// D17. The 401, 403-before-parse, 400, no-store and one-denied-per-refusal
// cases of the shared route-contract suite are not repeated here.
export function defineMemberWriteContract(state: Suite, spec: MemberWriteSpec) {
  const target = spec.target ?? CALLERS.memberA.oid;
  const run = async (team: string, oid = target, body = spec.body) =>
    send(await spec.load(), {
      method: spec.method,
      path: spec.path(team, oid),
      params: { teamId: team, oid },
      body,
    });
  const prepare = async () => {
    if (spec.defaultOff) await setToggles({ [spec.toggleOp]: true });
  };

  describe(`${spec.method} ${spec.pattern}: role x operation (Roles and rights; Writes)`, () => {
    beforeEach(prepare);

    it.each(MATRIX)("%s on %s is %s", async (who, team, expected) => {
      await signIn(who);
      const { res, body } = await run(team);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const records = await memberAudit();
      if (expected === "allow") {
        expect(res.status).toBe(spec.okStatus);
        expect(body.data).toBeDefined();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          action: spec.action,
          result: "success",
          category: "change",
          teamId: "team-a",
        });
        expect(writeCalls(state).length).toBeGreaterThan(0);
        return;
      }
      expect(res.status).toBe(expected);
      expect(body.error.code).toBe(
        expected === 403 ? "FORBIDDEN" : "NOT_FOUND",
      );
      expect(state.fake.calls).toHaveLength(0);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: spec.action,
        result: "denied",
        code: expected === 403 ? "FORBIDDEN" : "NOT_FOUND",
        route: { method: spec.method, pattern: spec.pattern },
      });
    });

    it("an out-of-scope team answers the same 404 body as a missing team (Enforcement 2)", async () => {
      signInAs("teamAdminA");
      const outOfScope = await run("team-b");
      const missing = await run("team-zzz");
      expect(outOfScope.res.status).toBe(404);
      expect(missing.res.status).toBe(404);
      expect(outOfScope.text).toBe(missing.text);
    });

    it("an in-scope team that is not linked to LiteLLM is 409 CONFLICT with no LiteLLM call (Identity mapping: not connected)", async () => {
      signInAs("admin");
      const { res } = await run("team-u");
      await expectError(res, 409, "CONFLICT");
      expect(state.fake.calls).toHaveLength(0);
    });

    it(`a disabled ${spec.toggleOp} is 403 OPERATION_DISABLED before any LiteLLM call, nothing audited (Toggles narrow only)`, async () => {
      await setToggles({ [spec.toggleOp]: false });
      signInAs("admin");
      const { res } = await run("team-a");
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
      expect(await memberAudit()).toHaveLength(0);
    });

    it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail and writes one failed audit record (error codes; Audit)", async () => {
      installMemberWritesFake(state, { outage: true });
      signInAs("admin");
      const { res, text } = await run("team-a");
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
      expect(text).not.toContain("fetch failed");
      const records = await memberAudit();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: spec.action,
        result: "failed",
        teamId: "team-a",
      });
      expect(records[0]?.target).toBeDefined();
    });

    if (!spec.isAdd) {
      it("a person who is not a member of the linked LiteLLM team (another team's member) is 404 with no LiteLLM write (LT5)", async () => {
        signInAs("admin");
        const { res } = await run("team-a", CALLERS.memberB.oid);
        await expectError(res, 404, "NOT_FOUND");
        expect(writeCalls(state)).toHaveLength(0);
      });

      it("no stored link and no LiteLLM user by the identity's email is 404 with no LiteLLM write (Resolution; LD13)", async () => {
        signInAs("admin");
        const { res } = await run("team-a", PEOPLE.carol.oid);
        await expectError(res, 404, "NOT_FOUND");
        expect(writeCalls(state)).toHaveLength(0);
      });

      it("no stored link but a LiteLLM user by the identity's verified email: the write proceeds with the user_id LiteLLM returned (LD13)", async () => {
        signInAs("admin");
        const { res } = await run("team-a", PEOPLE.dave.oid);
        expect(res.status).toBe(spec.okStatus);
        expect(callsTo(state, "GET /user/list").length).toBeGreaterThan(0);
        expect(writeCalls(state).length).toBeGreaterThan(0);
      });

      it("resolving by email writes no IdentityLink (identity links stay Admin configuration)", async () => {
        signInAs("admin");
        await run("team-a", PEOPLE.dave.oid);
        const { getIdentityLink } =
          await import("@/lib/data/access/identity-links");
        expect(await getIdentityLink(PEOPLE.dave.oid)).toBeNull();
      });
    }
  });
}
