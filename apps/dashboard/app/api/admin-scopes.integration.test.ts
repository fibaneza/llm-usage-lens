import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import { seedSsoAdminScope } from "@/lib/data/access/access-test-support";
import { listPendingFor } from "@/lib/data/access/pending";
import {
  CALLERS,
  MISSING,
  PEOPLE,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  expectOneDenied,
  expectSameBody,
  invoke,
  nonAuditItems,
  scopesOf,
  seedAdminScope,
  seedMember,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/matrix-route-support";
import { clearTable, ensureTestTable } from "@/test/test-support";

import {
  GET as GET_DEPT,
  POST as POST_DEPT,
} from "./departments/[id]/admins/route";
import { DELETE as DELETE_DEPT } from "./departments/[id]/admins/[oid]/route";
import { DELETE as DELETE_TEAM } from "./teams/[id]/admins/[oid]/route";
import { GET as GET_TEAM, POST as POST_TEAM } from "./teams/[id]/admins/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/teams/[id]/admins and /api/departments/[id]/admins GET, POST; .../
// [oid] DELETE: per matrix), "Permission matrix" (grant or remove a team-scope
// internal-team-admin: internal-admin, internal-org-admin any team, a
// department-scope admin for teams in its department, a team-scope admin for
// its team but never its own scope; grant or remove a department-scope
// internal-team-admin: internal-admin and internal-org-admin only), "Roles"
// (team-scope admin grants never on themselves), "Identity, SSO mapping and
// defaults" (SSO > UI: 409 MANAGED_BY_SSO), "Enforcement" items 2, 4, 6,
// "Audit log" (D17/T22), threats T3, T10, T15. Spec: Access Control "API routes (additions)". A caller who holds the permission class but
// not the target scope gets the identical 404 (and one denied NOT_FOUND
// record); a caller with no such permission gets 403 whatever the target.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const TEAM_LIST = "/api/teams/[id]/admins";
const TEAM_ITEM = "/api/teams/[id]/admins/[oid]";
const DEPT_LIST = "/api/departments/[id]/admins";
const DEPT_ITEM = "/api/departments/[id]/admins/[oid]";

const teamList = (id: string, query = "") =>
  invoke(GET_TEAM, {
    method: "GET",
    path: `/api/teams/${id}/admins${query}`,
    params: { id },
  });
const grantTeam = (id: string, body: unknown, extra = {}) =>
  invoke(POST_TEAM, {
    method: "POST",
    path: `/api/teams/${id}/admins`,
    params: { id },
    body,
    ...extra,
  });
const revokeTeam = (id: string, oid: string, body: unknown, extra = {}) =>
  invoke(DELETE_TEAM, {
    method: "DELETE",
    path: `/api/teams/${id}/admins/${oid}`,
    params: { id, oid },
    body,
    ...extra,
  });
const deptList = (id: string, query = "") =>
  invoke(GET_DEPT, {
    method: "GET",
    path: `/api/departments/${id}/admins${query}`,
    params: { id },
  });
const grantDept = (id: string, body: unknown, extra = {}) =>
  invoke(POST_DEPT, {
    method: "POST",
    path: `/api/departments/${id}/admins`,
    params: { id },
    body,
    ...extra,
  });
const revokeDept = (id: string, oid: string, body: unknown, extra = {}) =>
  invoke(DELETE_DEPT, {
    method: "DELETE",
    path: `/api/departments/${id}/admins/${oid}`,
    params: { id, oid },
    body,
    ...extra,
  });

type Scope = {
  oid: string;
  scopeType: string;
  scopeId: string;
  source: string;
  version: number;
};
const alice = PEOPLE.alice;
const bob = PEOPLE.bob;

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  signInAs("admin");
});

const CANNOT_WRITE: CallerName[] = [
  "auditor",
  "viewerNone",
  "memberA",
  "memberB",
];

describe("team-scope admins: GET /api/teams/[id]/admins", () => {
  it.each([
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s lists the team's admins as { data: { items } } with no-store",
    async (caller) => {
      await seedAdminScope(alice.oid, "team", "team-a");
      await seedAdminScope(bob.oid, "team", "team-b");
      await seedAdminScope(alice.oid, "department", "dept-eng");
      signInAs(caller);
      const data = await expectData<{ items: Scope[]; cursor?: string }>(
        await teamList("team-a"),
      );
      // The team-scope item for team-a only: not another team's, not a
      // department scope.
      const mine = data.items.filter((s) => s.oid === alice.oid);
      expect(mine).toEqual([
        expect.objectContaining({
          scopeType: "team",
          scopeId: "team-a",
          source: "ui",
          version: 1,
        }),
      ]);
      expect(data.items.map((s) => s.oid)).not.toContain(bob.oid);
    },
  );

  it.each([
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s sees displayName and email on each in-scope team-admin row, null when the identity is unknown (F11)",
    async (caller) => {
      await seedAdminScope(alice.oid, "team", "team-a");
      signInAs(caller);
      const data = await expectData<{
        items: (Scope & { displayName: string | null; email: string | null })[];
      }>(await teamList("team-a"));
      expect(data.items.find((s) => s.oid === alice.oid)).toMatchObject({
        displayName: alice.name,
        email: alice.email,
      });
      // teamAdminA has no IDENT# item: null, not an error.
      expect(
        data.items.find((s) => s.oid === CALLERS.teamAdminA.oid),
      ).toMatchObject({ displayName: null, email: null });
      const text = JSON.stringify(data);
      for (const internal of ["failedAttempts", "lockedUntil", "authMethod"]) {
        expect(text).not.toContain(internal);
      }
    },
  );

  it.each([
    ["viewerNone", "team-a"],
    ["memberB", "team-a"],
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s reading %s gets the same 404 as a missing team and no denied record",
    async (caller, team) => {
      await seedAdminScope(bob.oid, "team", team);
      signInAs(caller);
      const outOfScope = await expectError(
        await teamList(team),
        404,
        "NOT_FOUND",
      );
      signInAs("admin");
      const missing = await expectError(
        await teamList(MISSING),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, team, MISSING, bob.oid);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("paginates with ?limit and an opaque cursor, following it to the end", async () => {
    await seedAdminScope(alice.oid, "team", "team-c");
    await seedAdminScope(bob.oid, "team", "team-c");
    await seedAdminScope(PEOPLE.carol.oid, "team", "team-c");
    const first = await expectData<{ items: Scope[]; cursor?: string }>(
      await teamList("team-c", "?limit=2"),
    );
    expect(first.items).toHaveLength(2);
    expect(typeof first.cursor).toBe("string");
    expect(first.cursor).not.toContain("ADMINS#");
    const second = await expectData<{ items: Scope[]; cursor?: string }>(
      await teamList(
        "team-c",
        `?limit=2&cursor=${encodeURIComponent(first.cursor!)}`,
      ),
    );
    expect(second.items).toHaveLength(1);
    expect(second.cursor).toBeUndefined();
  });

  it("400 BAD_REQUEST for a tampered cursor and for a malformed path id", async () => {
    await expectError(
      await teamList("team-a", "?cursor=not-a-real-cursor"),
      400,
      "BAD_REQUEST",
    );
    await expectError(await teamList("x".repeat(129)), 400, "BAD_REQUEST");
  });
});

describe("team-scope admins: POST /api/teams/[id]/admins", () => {
  it.each(["admin", "orgAdmin", "deptAdminEng", "teamAdminA"] as const)(
    "%s grants a team-scope admin on team-a: a ui scope at version 1 and one adminscope.grant success record",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<Scope>(
        await grantTeam("team-a", { oid: alice.oid }),
        [200, 201],
      );
      expect(data).toMatchObject({
        oid: alice.oid,
        scopeType: "team",
        scopeId: "team-a",
        source: "ui",
        version: 1,
      });
      expect(await scopesOf(alice.oid)).toEqual([
        expect.objectContaining({ scopeType: "team", scopeId: "team-a" }),
      ]);
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "adminscope.grant",
        result: "success",
        category: "change",
        actor: CALLERS[caller].oid,
        teamId: "team-a",
      });
    },
  );

  it("a department-scope admin grants on another team of its department (team-b)", async () => {
    signInAs("deptAdminEng");
    await expectData(await grantTeam("team-b", { oid: alice.oid }), [200, 201]);
    expect(await scopesOf(alice.oid)).toEqual([
      expect.objectContaining({ scopeId: "team-b" }),
    ]);
  });

  it.each([
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s granting on %s (out of scope): the same 404 as a missing team, nothing written, one denied NOT_FOUND record",
    async (caller, team) => {
      signInAs(caller);
      const before = await nonAuditItems();
      const outOfScope = await expectError(
        await grantTeam(team, { oid: alice.oid }),
        404,
        "NOT_FOUND",
      );
      expect(await nonAuditItems()).toEqual(before);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "adminscope.grant",
        code: "NOT_FOUND",
      });
      signInAs("admin");
      const missing = await expectError(
        await grantTeam(MISSING, { oid: alice.oid }),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, team, MISSING);
    },
  );

  it("an admin granting on a team that does not exist gets 404 and no record at all", async () => {
    await expectError(
      await grantTeam(MISSING, { oid: alice.oid }),
      404,
      "NOT_FOUND",
    );
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  describe.each(CANNOT_WRITE)("as %s (no write permission)", (caller) => {
    beforeEach(() => signInAs(caller));

    it("403 FORBIDDEN even for its own team, nothing written, one denied record with the fixed route pattern", async () => {
      const before = await nonAuditItems();
      await expectError(
        await grantTeam("team-a", { oid: alice.oid }),
        403,
        "FORBIDDEN",
      );
      expect(await nonAuditItems()).toEqual(before);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "adminscope.grant",
        code: "FORBIDDEN",
        route: { method: "POST", pattern: TEAM_LIST },
      });
    });

    it("403 comes before parsing: a malformed id, body, content type and origin all stay 403", async () => {
      const longId = "x".repeat(200);
      for (const call of [
        { team: "team-a", body: "{not json" },
        { team: longId, body: { oid: alice.oid } },
        {
          team: "team-a",
          body: { oid: alice.oid },
          extra: { contentType: "text/plain" },
        },
        {
          team: "team-a",
          body: { oid: alice.oid },
          extra: { origin: "https://evil.example.test" },
        },
      ]) {
        await expectError(
          await grantTeam(call.team, call.body, call.extra),
          403,
          "FORBIDDEN",
        );
      }
      expect(await scopesOf(alice.oid)).toEqual([]);
    });
  });

  it("a team-scope admin cannot grant their own scope (matrix: never their own scope): 403 and one denied FORBIDDEN record", async () => {
    signInAs("teamAdminA");
    const before = await nonAuditItems();
    await expectError(
      await grantTeam("team-a", { oid: CALLERS.teamAdminA.oid }),
      403,
      "FORBIDDEN",
    );
    expect(await nonAuditItems()).toEqual(before);
    await expectOneDenied({
      actor: CALLERS.teamAdminA.oid,
      action: "adminscope.grant",
      code: "FORBIDDEN",
    });
  });

  it("409 CONFLICT when the person already holds the scope; nothing new is audited", async () => {
    await seedAdminScope(alice.oid, "team", "team-a");
    await expectError(
      await grantTeam("team-a", { oid: alice.oid }),
      409,
      "CONFLICT",
    );
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("a person with a member team can also be a team admin elsewhere (independent items)", async () => {
    await seedMember(alice.oid, "team-c");
    await expectData(await grantTeam("team-a", { oid: alice.oid }), [200, 201]);
  });

  it.each([
    ["no Content-Type", null],
    ["text/plain", "text/plain"],
  ])(
    "400 BAD_REQUEST for %s; nothing stored or audited",
    async (_n, contentType) => {
      await expectError(
        await grantTeam("team-a", { oid: alice.oid }, { contentType }),
        400,
        "BAD_REQUEST",
      );
      expect(await scopesOf(alice.oid)).toEqual([]);
      expect(await auditToday()).toEqual([]);
    },
  );

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty object", {}],
    [
      "both oid and emailOrUpn",
      { oid: alice.oid, emailOrUpn: "a@company.com" },
    ],
    ["an empty oid", { oid: "" }],
    ["an oid over 128 characters", { oid: "o".repeat(129) }],
    ["an emailOrUpn that is not an address", { emailOrUpn: "not an email" }],
    [
      "a body teamId that differs from the path",
      { oid: alice.oid, teamId: "team-b" },
    ],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, no record, no denied record",
    async (_n, body) => {
      await expectError(await grantTeam("team-a", body), 400, "BAD_REQUEST");
      expect(await scopesOf(alice.oid)).toEqual([]);
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("a pending admin (email not yet signed in) is created with the address lower-cased and audited as pending.create", async () => {
    signInAs("teamAdminA");
    const data = await expectData<{
      kind: string;
      emailOrUpn: string;
      scopeType: string;
      scopeId: string;
    }>(
      await grantTeam("team-a", { emailOrUpn: "Jane@Company.com" }),
      [200, 201],
    );
    expect(data).toMatchObject({
      kind: "adminScope",
      emailOrUpn: "jane@company.com",
      scopeType: "team",
      scopeId: "team-a",
    });
    expect(await listPendingFor(["jane@company.com"])).toHaveLength(1);
    const records = await auditToday();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: "pending.create" });
  });
});

describe("team-scope admins: DELETE /api/teams/[id]/admins/[oid]", () => {
  it.each(["admin", "orgAdmin", "deptAdminEng", "teamAdminA"] as const)(
    "%s revokes another person's team-scope admin at the current version: the scope is gone, one adminscope.revoke success record",
    async (caller) => {
      await seedAdminScope(alice.oid, "team", "team-a");
      signInAs(caller);
      await expectData(await revokeTeam("team-a", alice.oid, { version: 1 }));
      expect(await scopesOf(alice.oid)).toEqual([]);
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "adminscope.revoke",
        result: "success",
        actor: CALLERS[caller].oid,
        teamId: "team-a",
      });
    },
  );

  it("revoking the team scope leaves the person's other scopes untouched", async () => {
    await seedAdminScope(alice.oid, "team", "team-a");
    await seedAdminScope(alice.oid, "team", "team-b");
    await seedAdminScope(alice.oid, "department", "dept-eng");
    await expectData(await revokeTeam("team-a", alice.oid, { version: 1 }));
    expect((await scopesOf(alice.oid)).map((s) => s.scopeId).sort()).toEqual([
      "dept-eng",
      "team-b",
    ]);
  });

  it("a team-scope admin cannot remove their own scope: 403, the scope stays, one denied FORBIDDEN record", async () => {
    signInAs("teamAdminA");
    const before = await nonAuditItems();
    await expectError(
      await revokeTeam("team-a", CALLERS.teamAdminA.oid, { version: 1 }),
      403,
      "FORBIDDEN",
    );
    expect(await nonAuditItems()).toEqual(before);
    await expectOneDenied({
      actor: CALLERS.teamAdminA.oid,
      action: "adminscope.revoke",
      code: "FORBIDDEN",
    });
  });

  it("404 NOT_FOUND for a person without that team scope (a department scope is not a team scope); no record at all", async () => {
    await seedAdminScope(alice.oid, "department", "dept-eng");
    const a = await expectError(
      await revokeTeam("team-a", alice.oid, { version: 1 }),
      404,
      "NOT_FOUND",
    );
    const b = await expectError(
      await revokeTeam("team-a", bob.oid, { version: 1 }),
      404,
      "NOT_FOUND",
    );
    expectSameBody(a, b, alice.oid, bob.oid);
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it.each([
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s revoking on %s (out of scope): 404, the scope stays, one denied NOT_FOUND record",
    async (caller, team) => {
      await seedAdminScope(bob.oid, "team", team);
      signInAs(caller);
      await expectError(
        await revokeTeam(team, bob.oid, { version: 1 }),
        404,
        "NOT_FOUND",
      );
      expect(await scopesOf(bob.oid)).toHaveLength(1);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "adminscope.revoke",
        code: "NOT_FOUND",
      });
    },
  );

  describe.each(CANNOT_WRITE)("as %s (no write permission)", (caller) => {
    it("403 before parsing and before any read, the scope stays, one denied record with the fixed route pattern and no raw path", async () => {
      await seedAdminScope(alice.oid, "team", "team-a");
      signInAs(caller);
      const before = await nonAuditItems();
      const longId = "x".repeat(200);
      await expectError(
        await revokeTeam(longId, longId, "{not json"),
        403,
        "FORBIDDEN",
      );
      expect(await nonAuditItems()).toEqual(before);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "adminscope.revoke",
        code: "FORBIDDEN",
        route: { method: "DELETE", pattern: TEAM_ITEM },
        forbiddenRaw: [longId],
      });
    });
  });

  it("409 CONFLICT for a stale version; the scope stays and nothing is audited", async () => {
    await seedAdminScope(alice.oid, "team", "team-a");
    await expectError(
      await revokeTeam("team-a", alice.oid, { version: 7 }),
      409,
      "CONFLICT",
    );
    expect(await scopesOf(alice.oid)).toHaveLength(1);
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("409 MANAGED_BY_SSO for an SSO-sourced scope (T10); it stays and nothing is audited", async () => {
    await seedSsoAdminScope(alice.oid, "team", "team-a");
    await expectError(
      await revokeTeam("team-a", alice.oid, { version: 1 }),
      409,
      "MANAGED_BY_SSO",
    );
    expect(await scopesOf(alice.oid)).toEqual([
      expect.objectContaining({ source: "sso" }),
    ]);
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it.each([
    ["no body", undefined],
    ["a body without a version", {}],
    ["a zero version", { version: 0 }],
    ["a string version", { version: "1" }],
    ["invalid JSON", "{not json"],
  ])(
    "400 BAD_REQUEST for %s; the scope stays, nothing audited",
    async (_n, body) => {
      await seedAdminScope(alice.oid, "team", "team-a");
      await expectError(
        await revokeTeam("team-a", alice.oid, body),
        400,
        "BAD_REQUEST",
      );
      expect(await scopesOf(alice.oid)).toHaveLength(1);
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );
});

describe("department-scope admins (internal-admin and internal-org-admin only)", () => {
  describe("GET /api/departments/[id]/admins", () => {
    it.each(["admin", "orgAdmin", "auditor", "deptAdminEng"] as const)(
      "%s lists the department's admins with no-store",
      async (caller) => {
        await seedAdminScope(alice.oid, "department", "dept-eng");
        await seedAdminScope(bob.oid, "department", "dept-ops");
        signInAs(caller);
        const data = await expectData<{ items: Scope[] }>(
          await deptList("dept-eng"),
        );
        expect(
          data.items.filter(
            (s) => s.oid === alice.oid && s.scopeType === "department",
          ),
        ).toHaveLength(1);
        expect(data.items.map((s) => s.oid)).not.toContain(bob.oid);
      },
    );

    it.each(["admin", "orgAdmin", "auditor", "deptAdminEng"] as const)(
      "%s sees displayName and email on each in-scope department-admin row, null when the identity is unknown (F11)",
      async (caller) => {
        await seedAdminScope(alice.oid, "department", "dept-eng");
        signInAs(caller);
        const data = await expectData<{
          items: (Scope & {
            displayName: string | null;
            email: string | null;
          })[];
        }>(await deptList("dept-eng"));
        expect(data.items.find((s) => s.oid === alice.oid)).toMatchObject({
          displayName: alice.name,
          email: alice.email,
        });
        expect(
          data.items.find((s) => s.oid === CALLERS.deptAdminEng.oid),
        ).toMatchObject({ displayName: null, email: null });
      },
    );

    it.each([
      ["viewerNone", "dept-eng"],
      ["memberA", "dept-eng"],
      ["deptAdminEng", "dept-ops"],
    ] as const)(
      "%s reading %s gets the same 404 as a missing department, no denied record",
      async (caller, dept) => {
        signInAs(caller);
        const outOfScope = await expectError(
          await deptList(dept),
          404,
          "NOT_FOUND",
        );
        signInAs("admin");
        const missing = await expectError(
          await deptList(MISSING),
          404,
          "NOT_FOUND",
        );
        expectSameBody(outOfScope, missing, dept, MISSING);
        expect(await deniedToday()).toEqual([]);
      },
    );
  });

  describe("POST /api/departments/[id]/admins", () => {
    it.each(["admin", "orgAdmin"] as const)(
      "%s grants a department-scope admin: a ui scope at version 1 and one adminscope.grant success record",
      async (caller) => {
        signInAs(caller);
        const data = await expectData<Scope>(
          await grantDept("dept-eng", { oid: alice.oid }),
          [200, 201],
        );
        expect(data).toMatchObject({
          oid: alice.oid,
          scopeType: "department",
          scopeId: "dept-eng",
          source: "ui",
          version: 1,
        });
        const records = await auditToday();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          action: "adminscope.grant",
          result: "success",
          actor: CALLERS[caller].oid,
        });
      },
    );

    it.each([
      "deptAdminEng",
      "teamAdminA",
      "auditor",
      "viewerNone",
      "memberA",
    ] as const)(
      "%s: 403 FORBIDDEN (even for its own department), nothing written, one denied record with the fixed route pattern",
      async (caller) => {
        signInAs(caller);
        const before = await nonAuditItems();
        await expectError(
          await grantDept("dept-eng", { oid: alice.oid }),
          403,
          "FORBIDDEN",
        );
        // 403 before parsing and before the target is looked up.
        await expectError(
          await grantDept("x".repeat(200), "{not json"),
          403,
          "FORBIDDEN",
        );
        expect(await nonAuditItems()).toEqual(before);
        await expectOneDenied({
          actor: CALLERS[caller].oid,
          action: "adminscope.grant",
          code: "FORBIDDEN",
          route: { method: "POST", pattern: DEPT_LIST },
        });
      },
    );

    it("an admin granting on a department that does not exist gets 404 and no record", async () => {
      await expectError(
        await grantDept(MISSING, { oid: alice.oid }),
        404,
        "NOT_FOUND",
      );
      expect(await auditToday()).toEqual([]);
    });

    it("409 CONFLICT when the person already holds the department scope", async () => {
      await seedAdminScope(alice.oid, "department", "dept-eng");
      await expectError(
        await grantDept("dept-eng", { oid: alice.oid }),
        409,
        "CONFLICT",
      );
      expect(await auditToday()).toEqual([]);
    });

    it.each([
      ["invalid JSON", "{not json"],
      ["an empty object", {}],
      [
        "a body departmentId that differs from the path",
        { oid: alice.oid, departmentId: "dept-ops" },
      ],
      ["an oid over 128 characters", { oid: "o".repeat(129) }],
    ])(
      "400 BAD_REQUEST for %s; nothing stored, nothing audited",
      async (_n, body) => {
        await expectError(
          await grantDept("dept-eng", body),
          400,
          "BAD_REQUEST",
        );
        expect(await scopesOf(alice.oid)).toEqual([]);
        expect(await auditToday()).toEqual([]);
        expect(await deniedToday()).toEqual([]);
      },
    );

    it("accepts a body departmentId that equals the path", async () => {
      await expectData(
        await grantDept("dept-eng", {
          oid: alice.oid,
          departmentId: "dept-eng",
        }),
        [200, 201],
      );
    });

    it("a pending department admin is created as pending.create", async () => {
      const data = await expectData<{ kind: string; scopeType: string }>(
        await grantDept("dept-eng", { emailOrUpn: "jane@company.com" }),
        [200, 201],
      );
      expect(data).toMatchObject({
        kind: "adminScope",
        scopeType: "department",
      });
      expect((await auditToday())[0]).toMatchObject({
        action: "pending.create",
      });
    });
  });

  describe("DELETE /api/departments/[id]/admins/[oid]", () => {
    it.each(["admin", "orgAdmin"] as const)(
      "%s revokes a department-scope admin at the current version with one adminscope.revoke success record",
      async (caller) => {
        await seedAdminScope(alice.oid, "department", "dept-eng");
        signInAs(caller);
        await expectData(
          await revokeDept("dept-eng", alice.oid, { version: 1 }),
        );
        expect(await scopesOf(alice.oid)).toEqual([]);
        const records = await auditToday();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          action: "adminscope.revoke",
          result: "success",
          actor: CALLERS[caller].oid,
        });
      },
    );

    it.each([
      "deptAdminEng",
      "teamAdminA",
      "auditor",
      "viewerNone",
      "memberA",
    ] as const)(
      "%s: 403 FORBIDDEN before parsing, the scope stays, one denied record with the fixed route pattern",
      async (caller) => {
        await seedAdminScope(alice.oid, "department", "dept-eng");
        signInAs(caller);
        const before = await nonAuditItems();
        await expectError(
          await revokeDept("x".repeat(200), "y".repeat(200), "{not json"),
          403,
          "FORBIDDEN",
        );
        expect(await nonAuditItems()).toEqual(before);
        await expectOneDenied({
          actor: CALLERS[caller].oid,
          action: "adminscope.revoke",
          code: "FORBIDDEN",
          route: { method: "DELETE", pattern: DEPT_ITEM },
        });
      },
    );

    it("404 for a person without the department scope, and for a missing department; no record", async () => {
      await seedAdminScope(alice.oid, "team", "team-a");
      await expectError(
        await revokeDept("dept-eng", alice.oid, { version: 1 }),
        404,
        "NOT_FOUND",
      );
      await expectError(
        await revokeDept(MISSING, alice.oid, { version: 1 }),
        404,
        "NOT_FOUND",
      );
      expect(await auditToday()).toEqual([]);
    });

    it("409 CONFLICT for a stale version", async () => {
      await seedAdminScope(alice.oid, "department", "dept-eng");
      await expectError(
        await revokeDept("dept-eng", alice.oid, { version: 3 }),
        409,
        "CONFLICT",
      );
      expect(await scopesOf(alice.oid)).toHaveLength(1);
      expect(await auditToday()).toEqual([]);
    });

    it("409 MANAGED_BY_SSO for an SSO-sourced department scope", async () => {
      await seedSsoAdminScope(alice.oid, "department", "dept-eng");
      await expectError(
        await revokeDept("dept-eng", alice.oid, { version: 1 }),
        409,
        "MANAGED_BY_SSO",
      );
      expect(await scopesOf(alice.oid)).toHaveLength(1);
      expect(await auditToday()).toEqual([]);
    });

    it("400 BAD_REQUEST without a version", async () => {
      await seedAdminScope(alice.oid, "department", "dept-eng");
      await expectError(
        await revokeDept("dept-eng", alice.oid, {}),
        400,
        "BAD_REQUEST",
      );
      expect(await scopesOf(alice.oid)).toHaveLength(1);
    });
  });
});
