import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  META_SK,
  adminScopeSk,
  adminsGsi1pk,
  identPk,
} from "@/test/support/keys-test-support";
import { installFakeOtel, recordedSpans } from "@/test/fakes/otel-fake";

import { grantRole } from "@/lib/data/access/role-grants";
import {
  CALLERS,
  PEOPLE,
  seedAdminScope,
  seedCtx,
  seedIdentity,
  seedMember,
  seedWorld,
  signInAs,
} from "@/test/support/matrix-route-support";
import { get } from "@/test/fixtures/scope-fixtures";
import { ok } from "@/test/support/access-test-support";
import {
  putRaw,
  clearTable,
  ensureTestTable,
} from "@/test/support/test-support";

import { GET as getMe } from "../me/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)",
// paragraph "/api/me leadEmail and own usage byModel" (Slice B2, 2026-11-17):
// leadEmail is at most one email of a team-scope admin of the caller's OWN
// member team, null with no member team or no such lead, never a list, never
// another team's lead, never a global admin; read per request (Rule 60.10).
// Org (matrix-route-support seedWorld): memberA in team-a, memberB in team-b,
// teamAdminA leads team-a, deptAdminEng holds a department scope only.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const LEAD_A = "ta@company.com";

beforeAll(async () => {
  installFakeOtel();
  await ensureTestTable();
});
beforeEach(async () => {
  recordedSpans.length = 0;
  await clearTable();
  await seedWorld();
  await seedIdentity(CALLERS.teamAdminA.oid, { email: LEAD_A, name: "Lead A" });
  await seedIdentity(CALLERS.deptAdminEng.oid, {
    email: "da@company.com",
    name: "Dept Eng",
  });
});

async function leadEmailOf(): Promise<unknown> {
  const { res, body } = await get(getMe, "/api/me");
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  const data = body.data as Record<string, unknown>;
  return data.leadEmail;
}

describe("GET /api/me leadEmail", () => {
  it("a member gets the email of their team's team-scope admin", async () => {
    signInAs("memberA");
    expect(await leadEmailOf()).toBe(LEAD_A);
  });

  it("a caller with no member team gets null", async () => {
    signInAs("viewerNone");
    expect(await leadEmailOf()).toBeNull();
  });

  it("another team's lead is never returned (two teams, two leads)", async () => {
    await seedIdentity(PEOPLE.dave.oid, {
      email: PEOPLE.dave.email,
      name: "Dave",
    });
    await seedAdminScope(PEOPLE.dave.oid, "team", "team-b");

    signInAs("memberB");
    expect(await leadEmailOf()).toBe(PEOPLE.dave.email);

    signInAs("memberA");
    expect(await leadEmailOf()).toBe(LEAD_A);
  });

  it("a team with no team-scope admin gives null: a department admin is not a lead", async () => {
    // memberB's team-b has no team scope; deptAdminEng (dept-eng) has an identity.
    signInAs("memberB");
    expect(await leadEmailOf()).toBeNull();
  });

  it("a global admin holding a team scope is never returned as the lead", async () => {
    // team-c's only team-scope admin is Dave, a global admin (stored role
    // grant and last seen role): no lead is known, so null, not Dave's email.
    await putRaw({
      PK: `IDENT#${PEOPLE.dave.oid}`,
      SK: "META",
      gsi1pk: "IDENTS",
      gsi1sk: `IDENT#${PEOPLE.dave.oid}`,
      oid: PEOPLE.dave.oid,
      tid: "00000000-0000-4000-8000-0000000000ff",
      email: PEOPLE.dave.email,
      displayName: "Dave",
      lastSignInAt: "2026-01-01T00:00:00.000Z",
      lastSeenRoles: ["internal-admin"],
      authMethod: "entra",
      version: 1,
    });
    ok(
      await grantRole(
        { oid: PEOPLE.dave.oid, role: "internal-admin", reason: "test" },
        seedCtx(),
      ),
    );
    await seedAdminScope(PEOPLE.dave.oid, "team", "team-c");
    await seedMember(PEOPLE.alice.oid, "team-c");

    const { auth } = await import("@/auth");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: {
        oid: PEOPLE.alice.oid,
        email: PEOPLE.alice.email,
        roles: ["internal-viewer"],
        tid: "t",
        authMethod: "entra",
      },
    });
    expect(await leadEmailOf()).toBeNull();
  });

  it("several leads still yield one email string, never a list", async () => {
    await seedIdentity(PEOPLE.alice.oid, {
      email: PEOPLE.alice.email,
      name: "Alice",
    });
    await seedAdminScope(PEOPLE.alice.oid, "team", "team-a");
    signInAs("memberA");
    const value = await leadEmailOf();
    expect(typeof value).toBe("string");
    expect([LEAD_A, PEOPLE.alice.email]).toContain(value);
  });
});

// B2 review follow-ups (Access Control, API routes (additions), leadEmail
// paragraph and Group overage item 6, 2026-11-17).
const TENANT = "00000000-0000-4000-8000-0000000000ff";

async function seedRawIdentity(
  person: { oid: string; email: string },
  over: { lastSeenRoles?: string[]; groupsOverage?: boolean } = {},
) {
  await putRaw({
    PK: identPk(person.oid),
    SK: META_SK,
    gsi1pk: "IDENTS",
    gsi1sk: identPk(person.oid),
    oid: person.oid,
    tid: TENANT,
    email: person.email,
    displayName: person.oid,
    lastSignInAt: "2026-01-01T00:00:00.000Z",
    lastSeenRoles: over.lastSeenRoles ?? ["internal-viewer"],
    authMethod: "entra",
    version: 1,
    ...(over.groupsOverage === undefined
      ? {}
      : { groupsOverage: over.groupsOverage }),
  });
}

async function seedScope(oid: string, teamId: string, source: "ui" | "sso") {
  await putRaw({
    PK: identPk(oid),
    SK: adminScopeSk("team", teamId),
    gsi1pk: adminsGsi1pk("team", teamId),
    gsi1sk: identPk(oid),
    oid,
    scopeType: "team",
    scopeId: teamId,
    source,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "test",
  });
}

async function asAliceInTeamC() {
  await seedMember(PEOPLE.alice.oid, "team-c");
  const { auth } = await import("@/auth");
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: {
      oid: PEOPLE.alice.oid,
      email: PEOPLE.alice.email,
      roles: ["internal-viewer"],
      tid: "t",
      authMethod: "entra",
    },
  });
}

describe("GET /api/me leadEmail: suspension and global roles (B2 review)", () => {
  it("an SSO team scope suspended during a groups overage is not the lead (Group overage item 6)", async () => {
    await seedRawIdentity(PEOPLE.dave, { groupsOverage: true });
    await seedScope(PEOPLE.dave.oid, "team-c", "sso");
    await asAliceInTeamC();
    expect(await leadEmailOf()).toBeNull();
  });

  it("an SSO scope without overage, and a UI scope during overage, still count (suspension is SSO-only)", async () => {
    await seedRawIdentity(PEOPLE.dave, { groupsOverage: false });
    await seedScope(PEOPLE.dave.oid, "team-c", "sso");
    await asAliceInTeamC();
    expect(await leadEmailOf()).toBe(PEOPLE.dave.email);

    await clearTable();
    await seedWorld();
    await seedRawIdentity(PEOPLE.dave, { groupsOverage: true });
    await seedScope(PEOPLE.dave.oid, "team-c", "ui");
    await asAliceInTeamC();
    expect(await leadEmailOf()).toBe(PEOPLE.dave.email);
  });

  it.each([
    ["internal-org-admin"],
    ["internal-auditor"],
    ["Admin"], // legacy alias outside APP_ENV=prod
  ])(
    "a team-scope admin whose last seen role is %s is a global admin, never the lead",
    async (role) => {
      await seedRawIdentity(PEOPLE.dave, { lastSeenRoles: [role] });
      await seedScope(PEOPLE.dave.oid, "team-c", "ui");
      await asAliceInTeamC();
      expect(await leadEmailOf()).toBeNull();
    },
  );

  it("a stored internal-org-admin grant makes a team-scope admin a global admin", async () => {
    await seedRawIdentity(PEOPLE.dave);
    await seedScope(PEOPLE.dave.oid, "team-c", "ui");
    ok(
      await grantRole(
        { oid: PEOPLE.dave.oid, role: "internal-org-admin", reason: "test" },
        seedCtx(),
      ),
    );
    await asAliceInTeamC();
    expect(await leadEmailOf()).toBeNull();
  });

  it("a failed lead lookup gives 200 with leadEmail null, the rest intact, and the exception on the span (B2 review)", async () => {
    // A corrupt identity record makes the lookup throw.
    await putRaw({
      PK: identPk(PEOPLE.dave.oid),
      SK: META_SK,
      gsi1pk: "IDENTS",
      gsi1sk: identPk(PEOPLE.dave.oid),
      oid: PEOPLE.dave.oid,
      corrupt: true,
    });
    await seedScope(PEOPLE.dave.oid, "team-a", "ui");
    signInAs("memberA");

    const { res, body } = await get(getMe, "/api/me");
    expect(res.status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.leadEmail).toBeNull();
    expect(data.memberTeamId).toBe("team-a");
    expect(data.oid).toBe(CALLERS.memberA.oid);
    expect(recordedSpans.some((s) => s.exceptions.length > 0)).toBe(true);
  });
});
