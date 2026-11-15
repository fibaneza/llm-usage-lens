import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import { seedSsoAffiliation } from "@/lib/data/access/access-test-support";
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
  scopesOf,
  seedAdminScope,
  seedMember,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/matrix-route-support";
import { clearTable, ensureTestTable } from "@/test/test-support";

import { POST } from "./affiliations/[oid]/move/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (POST /api/affiliations/[oid]/move { fromTeamId, toTeamId, version }: per
// matrix), "Membership, admin scopes and lifecycle" (Mover: needs authority
// over both teams; one atomic transaction with the version condition and one
// affiliation.move audit record; removes the team-scope admin on the source
// team in the same transaction, other scopes unaffected; refused for an
// SSO-sourced affiliation: 409 MANAGED_BY_SSO), "Permission matrix" (move:
// internal-admin, internal-org-admin, a department-scope admin with both teams
// in scope; a team-scope admin never), "Enforcement" items 2, 4, 6, "Audit
// log" (D17/T22), threats T3, T9, T10, T11, T15. Contract: contract-slice1.md.
// A caller who may move in general but lacks one of the two teams gets the
// identical 404 plus one denied NOT_FOUND record; a team-scope admin or any
// non-writer gets 403 whatever the teams. Data layer: moveMember.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const PATTERN = "/api/affiliations/[oid]/move";
const alice = PEOPLE.alice;

const move = (oid: string, body: unknown, extra = {}) =>
  invoke(POST, {
    method: "POST",
    path: `/api/affiliations/${oid}/move`,
    params: { oid },
    body,
    ...extra,
  });
const req = (from: string, to: string, version = 1) => ({
  fromTeamId: from,
  toTeamId: to,
  version,
});

type Member = { oid: string; teamId: string; source: string; version: number };

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  await seedMember(alice.oid, "team-a");
  signInAs("admin");
});

describe("POST /api/affiliations/[oid]/move", () => {
  it.each([
    ["admin", "team-b"],
    ["admin", "team-c"],
    ["orgAdmin", "team-c"],
    ["deptAdminEng", "team-b"],
  ] as const)(
    "%s moves a member team-a -> %s: the affiliation follows at version + 1 and exactly one affiliation.move success record is written",
    async (caller, to) => {
      signInAs(caller);
      const data = await expectData<Member>(
        await move(alice.oid, req("team-a", to)),
      );
      expect(data).toMatchObject({
        oid: alice.oid,
        teamId: to,
        source: "ui",
        version: 2,
      });
      expect(await affiliationOf(alice.oid)).toMatchObject({
        teamId: to,
        version: 2,
      });
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "affiliation.move",
        result: "success",
        category: "change",
        actor: CALLERS[caller].oid,
        teamId: to,
      });
    },
  );

  it("T9: the move removes the team-scope admin on the source team in the same transaction and leaves every other scope; no separate revoke is audited", async () => {
    await seedAdminScope(alice.oid, "team", "team-a");
    await seedAdminScope(alice.oid, "team", "team-c");
    await seedAdminScope(alice.oid, "department", "dept-eng");
    await expectData(await move(alice.oid, req("team-a", "team-b")));
    expect(
      (await scopesOf(alice.oid))
        .map((s) => `${s.scopeType}:${s.scopeId}`)
        .sort(),
    ).toEqual(["department:dept-eng", "team:team-c"]);
    const records = await auditToday();
    expect(records).toHaveLength(1);
    expect(records[0]?.action).toBe("affiliation.move");
  });

  it("a member with no admin scope moves cleanly (nothing to remove)", async () => {
    await expectData(await move(alice.oid, req("team-a", "team-c")));
    expect(await scopesOf(alice.oid)).toEqual([]);
  });

  it.each([
    ["deptAdminEng", "team-a", "team-c"],
    ["deptAdminEng", "team-c", "team-a"],
  ] as const)(
    "%s moving %s -> %s (one of the two teams is out of scope; authority over both is required): the same 404 as a missing team, nothing changes, one denied NOT_FOUND record",
    async (caller, from, to) => {
      if (from === "team-c") {
        await seedMember(PEOPLE.bob.oid, "team-c");
      }
      const person = from === "team-c" ? PEOPLE.bob.oid : alice.oid;
      signInAs(caller);
      const before = await nonAuditItems();
      const outOfScope = await expectError(
        await move(person, req(from, to)),
        404,
        "NOT_FOUND",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await auditToday()).toHaveLength(1);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.move",
        code: "NOT_FOUND",
      });
      signInAs("admin");
      const missing = await expectError(
        await move(person, req(MISSING, MISSING)),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, "team-c", MISSING);
    },
  );

  describe.each([
    "teamAdminA",
    "auditor",
    "viewerNone",
    "memberA",
    "memberB",
  ] as CallerName[])("as %s (no move permission)", (caller) => {
    beforeEach(() => signInAs(caller));

    it("403 FORBIDDEN even between teams it can otherwise see (a team-scope admin removes; the destination admin adds), nothing changes, one denied record with the fixed route pattern", async () => {
      const before = await nonAuditItems();
      await expectError(
        await move(alice.oid, req("team-a", "team-b")),
        403,
        "FORBIDDEN",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await auditToday()).toHaveLength(1);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.move",
        code: "FORBIDDEN",
        route: { method: "POST", pattern: PATTERN },
      });
    });

    it("403 comes before parsing: a malformed oid, body, content type and origin all stay 403", async () => {
      const longId = "x".repeat(200);
      for (const call of [
        { oid: alice.oid, body: "{not json" },
        { oid: alice.oid, body: {} },
        { oid: longId, body: req("team-a", "team-b") },
        {
          oid: alice.oid,
          body: req("team-a", "team-b"),
          extra: { contentType: "text/plain" },
        },
        {
          oid: alice.oid,
          body: req("team-a", "team-b"),
          extra: { origin: "https://evil.example.test" },
        },
      ]) {
        await expectError(
          await move(call.oid, call.body, call.extra),
          403,
          "FORBIDDEN",
        );
      }
      await expectError(
        await move(longId, req("team-a", "team-b")),
        403,
        "FORBIDDEN",
      );
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.move",
        code: "FORBIDDEN",
        route: { method: "POST", pattern: PATTERN },
        forbiddenRaw: [longId],
      });
      expect(await affiliationOf(alice.oid)).toMatchObject({
        teamId: "team-a",
      });
    });
  });

  it("409 CONFLICT for a stale version; the member, the source scope and the audit log are unchanged", async () => {
    await seedAdminScope(alice.oid, "team", "team-a");
    await expectError(
      await move(alice.oid, req("team-a", "team-b", 9)),
      409,
      "CONFLICT",
    );
    expect(await affiliationOf(alice.oid)).toMatchObject({
      teamId: "team-a",
      version: 1,
    });
    expect(await scopesOf(alice.oid)).toHaveLength(1);
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("409 CONFLICT when the same version is replayed after a successful move", async () => {
    await expectData(await move(alice.oid, req("team-a", "team-b")));
    await expectError(
      await move(alice.oid, req("team-a", "team-b")),
      409,
      "CONFLICT",
    );
  });

  it("409 MANAGED_BY_SSO for an SSO-sourced affiliation (T10); nothing changes and nothing is audited", async () => {
    await clearTable();
    await seedWorld();
    await seedSsoAffiliation(alice.oid, "team-a");
    await expectError(
      await move(alice.oid, req("team-a", "team-b")),
      409,
      "MANAGED_BY_SSO",
    );
    expect(await affiliationOf(alice.oid)).toMatchObject({
      teamId: "team-a",
      source: "sso",
    });
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("404 NOT_FOUND for a person with no affiliation in the source team, and for a destination team that does not exist; no record at all", async () => {
    const noAffiliation = await expectError(
      await move(PEOPLE.bob.oid, req("team-a", "team-b")),
      404,
      "NOT_FOUND",
    );
    const wrongSource = await expectError(
      await move(alice.oid, req("team-b", "team-c")),
      404,
      "NOT_FOUND",
    );
    const missingDestination = await expectError(
      await move(alice.oid, req("team-a", MISSING)),
      404,
      "NOT_FOUND",
    );
    expectSameBody(noAffiliation, wrongSource, alice.oid, PEOPLE.bob.oid);
    expectSameBody(noAffiliation, missingDestination, MISSING);
    expect(await affiliationOf(alice.oid)).toMatchObject({ teamId: "team-a" });
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("refuses a move to the team the member is already in without changing anything (400 or 409)", async () => {
    const res = await move(alice.oid, req("team-a", "team-a"));
    expect([400, 409]).toContain(res.status);
    expect(await affiliationOf(alice.oid)).toMatchObject({
      teamId: "team-a",
      version: 1,
    });
    expect(await auditToday()).toEqual([]);
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty object", {}],
    ["a non-object body", "[]"],
    ["a missing fromTeamId", { toTeamId: "team-b", version: 1 }],
    ["a missing toTeamId", { fromTeamId: "team-a", version: 1 }],
    ["a missing version", { fromTeamId: "team-a", toTeamId: "team-b" }],
    ["a zero version", req("team-a", "team-b", 0)],
    ["a non-integer version", req("team-a", "team-b", 1.5)],
    ["a string version", { ...req("team-a", "team-b"), version: "1" }],
    ["an empty fromTeamId", req("", "team-b")],
    ["a toTeamId over 128 characters", req("team-a", "t".repeat(129))],
  ])(
    "400 BAD_REQUEST for %s; nothing changes, no record, no denied record",
    async (_n, body) => {
      await expectError(await move(alice.oid, body), 400, "BAD_REQUEST");
      expect(await affiliationOf(alice.oid)).toMatchObject({
        teamId: "team-a",
      });
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each([
    ["no Content-Type", null],
    ["text/plain", "text/plain"],
  ])("400 BAD_REQUEST for %s", async (_n, contentType) => {
    await expectError(
      await move(alice.oid, req("team-a", "team-b"), { contentType }),
      400,
      "BAD_REQUEST",
    );
    expect(await affiliationOf(alice.oid)).toMatchObject({ teamId: "team-a" });
  });

  it.each(["x".repeat(129), "a\u0001b"])(
    "400 BAD_REQUEST for a malformed path oid %j (a permitted caller)",
    async (oid) => {
      await expectError(
        await move(oid, req("team-a", "team-b")),
        400,
        "BAD_REQUEST",
      );
      expect(await auditToday()).toEqual([]);
    },
  );
});
