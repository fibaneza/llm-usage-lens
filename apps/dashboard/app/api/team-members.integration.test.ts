import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import { seedSsoAffiliation } from "@/lib/data/access/access-test-support";
import { createPendingItem, listPendingFor } from "@/lib/data/access/pending";
import {
  CALLERS,
  MISSING,
  PEOPLE,
  affiliationOf,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  expectOneDenied,
  expectSameBody,
  invoke,
  nonAuditItems,
  seedCtx,
  seedMember,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/matrix-route-support";
import { clearTable, ensureTestTable } from "@/test/test-support";

import { DELETE } from "./teams/[id]/members/[oid]/route";
import { GET, POST } from "./teams/[id]/members/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/teams/[id]/members GET, POST; /api/teams/[id]/members/[oid] DELETE:
// per matrix), "Permission matrix" (add an unaffiliated user or pending
// email/UPN, remove a member: internal-admin, internal-org-admin any team,
// internal-team-admin on teams in scope), "Membership, admin scopes and
// lifecycle" (member of at most one team: 409 ALREADY_AFFILIATED; Joiner:
// pending item by email/UPN), "Identity, SSO mapping and defaults" (SSO > UI:
// 409 MANAGED_BY_SSO), "Enforcement" items 2 (403 before parsing; identical
// 404 for out-of-scope and missing), 4 (no-store), 6 (Zod, version -> 409,
// same-origin, JSON content type, body teamId equals path -> 400), "Audit log"
// (one success record per write; a 400, a 404 for a missing target and a 409
// write none; one `denied` per authorization refusal incl. an out-of-scope
// 404, D17/T22), threats T3, T10, T15. Contract: temp/run-r4/contract-slice1.md.
// Org (test/scope-fixtures.ts): team-a, team-b in dept-eng; team-c in dept-ops.
// Callers: admin, orgAdmin, teamAdminA (scope team-a), deptAdminEng (scope
// dept-eng), memberA/memberB (member only), viewerNone, auditor. Only `@/auth`
// is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const LIST = "/api/teams/[id]/members";
const ITEM = "/api/teams/[id]/members/[oid]";
const listPath = (team: string) => `/api/teams/${team}/members`;
const itemPath = (team: string, oid: string) => `${listPath(team)}/${oid}`;

const list = (team: string, query = "") =>
  invoke(GET, {
    method: "GET",
    path: `${listPath(team)}${query}`,
    params: { id: team },
  });
const add = (team: string, body: unknown, extra = {}) =>
  invoke(POST, {
    method: "POST",
    path: listPath(team),
    params: { id: team },
    body,
    ...extra,
  });
const remove = (team: string, oid: string, body: unknown, extra = {}) =>
  invoke(DELETE, {
    method: "DELETE",
    path: itemPath(team, oid),
    params: { id: team, oid },
    body,
    ...extra,
  });

type Member = { oid: string; teamId: string; source: string; version: number };
const alice = PEOPLE.alice;
const bob = PEOPLE.bob;
const carol = PEOPLE.carol;

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  signInAs("admin");
});

// Callers whose role holds the permission for team-a (matrix row 1 and 4).
const CAN_WRITE_TEAM_A: CallerName[] = [
  "admin",
  "orgAdmin",
  "teamAdminA",
  "deptAdminEng",
];
// No write permission at all: 403 whatever the target (matrix "Others").
const CANNOT_WRITE: CallerName[] = [
  "auditor",
  "viewerNone",
  "memberA",
  "memberB",
];

describe("GET /api/teams/[id]/members", () => {
  it("401 without a session", async () => {
    signInAs(null);
    await expectError(await list("team-a"), 401, "UNAUTHORIZED");
  });

  it.each([...CAN_WRITE_TEAM_A, "auditor"] as CallerName[])(
    "%s lists the team's members as { data: { items } } with no-store",
    async (caller) => {
      await seedMember(alice.oid, "team-a");
      await seedMember(bob.oid, "team-a");
      await seedMember(carol.oid, "team-b");
      signInAs(caller);
      const data = await expectData<{ items: Member[]; cursor?: string }>(
        await list("team-a"),
      );
      const oids = data.items.map((m) => m.oid);
      expect(oids).toEqual(
        expect.arrayContaining([alice.oid, bob.oid, CALLERS.memberA.oid]),
      );
      expect(oids).not.toContain(carol.oid);
      expect(oids).not.toContain(CALLERS.memberB.oid);
      for (const m of data.items) {
        expect(m).toMatchObject({ teamId: "team-a", source: "ui", version: 1 });
      }
      expect(data.cursor).toBeUndefined();
    },
  );

  it.each([...CAN_WRITE_TEAM_A, "auditor"] as CallerName[])(
    "%s sees displayName and email on each in-scope row, null when the identity is unknown, and no identity internals (F11)",
    async (caller) => {
      await seedMember(alice.oid, "team-a");
      signInAs(caller);
      const data = await expectData<{
        items: (Member & {
          displayName: string | null;
          email: string | null;
        })[];
      }>(await list("team-a"));
      const named = data.items.find((m) => m.oid === alice.oid);
      expect(named).toMatchObject({
        displayName: alice.name,
        email: alice.email,
      });
      // memberA signed in nowhere: no IDENT# item, so null, never a crash.
      const unknown = data.items.find((m) => m.oid === CALLERS.memberA.oid);
      expect(unknown).toMatchObject({ displayName: null, email: null });
      const text = JSON.stringify(data);
      for (const internal of ["failedAttempts", "lockedUntil", "authMethod"]) {
        expect(text).not.toContain(internal);
      }
    },
  );

  it("an empty team is 200 with no items", async () => {
    const data = await expectData<{ items: Member[] }>(await list("team-c"));
    expect(data.items).toEqual([]);
  });

  it.each([
    ["viewerNone", "team-a"],
    ["memberB", "team-a"],
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s reading %s gets the same 404 as a missing team, with no denied record (reads are metric-only)",
    async (caller, team) => {
      await seedMember(alice.oid, team);
      signInAs(caller);
      const outOfScope = await expectError(await list(team), 404, "NOT_FOUND");
      signInAs("admin");
      const missing = await expectError(await list(MISSING), 404, "NOT_FOUND");
      expectSameBody(outOfScope, missing, team, MISSING, alice.oid);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("paginates over GSI1 with ?limit and an opaque cursor, following it to the end", async () => {
    await seedMember(alice.oid, "team-c");
    await seedMember(bob.oid, "team-c");
    await seedMember(carol.oid, "team-c");
    const first = await expectData<{ items: Member[]; cursor?: string }>(
      await list("team-c", "?limit=2"),
    );
    expect(first.items).toHaveLength(2);
    expect(typeof first.cursor).toBe("string");
    expect(first.cursor).not.toContain("MEMBERS#");
    const second = await expectData<{ items: Member[]; cursor?: string }>(
      await list(
        "team-c",
        `?limit=2&cursor=${encodeURIComponent(first.cursor!)}`,
      ),
    );
    expect(second.items).toHaveLength(1);
    expect(second.cursor).toBeUndefined();
    expect([...first.items, ...second.items].map((m) => m.oid).sort()).toEqual(
      [alice.oid, bob.oid, carol.oid].sort(),
    );
  });

  it.each([
    ["a tampered cursor", "?limit=2&cursor=not-a-real-cursor"],
    ["a zero limit", "?limit=0"],
    ["a non-numeric limit", "?limit=abc"],
  ])("400 BAD_REQUEST for %s", async (_name, query) => {
    await seedMember(alice.oid, "team-a");
    await expectError(await list("team-a", query), 400, "BAD_REQUEST");
  });

  it.each(["x".repeat(129), "a\u0001b"])(
    "400 BAD_REQUEST for a malformed path id %j",
    async (id) => {
      await expectError(await list(id), 400, "BAD_REQUEST");
    },
  );
});

describe("POST /api/teams/[id]/members", () => {
  it.each(CAN_WRITE_TEAM_A)(
    "%s adds an unaffiliated user: a ui affiliation at version 1 and one affiliation.add success record",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<Member>(
        await add("team-a", { oid: alice.oid }),
        [200, 201],
      );
      expect(data).toMatchObject({
        oid: alice.oid,
        teamId: "team-a",
        source: "ui",
        version: 1,
      });
      expect(await affiliationOf(alice.oid)).toMatchObject({
        teamId: "team-a",
        source: "ui",
      });
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "affiliation.add",
        result: "success",
        category: "change",
        actor: CALLERS[caller].oid,
        teamId: "team-a",
      });
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("a department-scope admin adds to any team of the department (team-b), not only the first", async () => {
    signInAs("deptAdminEng");
    await expectData(await add("team-b", { oid: alice.oid }), [200, 201]);
    expect(await affiliationOf(alice.oid)).toMatchObject({ teamId: "team-b" });
  });

  it("accepts a body teamId that equals the path", async () => {
    await expectData(
      await add("team-a", { oid: alice.oid, teamId: "team-a" }),
      [200, 201],
    );
  });

  it("accepts application/json with a charset parameter", async () => {
    await expectData(
      await add(
        "team-a",
        { oid: alice.oid },
        { contentType: "application/json; charset=utf-8" },
      ),
      [200, 201],
    );
  });

  it.each([
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s adding to %s (out of scope): the same 404 as a missing team, nothing written, one denied NOT_FOUND record",
    async (caller, team) => {
      signInAs(caller);
      const before = await nonAuditItems();
      const outOfScope = await expectError(
        await add(team, { oid: alice.oid }),
        404,
        "NOT_FOUND",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await affiliationOf(alice.oid)).toBeNull();
      expect(await auditToday()).toHaveLength(1);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.add",
        code: "NOT_FOUND",
      });
      signInAs("admin");
      const missing = await expectError(
        await add(MISSING, { oid: alice.oid }),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, team, MISSING);
    },
  );

  it("an admin adding to a team that does not exist gets 404 and writes no record at all (the target is missing, not refused)", async () => {
    await expectError(await add(MISSING, { oid: alice.oid }), 404, "NOT_FOUND");
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("401 without a session, before anything is read or written", async () => {
    signInAs(null);
    const before = await nonAuditItems();
    await expectError(
      await add("team-a", { oid: alice.oid }),
      401,
      "UNAUTHORIZED",
    );
    expect(await nonAuditItems()).toEqual(before);
    expect(await auditToday()).toEqual([]);
  });

  describe.each(CANNOT_WRITE)("as %s (no write permission)", (caller) => {
    beforeEach(() => signInAs(caller));

    it("403 FORBIDDEN even for its own team, the table is untouched, one denied record with the fixed route pattern", async () => {
      const before = await nonAuditItems();
      await expectError(
        await add("team-a", { oid: alice.oid }),
        403,
        "FORBIDDEN",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await auditToday()).toHaveLength(1);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.add",
        code: "FORBIDDEN",
        route: { method: "POST", pattern: LIST },
      });
    });

    it("403 comes before parsing and before any read: a malformed id, malformed body, wrong content type and foreign origin all stay 403", async () => {
      const longId = "x".repeat(200);
      for (const call of [
        { team: "team-a", body: "{not json" },
        { team: "team-a", body: {} },
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
          await add(call.team, call.body, call.extra),
          403,
          "FORBIDDEN",
        );
      }
      expect(await affiliationOf(alice.oid)).toBeNull();
      await expectError(
        await add(longId, { oid: alice.oid }),
        403,
        "FORBIDDEN",
      );
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.add",
        code: "FORBIDDEN",
        route: { method: "POST", pattern: LIST },
        forbiddenRaw: [longId],
      });
    });
  });

  it("403 FORBIDDEN for a permitted caller with a missing or foreign Origin, before parsing; nothing is written", async () => {
    for (const origin of [
      null,
      "https://evil.example.test",
      "null",
      "http://localhost:4000",
    ]) {
      await expectError(
        await add("team-a", { oid: alice.oid }, { origin }),
        403,
        "FORBIDDEN",
      );
    }
    expect(await affiliationOf(alice.oid)).toBeNull();
    expect(
      await auditToday().then((r) => r.filter((x) => x.result === "success")),
    ).toEqual([]);
  });

  it.each([
    ["no Content-Type", null],
    ["text/plain", "text/plain"],
    ["form encoded", "application/x-www-form-urlencoded"],
  ])(
    "400 BAD_REQUEST for %s; nothing stored or audited",
    async (_n, contentType) => {
      await expectError(
        await add("team-a", { oid: alice.oid }, { contentType }),
        400,
        "BAD_REQUEST",
      );
      expect(await affiliationOf(alice.oid)).toBeNull();
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty object (neither oid nor emailOrUpn)", {}],
    ["a non-object body", "[]"],
    [
      "both oid and emailOrUpn",
      { oid: alice.oid, emailOrUpn: "alice@company.com" },
    ],
    ["an empty oid", { oid: "" }],
    ["an oid over 128 characters", { oid: "o".repeat(129) }],
    ["a non-string oid", { oid: 7 }],
    ["an emailOrUpn that is not an address", { emailOrUpn: "not an email" }],
    ["an empty emailOrUpn", { emailOrUpn: "" }],
    [
      "a body teamId that differs from the path",
      { oid: alice.oid, teamId: "team-b" },
    ],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, no record, no denied record",
    async (_n, body) => {
      await expectError(await add("team-a", body), 400, "BAD_REQUEST");
      expect(await affiliationOf(alice.oid)).toBeNull();
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each(["x".repeat(129), "a\u0001b"])(
    "400 BAD_REQUEST for a malformed path id %j (a permitted caller)",
    async (team) => {
      await expectError(
        await add(team, { oid: alice.oid }),
        400,
        "BAD_REQUEST",
      );
      expect(await auditToday()).toEqual([]);
    },
  );

  it("409 ALREADY_AFFILIATED when the user already has a member team (any team); use move; nothing new is audited", async () => {
    await seedMember(alice.oid, "team-b");
    for (const team of ["team-a", "team-b"]) {
      await expectError(
        await add(team, { oid: alice.oid }),
        409,
        "ALREADY_AFFILIATED",
      );
    }
    expect(await affiliationOf(alice.oid)).toMatchObject({ teamId: "team-b" });
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("409 ALREADY_AFFILIATED also when the existing affiliation is SSO-sourced", async () => {
    await seedSsoAffiliation(alice.oid, "team-b");
    await expectError(
      await add("team-a", { oid: alice.oid }),
      409,
      "ALREADY_AFFILIATED",
    );
    expect(await affiliationOf(alice.oid)).toMatchObject({
      teamId: "team-b",
      source: "sso",
    });
  });

  describe("a pending member (email or UPN not yet signed in)", () => {
    it("creates a pending affiliation with the address lower-cased, audited as pending.create; it grants no affiliation", async () => {
      signInAs("deptAdminEng");
      const data = await expectData<{
        kind: string;
        emailOrUpn: string;
        teamId: string;
      }>(
        await add("team-a", { emailOrUpn: "Jane.Doe@Company.com" }),
        [200, 201],
      );
      expect(data).toMatchObject({
        kind: "affiliation",
        emailOrUpn: "jane.doe@company.com",
        teamId: "team-a",
      });
      expect(await listPendingFor(["jane.doe@company.com"])).toHaveLength(1);
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "pending.create",
        result: "success",
        actor: CALLERS.deptAdminEng.oid,
      });
      const members = await expectData<{ items: Member[] }>(
        await list("team-a"),
      );
      expect(members.items.map((m) => m.oid).join()).not.toContain("jane");
    });

    it("409 ALREADY_AFFILIATED when the address already has a pending member item", async () => {
      await expectData(
        await add("team-a", { emailOrUpn: "jane@company.com" }),
        [200, 201],
      );
      await expectError(
        await add("team-b", { emailOrUpn: "JANE@company.com" }),
        409,
        "ALREADY_AFFILIATED",
      );
    });

    it("an out-of-scope team admin gets the 404 and one denied record, and no pending item is written", async () => {
      signInAs("teamAdminA");
      await expectError(
        await add("team-b", { emailOrUpn: "jane@company.com" }),
        404,
        "NOT_FOUND",
      );
      expect(await listPendingFor(["jane@company.com"])).toEqual([]);
      await expectOneDenied({
        actor: CALLERS.teamAdminA.oid,
        action: "affiliation.add",
        code: "NOT_FOUND",
      });
    });
  });
});

describe("DELETE /api/teams/[id]/members/[oid]", () => {
  it.each(CAN_WRITE_TEAM_A)(
    "%s removes a member at the current version: the affiliation is gone and one affiliation.remove success record is written",
    async (caller) => {
      await seedMember(alice.oid, "team-a");
      signInAs(caller);
      await expectData(await remove("team-a", alice.oid, { version: 1 }));
      expect(await affiliationOf(alice.oid)).toBeNull();
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "affiliation.remove",
        result: "success",
        category: "change",
        actor: CALLERS[caller].oid,
        teamId: "team-a",
      });
    },
  );

  it("404 NOT_FOUND for a user who is not a member of the path team (never the other team's member); no record at all", async () => {
    await seedMember(alice.oid, "team-b");
    const a = await expectError(
      await remove("team-a", alice.oid, { version: 1 }),
      404,
      "NOT_FOUND",
    );
    const b = await expectError(
      await remove("team-a", bob.oid, { version: 1 }),
      404,
      "NOT_FOUND",
    );
    expectSameBody(a, b, alice.oid, bob.oid);
    expect(await affiliationOf(alice.oid)).toMatchObject({ teamId: "team-b" });
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it.each([
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s removing from %s (out of scope): 404, the member stays, one denied NOT_FOUND record",
    async (caller, team) => {
      await seedMember(alice.oid, team);
      signInAs(caller);
      await expectError(
        await remove(team, alice.oid, { version: 1 }),
        404,
        "NOT_FOUND",
      );
      expect(await affiliationOf(alice.oid)).toMatchObject({ teamId: team });
      expect(await auditToday()).toHaveLength(1);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.remove",
        code: "NOT_FOUND",
      });
    },
  );

  it("401 without a session", async () => {
    await seedMember(alice.oid, "team-a");
    signInAs(null);
    await expectError(
      await remove("team-a", alice.oid, { version: 1 }),
      401,
      "UNAUTHORIZED",
    );
    expect(await affiliationOf(alice.oid)).not.toBeNull();
  });

  describe.each(CANNOT_WRITE)("as %s (no write permission)", (caller) => {
    beforeEach(() => signInAs(caller));

    it("403 before parsing and before any read, the member stays, one denied record with the fixed route pattern and no raw path", async () => {
      await seedMember(alice.oid, "team-a");
      const before = await nonAuditItems();
      const longId = "x".repeat(200);
      await expectError(
        await remove(longId, "also bad".repeat(40), "{not json"),
        403,
        "FORBIDDEN",
      );
      expect(await nonAuditItems()).toEqual(before);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.remove",
        code: "FORBIDDEN",
        route: { method: "DELETE", pattern: ITEM },
        forbiddenRaw: [longId],
      });
    });
  });

  it("403 for a permitted caller with a foreign Origin, before parsing; the member stays", async () => {
    await seedMember(alice.oid, "team-a");
    await expectError(
      await remove(
        "team-a",
        alice.oid,
        { version: 1 },
        {
          origin: "https://evil.example.test",
        },
      ),
      403,
      "FORBIDDEN",
    );
    expect(await affiliationOf(alice.oid)).not.toBeNull();
  });

  it("409 CONFLICT for a stale version; the member stays and nothing is audited", async () => {
    await seedMember(alice.oid, "team-a");
    await expectError(
      await remove("team-a", alice.oid, { version: 5 }),
      409,
      "CONFLICT",
    );
    expect(await affiliationOf(alice.oid)).toMatchObject({ version: 1 });
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("409 MANAGED_BY_SSO for an SSO-sourced affiliation (T10); the member stays and nothing is audited", async () => {
    await seedSsoAffiliation(alice.oid, "team-a");
    await expectError(
      await remove("team-a", alice.oid, { version: 1 }),
      409,
      "MANAGED_BY_SSO",
    );
    expect(await affiliationOf(alice.oid)).toMatchObject({ source: "sso" });
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it.each([
    ["no body", undefined],
    ["a body without a version", {}],
    ["a zero version", { version: 0 }],
    ["a non-integer version", { version: 1.5 }],
    ["a string version", { version: "1" }],
    ["invalid JSON", "{not json"],
  ])(
    "400 BAD_REQUEST for %s; the member stays, nothing audited",
    async (_n, body) => {
      await seedMember(alice.oid, "team-a");
      await expectError(
        await remove("team-a", alice.oid, body),
        400,
        "BAD_REQUEST",
      );
      expect(await affiliationOf(alice.oid)).not.toBeNull();
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("400 BAD_REQUEST for a wrong content type", async () => {
    await seedMember(alice.oid, "team-a");
    await expectError(
      await remove(
        "team-a",
        alice.oid,
        { version: 1 },
        { contentType: "text/plain" },
      ),
      400,
      "BAD_REQUEST",
    );
    expect(await affiliationOf(alice.oid)).not.toBeNull();
  });

  it.each(["x".repeat(129), "a\u0001b"])(
    "400 BAD_REQUEST for a malformed oid %j (a permitted caller)",
    async (oid) => {
      await expectError(
        await remove("team-a", oid, { version: 1 }),
        400,
        "BAD_REQUEST",
      );
      expect(await auditToday()).toEqual([]);
    },
  );

  describe("a pending member", () => {
    const pendingFor = async (team: string) => {
      const created = await createPendingItem(
        { kind: "affiliation", emailOrUpn: "jane@company.com", teamId: team },
        seedCtx(),
      );
      if (!created.ok) throw new Error(created.code);
    };

    it("is removed by its address at the current version, audited as pending.delete", async () => {
      await pendingFor("team-a");
      signInAs("deptAdminEng");
      await expectData(
        await remove("team-a", "jane@company.com", { version: 1 }),
      );
      expect(await listPendingFor(["jane@company.com"])).toEqual([]);
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "pending.delete",
        result: "success",
        actor: CALLERS.deptAdminEng.oid,
      });
    });

    it("an out-of-scope team admin gets 404 with one denied record and the pending item stays", async () => {
      await pendingFor("team-b");
      signInAs("teamAdminA");
      await expectError(
        await remove("team-b", "jane@company.com", { version: 1 }),
        404,
        "NOT_FOUND",
      );
      expect(await listPendingFor(["jane@company.com"])).toHaveLength(1);
      await expectOneDenied({
        actor: CALLERS.teamAdminA.oid,
        action: "affiliation.remove",
        code: "NOT_FOUND",
      });
    });
  });
});
