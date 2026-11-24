import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);

import { listAccessReviewRows } from "./access-review";
import type { AccessReviewRow } from "./access-review";
import {
  NOW,
  OID_A,
  OID_B,
  ctxAt,
  ok,
  seedSsoAdminScope,
  seedSsoAffiliation,
} from "@/test/support/access-test-support";
import { grantAdminScope } from "./admin-scopes";
import { addMember } from "./affiliations";
import { putIdentityLink } from "./identity-links";
import { localUserPk } from "./keys";
import { grantRole } from "./role-grants";

// Source: docs/specs/2026-11-10-access-control.md - "Access review" (quarterly
// CSV of every identity with global roles and sources, member team and admin
// scopes with sources, lastSignInAt, aliases, the LiteLLM link and flags:
// ambiguous, overage, stale, Entra role removed while an in-app grant remains),
// "Password users" (enabled-password-user), "Data model additions" (access
// review reads Query GSI1=IDENTS, then each identity's items; never cached),
// D2 (stale = 90 days inactive), Rule 20.6. Spec: Access Control "API routes (additions)". Assumed API:
//   listAccessReviewRows(now: Date): Promise<AccessReviewRow[]>
// one row per identity in GSI1=IDENTS (all of them, not one page), with
//   { oid, email, displayName, authMethod, lastSignInAt,
//     roles: { role, source: "sso" | "ui" }[],       // lastSeenRoles = sso, RoleGrant = ui
//     team: { teamId, source } | null,
//     adminScopes: { scopeType, scopeId, source }[],
//     aliases: string[],                               // IdentityLink.aliases
//     litellmUserId?: string,                          // carried, never exported yet
//     flags: ("ambiguous" | "overage" | "stale" |
//             "entra-role-removed-with-grant" | "enabled-password-user")[] }
// `email` is the identity's email, else its upn. Order is not asserted.
const REVIEW_NOW = new Date("2026-11-15T00:00:00.000Z");
const daysAgo = (d: number) =>
  new Date(REVIEW_NOW.getTime() - d * 86_400_000).toISOString();

type SeedIdentity = {
  oid: string;
  email?: string;
  upn?: string;
  displayName?: string;
  authMethod?: "entra" | "master" | "local" | "password";
  lastSignInAt?: string;
  lastSeenRoles?: string[];
  ambiguousMembership?: boolean;
  groupsOverage?: boolean;
};

async function seedIdentity(i: SeedIdentity): Promise<void> {
  await putRaw({
    PK: `IDENT#${i.oid}`,
    SK: "META",
    gsi1pk: "IDENTS",
    gsi1sk: `IDENT#${i.oid}`,
    oid: i.oid,
    tid: "00000000-0000-4000-8000-0000000000ff",
    lastSignInAt: i.lastSignInAt ?? daysAgo(1),
    lastSeenRoles: i.lastSeenRoles ?? ["internal-viewer"],
    authMethod: i.authMethod ?? "entra",
    version: 1,
    ...(i.email ? { email: i.email } : {}),
    ...(i.upn ? { upn: i.upn } : {}),
    ...(i.displayName ? { displayName: i.displayName } : {}),
    ...(i.ambiguousMembership !== undefined
      ? { ambiguousMembership: i.ambiguousMembership }
      : {}),
    ...(i.groupsOverage !== undefined
      ? { groupsOverage: i.groupsOverage }
      : {}),
  });
}

async function rows(): Promise<AccessReviewRow[]> {
  return listAccessReviewRows(REVIEW_NOW);
}
async function rowFor(oid: string): Promise<AccessReviewRow> {
  const found = (await rows()).find((r) => r.oid === oid);
  if (!found) throw new Error(`no review row for ${oid}`);
  return found;
}

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("listAccessReviewRows", () => {
  it("returns no rows for an empty table", async () => {
    expect(await rows()).toEqual([]);
  });

  it("returns the identity's basics, with email falling back to the upn", async () => {
    await seedIdentity({
      oid: OID_A,
      email: "ada@example.com",
      displayName: "Ada",
      lastSignInAt: daysAgo(3),
    });
    await seedIdentity({ oid: OID_B, upn: "bob@corp.example.com" });
    expect(await rowFor(OID_A)).toMatchObject({
      oid: OID_A,
      email: "ada@example.com",
      displayName: "Ada",
      authMethod: "entra",
      lastSignInAt: daysAgo(3),
      team: null,
      adminScopes: [],
      aliases: [],
      flags: [],
    });
    expect((await rowFor(OID_B)).email).toBe("bob@corp.example.com");
  });

  it("returns one row per identity, not one per item (an identity with many items is one row)", async () => {
    await seedIdentity({ oid: OID_A, email: "ada@example.com" });
    await seedIdentity({ oid: OID_B, email: "bob@example.com" });
    ok(await addMember({ oid: OID_A, teamId: "team-a" }, ctxAt(NOW, "r1")));
    ok(
      await grantAdminScope(
        { oid: OID_A, scopeType: "team", scopeId: "team-b" },
        ctxAt(NOW, "r2"),
      ),
    );
    ok(
      await grantAdminScope(
        { oid: OID_A, scopeType: "department", scopeId: "dept-1" },
        ctxAt(NOW, "r3"),
      ),
    );
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.oid).sort()).toEqual([OID_A, OID_B].sort());
  });

  it("reads every identity, not just the first page (Rule 20.6): 120 identities", async () => {
    for (let i = 0; i < 120; i += 1) {
      await seedIdentity({
        oid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        email: `user${i}@example.com`,
      });
    }
    const all = await rows();
    expect(all).toHaveLength(120);
    expect(new Set(all.map((r) => r.oid)).size).toBe(120);
  });

  it("lists global roles with their sources: Entra-seen roles are sso, in-app grants are ui", async () => {
    await seedIdentity({
      oid: OID_A,
      email: "ada@example.com",
      lastSeenRoles: ["internal-auditor"],
    });
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-admin", reason: "cover" },
        ctxAt(NOW, "r1"),
      ),
    );
    const roles = (await rowFor(OID_A)).roles;
    expect(roles).toHaveLength(2);
    expect(roles).toEqual(
      expect.arrayContaining([
        { role: "internal-auditor", source: "sso" },
        { role: "internal-admin", source: "ui" },
      ]),
    );
  });

  it("lists the member team and admin scopes with their sources (ui and sso)", async () => {
    await seedIdentity({ oid: OID_A, email: "ada@example.com" });
    await seedIdentity({ oid: OID_B, email: "bob@example.com" });
    ok(await addMember({ oid: OID_A, teamId: "team-a" }, ctxAt(NOW, "r1")));
    ok(
      await grantAdminScope(
        { oid: OID_A, scopeType: "team", scopeId: "team-b" },
        ctxAt(NOW, "r2"),
      ),
    );
    await seedSsoAffiliation(OID_B, "team-c");
    await seedSsoAdminScope(OID_B, "department", "dept-9");
    expect(await rowFor(OID_A)).toMatchObject({
      team: { teamId: "team-a", source: "ui" },
      adminScopes: [{ scopeType: "team", scopeId: "team-b", source: "ui" }],
    });
    expect(await rowFor(OID_B)).toMatchObject({
      team: { teamId: "team-c", source: "sso" },
      adminScopes: [
        { scopeType: "department", scopeId: "dept-9", source: "sso" },
      ],
    });
  });

  it("carries aliases from the identity link; the LiteLLM user id is carried but not required", async () => {
    await seedIdentity({ oid: OID_A, email: "ada@example.com" });
    ok(
      await putIdentityLink(
        {
          oid: OID_A,
          usageIdentities: ["ada@example.com"],
          aliases: ["ada.old@example.com", "a.lovelace@example.com"],
          litellmUserId: "lu-1",
          version: null,
        },
        ctxAt(NOW, "r1"),
      ),
    );
    const row = await rowFor(OID_A);
    expect([...row.aliases].sort()).toEqual([
      "a.lovelace@example.com",
      "ada.old@example.com",
    ]);
    expect(row.litellmUserId).toBe("lu-1");
  });

  describe("flags", () => {
    it("ambiguous: ambiguousMembership is true", async () => {
      await seedIdentity({ oid: OID_A, ambiguousMembership: true });
      await seedIdentity({ oid: OID_B, ambiguousMembership: false });
      expect((await rowFor(OID_A)).flags).toEqual(["ambiguous"]);
      expect((await rowFor(OID_B)).flags).toEqual([]);
    });

    it("overage: groupsOverage is true", async () => {
      await seedIdentity({ oid: OID_A, groupsOverage: true });
      expect((await rowFor(OID_A)).flags).toEqual(["overage"]);
    });

    it("stale: no sign-in for more than 90 days (D2); 89 days is not stale", async () => {
      await seedIdentity({ oid: OID_A, lastSignInAt: daysAgo(91) });
      await seedIdentity({ oid: OID_B, lastSignInAt: daysAgo(89) });
      expect((await rowFor(OID_A)).flags).toEqual(["stale"]);
      expect((await rowFor(OID_B)).flags).toEqual([]);
    });

    it("entra-role-removed-with-grant: an in-app grant of a role the Entra claim no longer carries", async () => {
      await seedIdentity({
        oid: OID_A,
        lastSeenRoles: ["internal-viewer"],
      });
      await seedIdentity({
        oid: OID_B,
        lastSeenRoles: ["internal-admin"],
      });
      for (const [n, oid] of [OID_A, OID_B].entries()) {
        ok(
          await grantRole(
            { oid, role: "internal-admin", reason: "cover" },
            ctxAt(NOW, `r${n}`),
          ),
        );
      }
      expect((await rowFor(OID_A)).flags).toEqual([
        "entra-role-removed-with-grant",
      ]);
      expect((await rowFor(OID_B)).flags).toEqual([]);
    });

    it("enabled-password-user: the identity is an enabled password user; a disabled one is not flagged", async () => {
      await seedIdentity({
        oid: OID_A,
        email: "pw-on@example.com",
        authMethod: "local",
      });
      await seedIdentity({
        oid: OID_B,
        email: "pw-off@example.com",
        authMethod: "local",
      });
      for (const [oid, email, status] of [
        [OID_A, "pw-on@example.com", "enabled"],
        [OID_B, "pw-off@example.com", "disabled"],
      ] as const) {
        await putRaw({
          PK: localUserPk(email),
          SK: "META",
          gsi1pk: "LOCALUSERS",
          gsi1sk: localUserPk(email),
          email,
          oid,
          tid: "local",
          displayName: email,
          status,
          version: 1,
          sso: { expectedUpn: email },
        });
      }
      expect((await rowFor(OID_A)).flags).toEqual(["enabled-password-user"]);
      expect((await rowFor(OID_B)).flags).toEqual([]);
    });

    it("a password-setup identity (authMethod password) is reviewed with its method and the enabled-password-user flag - Password users, D20-D22", async () => {
      await seedIdentity({
        oid: OID_A,
        email: "pw@example.com",
        authMethod: "password",
      });
      await putRaw({
        PK: localUserPk("pw@example.com"),
        SK: "META",
        gsi1pk: "LOCALUSERS",
        gsi1sk: localUserPk("pw@example.com"),
        email: "pw@example.com",
        oid: OID_A,
        tid: "local",
        displayName: "pw@example.com",
        status: "enabled",
        version: 1,
        sso: { expectedUpn: "pw@example.com" },
      });
      expect(await rowFor(OID_A)).toMatchObject({
        authMethod: "password",
        flags: ["enabled-password-user"],
      });
    });

    it("combines several flags on one identity", async () => {
      await seedIdentity({
        oid: OID_A,
        lastSignInAt: daysAgo(200),
        groupsOverage: true,
        ambiguousMembership: true,
      });
      expect([...(await rowFor(OID_A)).flags].sort()).toEqual([
        "ambiguous",
        "overage",
        "stale",
      ]);
    });
  });

  it("never returns secrets or lockout state", async () => {
    await putRaw({
      PK: `IDENT#${OID_A}`,
      SK: "META",
      gsi1pk: "IDENTS",
      gsi1sk: `IDENT#${OID_A}`,
      oid: OID_A,
      tid: "t",
      email: "ada@example.com",
      lastSignInAt: daysAgo(1),
      lastSeenRoles: [],
      authMethod: "master",
      version: 1,
      failedAttempts: 4,
      lockedUntil: "2026-12-01T00:00:00.000Z",
      passwordHash: "argon-secret",
    });
    const json = JSON.stringify(await rows());
    expect(json).not.toContain("argon-secret");
    expect(json).not.toContain("lockedUntil");
    expect(json).not.toContain("failedAttempts");
  });
});

// Source: docs/specs/2026-11-10-access-control.md - "Access review" (from unit
// SYNC1 the review also lists the pending LiteLLM links, one not bound after 30
// days flagged stale) and "LiteLLM user sync" (*Pending LiteLLM links*: a
// pending link not bound after 30 days is stale and the access review lists
// it; the partition `PENDING#{key}` is shared with pending members and admin
// scopes), threat T-SY6. Assumed API (the developers build to it):
//   exportAccessReview(ctx) returns `{ date, rows, pendingLiteLLMLinks }`, one
//   entry per pending link `{ key, litellmUserId, createdAt, flags }` with
//   `flags` `["stale"]` when `createdAt` is more than 30 days before `ctx.now`
//   and `[]` otherwise. The CSV layout of these entries is not pinned: the spec
//   does not give it.
describe("pending LiteLLM links in the access review (T-SY6)", () => {
  const seedPending = (key: string, litellmUserId: string, createdAt: string) =>
    putRaw({
      PK: `PENDING#${key}`,
      SK: "LITELLMLINK",
      gsi1pk: "PENDINGLITELLMLINKS",
      gsi1sk: `PENDING#${key}`,
      emailOrOid: key,
      litellmUserId,
      source: "sync",
      version: 1,
      createdAt,
      createdBy: "system",
      lastValidatedAt: createdAt,
    });

  // One export is one audited read keyed by its request id, so each call
  // needs its own id (a repeat collides on the audit key).
  let exportSeq = 0;
  async function exported() {
    const { exportAccessReview } = await import("./access-review");
    exportSeq += 1;
    return (
      await exportAccessReview(ctxAt(REVIEW_NOW, `req-review-${exportSeq}`))
    ).pendingLiteLLMLinks;
  }

  it("lists each pending link, flags one older than 30 days as stale and not one of 29 days", async () => {
    await seedPending("old@corp.example", "lu-old", daysAgo(31));
    await seedPending("new@corp.example", "lu-new", daysAgo(29));
    const listed = await exported();
    const byKey = Object.fromEntries(listed.map((p) => [p.key, p]));
    expect(Object.keys(byKey).sort()).toEqual([
      "new@corp.example",
      "old@corp.example",
    ]);
    expect(byKey["old@corp.example"]).toMatchObject({
      litellmUserId: "lu-old",
      createdAt: daysAgo(31),
      flags: ["stale"],
    });
    expect(byKey["new@corp.example"]).toMatchObject({
      litellmUserId: "lu-new",
      flags: [],
    });
  });

  it("is empty with no pending link, and a pending member of the same email is not listed as one", async () => {
    expect(await exported()).toEqual([]);
    await putRaw({
      PK: "PENDING#old@corp.example",
      SK: "AFFILIATION",
      gsi1pk: "MEMBERS#team-a",
      gsi1sk: "PENDING#old@corp.example",
      kind: "affiliation",
      emailOrUpn: "old@corp.example",
      teamId: "team-a",
      version: 1,
      createdAt: daysAgo(40),
      createdBy: "system",
    });
    await seedPending("old@corp.example", "lu-old", daysAgo(2));
    expect((await exported()).map((p) => p.key)).toEqual(["old@corp.example"]);
  });
});
