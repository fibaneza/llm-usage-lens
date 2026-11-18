import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import { revokeAdminScope } from "@/lib/data/access/admin-scopes";
import { listPendingFor } from "@/lib/data/access/pending";
import { grantRole } from "@/lib/data/access/role-grants";
import { seedSsoAffiliation } from "@/test/support/access-test-support";
import {
  FOREIGN_TENANT,
  JANE_OID,
  KEY,
  OTHER_OID,
  acceptPath,
  seedAdminScopeInvite,
  seedInvite,
  seedSignedIn,
} from "@/test/support/invite-accept-support";
import {
  CALLERS,
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
  seedAdminScope,
  seedCtx,
  seedMember,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/support/matrix-route-support";
import { ok } from "@/test/support/access-test-support";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { POST } from "./route";

// Source: docs/specs/2026-11-10-access-control.md - "Accept a pending invite
// (unit INV1)" (Who, Target, Refusals, Write), "Permission matrix" (accept a
// pending invite: internal-admin, internal-org-admin any team, leads on teams
// in scope, others no; never one's own invite), "API routes" (POST
// /api/teams/[id]/members/pending/[key]/accept `{ oid, reason }` strict),
// threats T-INV1 to T-INV6. The cross-cutting 401 / 403-before-parsing / 400 /
// no-store / denied-audit cases come from the shared route-contract suite via
// test/route-registry.ts (Rule 60.23).
// Org (test/fixtures/scope-fixtures.ts): team-a, team-b in dept-eng; team-c in
// dept-ops. Callers: admin, orgAdmin, teamAdminA (scope team-a), deptAdminEng
// (scope dept-eng), memberA/memberB, viewerNone, auditor.
// Decisions: a replay (the key is no longer pending but the target already
// holds an affiliation on this very team) is 409 CONFLICT, while a key that is
// pending nowhere stays the same 404 as a missing one; a pending admin scope
// is not an acceptable invitation (404).
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});
// The literal matches TENANT in invite-accept-support (a hoisted mock factory
// cannot read imports). A test clears `tenant.issuer` and restores it in
// afterEach to model "no Entra tenant configured".
const tenant = vi.hoisted(() => ({
  issuer:
    "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0" as
      | string
      | undefined,
}));
const TENANT_ISSUER = tenant.issuer;
vi.mock("@/env", async (orig) => {
  const env = { ...(await orig<typeof import("@/env")>()).env };
  Object.defineProperty(env, "AUTH_MICROSOFT_ENTRA_ID_ISSUER", {
    get: () => tenant.issuer,
    enumerable: true,
  });
  return { env };
});

const REASON = "Confirmed with the invitee by phone";
type Member = { oid: string; teamId: string; source: string; version: number };

const accept = (
  team: string,
  key: string,
  body: unknown,
  extra: { contentType?: string | null; origin?: string | null } = {},
) =>
  invoke(POST, {
    method: "POST",
    path: acceptPath(team, key),
    params: { id: team, key },
    body,
    ...extra,
  });
const NOBODY = "nobody@example.com";
const acceptJane = (team = "team-a", key = KEY) =>
  accept(team, key, { oid: JANE_OID, reason: REASON });

// Success records only: a refusal writes a separate `denied` record.
const acceptRecords = async () =>
  (await auditToday()).filter(
    (r) => r.action === "affiliation.invite.accept" && r.result === "success",
  );

// Jane signed in with a UPN that differs from the invite key (the reason the
// invite did not bind at sign-in), a stored email that equals it.
async function seedJane() {
  await seedSignedIn(JANE_OID, {
    upn: "jane.doe@company.com",
    email: KEY,
    displayName: "Jane Doe",
  });
}

beforeAll(ensureTestTable);
afterEach(() => {
  tenant.issuer = TENANT_ISSUER;
});
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  await seedJane();
  await seedInvite(KEY, "team-a");
  signInAs("admin");
});

const ALLOWED: CallerName[] = [
  "admin",
  "orgAdmin",
  "teamAdminA",
  "deptAdminEng",
];
const REFUSED: CallerName[] = ["memberA", "memberB", "viewerNone", "auditor"];

describe("POST .../pending/[key]/accept - role x action matrix (permission matrix row)", () => {
  it.each(ALLOWED)(
    "%s accepts a member invitation of team-a: a ui affiliation by oid, the invite gone, one affiliation.invite.accept record with key, oid, team and reason",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<Member>(await acceptJane(), [200, 201]);
      expect(data).toMatchObject({
        oid: JANE_OID,
        teamId: "team-a",
        source: "ui",
        version: 1,
      });
      expect(await affiliationOf(JANE_OID)).toMatchObject({
        teamId: "team-a",
        source: "ui",
      });
      expect(await listPendingFor([KEY])).toEqual([]);
      const records = await acceptRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "affiliation.invite.accept",
        result: "success",
        category: "change",
        actor: CALLERS[caller].oid,
        teamId: "team-a",
        target: { type: "identity", id: JANE_OID },
      });
      const text = JSON.stringify(records[0]);
      expect(text).toContain(KEY);
      expect(text).toContain(REASON);
    },
  );

  it("a department-scope lead accepts for another team of the department (team-b)", async () => {
    await seedInvite("amy@example.com", "team-b");
    await seedSignedIn(OTHER_OID, { upn: "amy@example.com" });
    signInAs("deptAdminEng");
    await expectData(
      await accept("team-b", "amy@example.com", {
        oid: OTHER_OID,
        reason: REASON,
      }),
      [200, 201],
    );
    expect(await affiliationOf(OTHER_OID)).toMatchObject({ teamId: "team-b" });
  });

  it.each([
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s accepting for %s (out of scope) gets the same 404 as a missing key, one denied NOT_FOUND record, nothing written (T-INV5)",
    async (caller, team) => {
      await seedInvite(`oos-${team}@example.com`, team);
      signInAs(caller);
      const before = await nonAuditItems();
      const outOfScope = await expectError(
        await acceptJane(team, `oos-${team}@example.com`),
        404,
        "NOT_FOUND",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await acceptRecords()).toEqual([]);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.invite.accept",
        code: "NOT_FOUND",
      });
      signInAs("admin");
      const missing = await expectError(
        await acceptJane("team-a", NOBODY),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, team, NOBODY, JANE_OID);
    },
  );

  it.each(REFUSED)(
    "%s (no accept permission) gets 403 FORBIDDEN even for team-a; nothing written, one denied record (Audit log D17)",
    async (caller) => {
      signInAs(caller);
      const before = await nonAuditItems();
      await expectError(await acceptJane(), 403, "FORBIDDEN");
      expect(await nonAuditItems()).toEqual(before);
      expect(await acceptRecords()).toEqual([]);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.invite.accept",
        code: "FORBIDDEN",
      });
    },
  );

  it("the sender, while their scope still covers the team, may accept their own invite", async () => {
    await clearTable();
    await seedWorld();
    await seedJane();
    await seedInvite(KEY, "team-a", CALLERS.teamAdminA.oid);
    signInAs("teamAdminA");
    await expectData(await acceptJane(), [200, 201]);
  });

  it("the sender who lost every scope is 403, and one whose scope moved to another team is the same 404 as a missing key (permission is the scope, never the sending)", async () => {
    await clearTable();
    await seedWorld();
    await seedJane();
    await seedInvite(KEY, "team-a", CALLERS.teamAdminA.oid);
    ok(
      await revokeAdminScope(
        {
          oid: CALLERS.teamAdminA.oid,
          scopeType: "team",
          scopeId: "team-a",
          version: 1,
        },
        seedCtx(),
      ),
    );
    signInAs("teamAdminA");
    await expectError(await acceptJane(), 403, "FORBIDDEN");
    await seedAdminScope(CALLERS.teamAdminA.oid, "team", "team-b");
    const moved = await expectError(await acceptJane(), 404, "NOT_FOUND");
    signInAs("admin");
    const missing = await expectError(
      await acceptJane("team-a", NOBODY),
      404,
      "NOT_FOUND",
    );
    expectSameBody(moved, missing, KEY);
    expect(await affiliationOf(JANE_OID)).toBeNull();
  });
});

describe("T-INV1 - only a server-computed target, strict body", () => {
  it.each(["teamAdminA", "deptAdminEng"] as const)(
    "%s cannot bind an oid outside the candidate set: the same 404 body as a missing key, one denied NOT_FOUND record, nothing else written (T-INV1; Audit log D17, T22; coordinator ruling Q-W1)",
    async (caller) => {
      await seedSignedIn(PEOPLE.bob.oid, {
        upn: "bob@company.com",
        email: PEOPLE.bob.email,
      });
      signInAs(caller);
      const before = await nonAuditItems();
      const res = await expectError(
        await accept("team-a", KEY, { oid: PEOPLE.bob.oid, reason: REASON }),
        404,
        "NOT_FOUND",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await acceptRecords()).toEqual([]);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.invite.accept",
        code: "NOT_FOUND",
      });
      signInAs("admin");
      const missing = await expectError(
        await acceptJane("team-a", NOBODY),
        404,
        "NOT_FOUND",
      );
      expectSameBody(res, missing, PEOPLE.bob.oid, KEY);
    },
  );

  const UNKNOWN_OID = "00000000-0000-4000-8000-0000000003f4";
  const FOREIGN_OID = "00000000-0000-4000-8000-0000000003f1";
  it.each(
    (["teamAdminA", "deptAdminEng"] as const).flatMap((caller) => [
      [caller, "an unknown oid (no identity item)", UNKNOWN_OID] as const,
      [caller, "a foreign-tenant oid", FOREIGN_OID] as const,
    ]),
  )(
    "%s accepting with %s gets the same 404 body as a missing key, exactly one denied NOT_FOUND record, nothing else written (R2-B1; Audit log D17, T22: no existence oracle)",
    async (caller, _name, oid) => {
      await seedSignedIn(FOREIGN_OID, { upn: KEY, tid: FOREIGN_TENANT });
      signInAs(caller);
      const before = await nonAuditItems();
      const res = await expectError(
        await accept("team-a", KEY, { oid, reason: REASON }),
        404,
        "NOT_FOUND",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await acceptRecords()).toEqual([]);
      expect(await affiliationOf(oid)).toBeNull();
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "affiliation.invite.accept",
        code: "NOT_FOUND",
      });
      signInAs("admin");
      const missing = await expectError(
        await acceptJane("team-a", NOBODY),
        404,
        "NOT_FOUND",
      );
      expectSameBody(res, missing, oid, KEY);
    },
  );

  it("with no Entra tenant configured an accept by an admin and by a lead is 404 and binds nothing (Accept a pending invite, Details: no-tenant decision; fail closed)", async () => {
    tenant.issuer = undefined;
    for (const caller of ["admin", "teamAdminA"] as const) {
      signInAs(caller);
      const before = await nonAuditItems();
      await expectError(await acceptJane(), 404, "NOT_FOUND");
      expect(await nonAuditItems()).toEqual(before);
      expect(await affiliationOf(JANE_OID)).toBeNull();
      expect(await acceptRecords()).toEqual([]);
    }
  });

  it.each([
    ["an identity that does not exist", "00000000-0000-4000-8000-0000000003f2"],
    ["an identity of another tenant", "00000000-0000-4000-8000-0000000003f3"],
  ])("internal-admin binding %s is 404 and writes nothing", async (_n, oid) => {
    await seedSignedIn("00000000-0000-4000-8000-0000000003f3", {
      tid: FOREIGN_TENANT,
    });
    const before = await nonAuditItems();
    await expectError(
      await accept("team-a", KEY, { oid, reason: REASON }),
      404,
      "NOT_FOUND",
    );
    expect(await nonAuditItems()).toEqual(before);
  });

  it.each(["admin", "orgAdmin"] as const)(
    "%s may pick any unaffiliated same-tenant identity from the directory, not only a key match",
    async (caller) => {
      await seedSignedIn(PEOPLE.bob.oid, {
        upn: "robert@company.com",
        email: "robert@company.com",
      });
      signInAs(caller);
      await expectData(
        await accept("team-a", KEY, { oid: PEOPLE.bob.oid, reason: REASON }),
        [200, 201],
      );
      expect(await affiliationOf(PEOPLE.bob.oid)).toMatchObject({
        teamId: "team-a",
      });
    },
  );

  it("matches the key case-insensitively in the path", async () => {
    await expectData(
      await acceptJane("team-a", "JANE@Example.com"),
      [200, 201],
    );
  });

  it.each([
    ["an extra key", { oid: JANE_OID, reason: REASON, teamId: "team-a" }],
    ["an extra version key", { oid: JANE_OID, reason: REASON, version: 1 }],
    ["a missing reason", { oid: JANE_OID }],
    ["an empty reason", { oid: JANE_OID, reason: "" }],
    ["a blank reason", { oid: JANE_OID, reason: "   " }],
    [
      "a reason over 280 characters",
      { oid: JANE_OID, reason: "r".repeat(281) },
    ],
    ["a missing oid", { reason: REASON }],
    ["an empty oid", { oid: "", reason: REASON }],
    ["an oid over 128 characters", { oid: "o".repeat(129), reason: REASON }],
    ["a non-string oid", { oid: 7, reason: REASON }],
    [
      "an emailOrUpn target (no free-text target)",
      { emailOrUpn: KEY, reason: REASON },
    ],
    ["a non-object body", "[]"],
    ["invalid JSON", "{not json"],
  ])("400 BAD_REQUEST for %s; nothing written", async (_n, body) => {
    const before = await nonAuditItems();
    await expectError(await accept("team-a", KEY, body), 400, "BAD_REQUEST");
    expect(await nonAuditItems()).toEqual(before);
    expect(await acceptRecords()).toEqual([]);
  });

  it("accepts a reason of exactly 280 characters", async () => {
    await expectData(
      await accept("team-a", KEY, { oid: JANE_OID, reason: "r".repeat(280) }),
      [200, 201],
    );
  });

  it.each(["a\u0001b", "k".repeat(300)])(
    "400 BAD_REQUEST for a malformed path key %j",
    async (key) => {
      await expectError(
        await accept("team-a", key, { oid: JANE_OID, reason: REASON }),
        400,
        "BAD_REQUEST",
      );
    },
  );
});

describe("T-INV2 - the invitee cannot accept their own invite", () => {
  it.each(["teamAdminA", "admin"] as const)(
    "%s targeting their own oid is 403 FORBIDDEN, no write, no successful accept, one denied record (T-INV2; Audit log D17, orchestrator ruling 2026-11-18)",
    async (caller) => {
      const me = CALLERS[caller];
      await seedSignedIn(me.oid, {
        upn: me.email,
        email: me.email,
        roles: [...me.roles],
      });
      await seedInvite(me.email, "team-a");
      signInAs(caller);
      const before = await nonAuditItems();
      await expectError(
        await accept("team-a", me.email, { oid: me.oid, reason: REASON }),
        403,
        "FORBIDDEN",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await affiliationOf(me.oid)).toBeNull();
      expect(await acceptRecords()).toEqual([]);
      await expectOneDenied({
        actor: me.oid,
        action: "affiliation.invite.accept",
        code: "FORBIDDEN",
      });
    },
  );
});

describe("T-INV3 - a target with a global role is PRIVILEGED_TARGET", () => {
  it.each(["internal-admin", "internal-org-admin", "internal-auditor"])(
    "a candidate whose claims carry %s is 409 PRIVILEGED_TARGET (also for a lead), no write, one denied record per refusal (T-INV3; Audit log D17)",
    async (role) => {
      await seedSignedIn(JANE_OID, { upn: KEY, roles: [role] });
      for (const caller of ["admin", "teamAdminA"] as const) {
        signInAs(caller);
        const before = await nonAuditItems();
        await expectError(await acceptJane(), 409, "PRIVILEGED_TARGET");
        expect(await nonAuditItems()).toEqual(before);
      }
      expect(await acceptRecords()).toEqual([]);
      const denied = await deniedToday();
      expect(denied.map((r) => r.actor).sort()).toEqual(
        [CALLERS.admin.oid, CALLERS.teamAdminA.oid].sort(),
      );
      for (const r of denied) {
        expect(r).toMatchObject({
          action: "affiliation.invite.accept",
          result: "denied",
          category: "security",
        });
      }
    },
  );

  it.each(["internal-admin", "internal-org-admin"] as const)(
    "a target granted %s in the app is 409 PRIVILEGED_TARGET, no write, one denied record (T-INV3; Audit log D17)",
    async (role) => {
      ok(await grantRole({ oid: JANE_OID, role, reason: "cover" }, seedCtx()));
      const before = await nonAuditItems();
      await expectError(await acceptJane(), 409, "PRIVILEGED_TARGET");
      expect(await nonAuditItems()).toEqual(before);
      expect(await affiliationOf(JANE_OID)).toBeNull();
      expect(await acceptRecords()).toEqual([]);
      const denied = await deniedToday();
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({
        action: "affiliation.invite.accept",
        result: "denied",
        actor: CALLERS.admin.oid,
      });
    },
  );
});

describe("T-INV4 - a stale or replayed accept binds once", () => {
  it.each(["admin", "teamAdminA"] as const)(
    "%s: a second accept of the same invite is 409 CONFLICT; one affiliation, one accept record",
    async (caller) => {
      signInAs(caller);
      await expectData(await acceptJane(), [200, 201]);
      await expectError(await acceptJane(), 409, "CONFLICT");
      expect(await affiliationOf(JANE_OID)).toMatchObject({ version: 1 });
      expect(await acceptRecords()).toHaveLength(1);
    },
  );
});

describe("T-INV4 - concurrent accepts", () => {
  it("two accepts of the same invite in flight bind once: one 201, one 409 CONFLICT; one affiliation, one accept record (T-INV4)", async () => {
    const [a, b] = await Promise.all([acceptJane(), acceptJane()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    await expectError(loser, 409, "CONFLICT");
    expect(await affiliationOf(JANE_OID)).toMatchObject({ version: 1 });
    expect(await listPendingFor([KEY])).toEqual([]);
    expect(await acceptRecords()).toHaveLength(1);
  });
});

describe("T-INV5 - no probing of keys or teams", () => {
  it("an unknown key, a key pending for another team, and a pending admin scope all answer the same 404 body", async () => {
    await seedInvite("other@example.com", "team-b");
    await seedAdminScopeInvite("scope@example.com", "team", "team-a");
    await seedSignedIn(OTHER_OID, { upn: "other@example.com" });
    const unknown = await expectError(
      await acceptJane("team-a", "nobody@example.com"),
      404,
      "NOT_FOUND",
    );
    const anotherTeam = await expectError(
      await accept("team-a", "other@example.com", {
        oid: OTHER_OID,
        reason: REASON,
      }),
      404,
      "NOT_FOUND",
    );
    const scopeOnly = await expectError(
      await acceptJane("team-a", "scope@example.com"),
      404,
      "NOT_FOUND",
    );
    expectSameBody(unknown, anotherTeam, "nobody", "other@", "team-b");
    expectSameBody(unknown, scopeOnly, "scope@", "nobody");
    expect(await listPendingFor(["scope@example.com"])).toHaveLength(1);
    expect(await listPendingFor(["other@example.com"])).toHaveLength(1);
    expect(await affiliationOf(OTHER_OID)).toBeNull();
    expect(await acceptRecords()).toEqual([]);
  });
});

describe("T-INV6 - accept never overrides existing membership", () => {
  it("an SSO-sourced affiliation is 409 MANAGED_BY_SSO; nothing is written and the invite stays", async () => {
    await seedSsoAffiliation(JANE_OID, "team-c");
    const before = await nonAuditItems();
    await expectError(await acceptJane(), 409, "MANAGED_BY_SSO");
    expect(await nonAuditItems()).toEqual(before);
    expect(await acceptRecords()).toEqual([]);
  });

  it("a target already in a team is 409 ALREADY_AFFILIATED; nothing is written and the invite stays", async () => {
    await seedMember(JANE_OID, "team-c");
    const before = await nonAuditItems();
    await expectError(await acceptJane(), 409, "ALREADY_AFFILIATED");
    expect(await nonAuditItems()).toEqual(before);
    expect(await affiliationOf(JANE_OID)).toMatchObject({ teamId: "team-c" });
    expect(await listPendingFor([KEY])).toHaveLength(1);
    expect(await acceptRecords()).toEqual([]);
  });
});
