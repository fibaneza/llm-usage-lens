import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { IdentityDetailSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import { completePasswordSetupWrite } from "@/lib/data/access/password-credentials-store";
import {
  createPasswordUser,
  sha256Hex,
  userKey,
} from "@/lib/data/access/password-users";
import { createPendingItem } from "@/lib/data/access/pending";
import { grantRole } from "@/lib/data/access/role-grants";
import {
  getIdentityLink,
  putIdentityLink,
} from "@/lib/data/access/identity-links";
import {
  call,
  expectError,
  signInWithRoles,
} from "@/test/fakes/fake-litellm-views";
import {
  PEOPLE,
  seedAdminScope,
  seedCtx,
} from "@/test/support/matrix-route-support";
import {
  setupMemberWritesSuite,
  stubLiteLLMEnv,
} from "@/test/support/litellm-member-writes-support";
import { ok } from "@/test/support/access-test-support";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { TEST_TABLE_NAME, putRaw, testDoc } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (`GET /api/identities/[oid]`: internal-admin, internal-org-admin,
// internal-auditor; everyone else 403; unknown oid 404; per-role blocks
// absent otherwise (D-US11); never a hash, TOTP secret, lockout state, setup
// token or tenant id; read per request, never cached; the caller's allowed
// actions computed on the server), threat T-US1; Design System - "The user
// page (unit US2)" (D-US6, D-US8, D-US10, D-US11). The 401, 400, no-store
// shape belong to the shared route-contract suite (registry entry in
// test/route-registry.ts, Rule 60.23). Rule 60.10: authorization data is
// never cached.
//
// Contract fixed here (the spec leaves key names open):
//   data: IdentityDetail (packages/shared) = {
//     oid, displayName|null, email|null, upn|null, authMethod, createdAt,
//     lastSignInAt, memberTeamId|null, leadScopes: [{scopeType, scopeId}],
//     litellm: { state: "linked", litellmUserId } | { state: "none" },
//     usageIdentities?, aliases?, roleGrants?: [{ role, ... }]   (admin, org-admin, auditor; D-US11)
//     sso?: { expectedUpn, expectedOid?, boundAt? }               (admin, auditor; password users only)
//     allowed: { editDisplayName, linkLiteLLM, unlinkLiteLLM, resetSpend,
//                changeMembership, changeLead, editRoles, editUsageIdentities }
//   }
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupMemberWritesSuite();
const alice = PEOPLE.alice;
const carol = PEOPLE.carol;

const TENANT = "00000000-0000-4000-8000-0000000000ff";
const EXPECTED_OID = "00000000-0000-4000-8000-00000000ee01";
const BOUND_OID = "00000000-0000-4000-8000-00000000ee02";
const PASSWORD_HASH = "$argon2id$v=19$SENTINEL-PASSWORD-HASH";
const TOTP_CIPHER = "SENTINEL-TOTP-CIPHER";
const ALIAS = "alice-sandbox-key";
const GRANT_REASON = "grant-reason-sentinel";
const PAM_EMAIL = "pam@company.com";
const PAM_UPN = "pam@corp.example.com";
const BOUND_AT = "2026-10-05T01:02:03.000Z";
// Keys and values that must never reach any body (T-US1).
const SECRETS =
  /argon2|SENTINEL|passwordHash|totpCipher|totpSecret|tokenHash|setupTokenHash|failedAttempts|lockedUntil|"tid"|0000000000ff/i;

const path = (oid: string) => `/api/identities/${encodeURIComponent(oid)}`;

async function read(oid: string) {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, path(oid), { oid });
}

type Detail = Record<string, unknown> & {
  allowed: Record<string, boolean>;
  sso?: { expectedUpn: string; expectedOid?: string; boundAt?: string };
  passwordUserVersion?: number;
  invites?: { teamId: string; key: string }[];
};
const dataOf = (body: { data?: unknown }) => body.data as Detail;

async function signIn(who: CallerName | "noRole") {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
}

// An Entra person with every private attribute stored.
async function seedPerson(
  oid: string,
  over: { email: string; name: string; upn?: string },
) {
  await putRaw({
    PK: `IDENT#${oid}`,
    SK: "META",
    gsi1pk: "IDENTS",
    gsi1sk: `IDENT#${oid}`,
    oid,
    tid: TENANT,
    email: over.email,
    ...(over.upn ? { upn: over.upn } : {}),
    displayName: over.name,
    createdAt: "2025-06-01T00:00:00.000Z",
    lastSignInAt: "2026-01-01T00:00:00.000Z",
    lastSeenRoles: ["internal-viewer"],
    authMethod: "entra",
    version: 1,
    failedAttempts: 2,
    lockedUntil: "2026-01-01T01:00:00.000Z",
  });
}

async function seedAlicePrivate() {
  await seedPerson(alice.oid, {
    email: alice.email,
    name: alice.name,
    upn: "alice@corp.example.com",
  });
  const existing = await getIdentityLink(alice.oid);
  ok(
    await putIdentityLink(
      {
        oid: alice.oid,
        usageIdentities: [alice.email],
        aliases: [ALIAS],
        litellmUserId: "lu-alice",
        version: existing?.version ?? null,
      },
      seedCtx(),
    ),
  );
  ok(
    await grantRole(
      { oid: alice.oid, role: "internal-org-admin", reason: GRANT_REASON },
      seedCtx(),
    ),
  );
}

// A password user with a hash, an enrolled TOTP secret, a stored setup token
// and lockout state; `bound` adds the Entra binding the sign-in sync writes.
async function seedPasswordPerson(bound: boolean) {
  const created = ok(
    await createPasswordUser(
      {
        email: PAM_EMAIL,
        displayName: "Pam",
        sso: { expectedUpn: PAM_UPN, expectedOid: EXPECTED_OID },
      },
      seedCtx(),
    ),
  );
  ok(
    await completePasswordSetupWrite(
      {
        email: PAM_EMAIL,
        tokenHash: sha256Hex(created.setupToken),
        passwordHash: PASSWORD_HASH,
        totp: { cipher: TOTP_CIPHER, step: 3 },
      },
      seedCtx(),
    ),
  );
  await putRaw({
    PK: `IDENT#${created.user.oid}`,
    SK: "META",
    gsi1pk: "IDENTS",
    gsi1sk: `IDENT#${created.user.oid}`,
    oid: created.user.oid,
    tid: TENANT,
    email: PAM_EMAIL,
    displayName: "Pam",
    createdAt: "2025-07-01T00:00:00.000Z",
    lastSignInAt: "2026-02-01T00:00:00.000Z",
    lastSeenRoles: [],
    authMethod: "password",
    version: 1,
    failedAttempts: 1,
    lockedUntil: "2026-02-01T01:00:00.000Z",
  });
  if (bound) {
    await testDoc().send(
      new UpdateCommand({
        TableName: TEST_TABLE_NAME,
        Key: userKey(PAM_EMAIL),
        UpdateExpression:
          "SET #s = :b, sso.boundAt = :at, sso.tid = :t, sso.oid = :o",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":b": "sso-bound",
          ":at": BOUND_AT,
          ":t": TENANT,
          ":o": BOUND_OID,
        },
      }),
    );
  }
  return { oid: created.user.oid, token: created.setupToken };
}

describe("GET /api/identities/[oid]", () => {
  describe("who may read (API routes: admin, org-admin, auditor; T-US1)", () => {
    it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
      "%s gets 200 with the { data } shape and the common fields, and no LiteLLM call",
      async (who) => {
        await seedAlicePrivate();
        signInAs(who);
        const { res, body } = await read(alice.oid);
        expect(res.status).toBe(200);
        expect(body.error).toBeUndefined();
        const data = IdentityDetailSchema.parse(body.data);
        expect(data).toMatchObject({
          oid: alice.oid,
          displayName: alice.name,
          email: alice.email,
          upn: "alice@corp.example.com",
          authMethod: "entra",
          createdAt: "2025-06-01T00:00:00.000Z",
          lastSignInAt: "2026-01-01T00:00:00.000Z",
          memberTeamId: "team-a",
          litellm: { state: "linked", litellmUserId: "lu-alice" },
        });
        expect(state.fake.calls).toHaveLength(0);
      },
    );

    it.each([
      "teamAdminA",
      "deptAdminEng",
      "memberA",
      "viewerNone",
      "noRole",
    ] as const)(
      "%s gets 403 FORBIDDEN, the same body for an existing and an unknown oid",
      async (who) => {
        await seedAlicePrivate();
        await signIn(who);
        const known = await read(alice.oid);
        const unknown = await read("no-such-person");
        await expectError(known.res, 403, "FORBIDDEN");
        await expectError(unknown.res, 403, "FORBIDDEN");
        expect(known.body).toEqual(unknown.body);
        expect(known.text).not.toContain(alice.email);
        expect(state.fake.calls).toHaveLength(0);
      },
    );

    it("an unknown oid is 404 NOT_FOUND with a body that does not echo it", async () => {
      signInAs("admin");
      const a = await read("no-such-person");
      const b = await read("another-missing-oid");
      await expectError(a.res, 404, "NOT_FOUND");
      await expectError(b.res, 404, "NOT_FOUND");
      expect(a.body.error.message).toBe(b.body.error.message);
      expect(a.text).not.toContain("no-such-person");
    });
  });

  describe("blocks by role (D-US11, D-US12): an absent block is absent from the body, not empty", () => {
    // D-US11 (the user, 2026-11-23): an org-admin reads the two blocks on this
    // page; D-US12: still no sso block. Writes stay admin-only: the shared
    // route-contract suite (route-contract.integration.test.ts, section 2)
    // proves PUT identities/[oid]/links and POST/DELETE role-grants answer
    // every non-admin, org-admin included, 403 before parsing.
    it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
      "%s gets usage identities, aliases and global role grants (D-US11)",
      async (who) => {
        await seedAlicePrivate();
        signInAs(who);
        const data = dataOf((await read(alice.oid)).body);
        expect(data.usageIdentities).toEqual([alice.email]);
        expect(data.aliases).toEqual([ALIAS]);
        expect(data.roleGrants).toEqual([
          expect.objectContaining({ role: "internal-org-admin" }),
        ]);
      },
    );

    it("org-admin's body has no sso key, whatever the person (D-US12)", async () => {
      await seedAlicePrivate();
      signInAs("orgAdmin");
      expect(dataOf((await read(alice.oid)).body)).not.toHaveProperty("sso");
    });

    it("an Entra person has no sso block for any role", async () => {
      await seedAlicePrivate();
      for (const who of ["admin", "orgAdmin", "auditor"] as CallerName[]) {
        signInAs(who);
        expect(dataOf((await read(alice.oid)).body), who).not.toHaveProperty(
          "sso",
        );
      }
    });

    it("the team membership and lead scope come from the stored affiliation and admin scopes", async () => {
      await seedPerson(carol.oid, { email: carol.email, name: carol.name });
      const scope = await seedAdminScope(carol.oid, "team", "team-a");
      signInAs("orgAdmin");
      const data = dataOf((await read(carol.oid)).body);
      expect(data.memberTeamId).toBeNull();
      // Design System - "The user page (unit US2)", agent decisions
      // 2026-11-24: the read carries the version each write route needs.
      expect(data.leadScopes).toEqual([
        { scopeType: "team", scopeId: "team-a", version: scope.version },
      ]);
      expect(data.litellm).toEqual({ state: "none" });
    });

    it("is read per request, never cached: a grant made after a first read shows in the next (Rule 60.10)", async () => {
      await seedPerson(carol.oid, { email: carol.email, name: carol.name });
      signInAs("admin");
      expect(dataOf((await read(carol.oid)).body).roleGrants).toEqual([]);
      ok(
        await grantRole(
          { oid: carol.oid, role: "internal-admin", reason: "later" },
          seedCtx(),
        ),
      );
      expect(dataOf((await read(carol.oid)).body).roleGrants).toEqual([
        expect.objectContaining({ role: "internal-admin" }),
      ]);
    });
  });

  // Source: Access Control - "Placing a person by hand" (on the user page a
  // row is `signed-in`, or `invited` when a pending member invite exists for the
  // person's email or UPN, and then carries `invites: [{ teamId, key }, ...]`, one per invite (review W4); readers
  // get no state), T-IV5. Both keys are absent, not null, for a read-only role.
  // US2's fields above stay as they are.
  describe("state and invite (Placing a person by hand; T-IV5)", () => {
    const CAROL_UPN = "carol@corp.example.com";
    const inviteFor = async (key: string) =>
      ok(
        await createPendingItem(
          { kind: "affiliation", emailOrUpn: key, teamId: "team-b" },
          seedCtx(),
        ),
      );

    it.each(["admin", "orgAdmin"] as CallerName[])(
      "%s: a person with no invite is signed-in and has no invites key",
      async (who) => {
        await seedPerson(carol.oid, { email: carol.email, name: carol.name });
        signInAs(who);
        const data = dataOf((await read(carol.oid)).body);
        expect(data.state).toBe("signed-in");
        expect(data).not.toHaveProperty("invites");
        expect(data).not.toHaveProperty("invite");
      },
    );

    it.each([
      ["the UPN", CAROL_UPN],
      ["the email", carol.email],
    ])(
      "admin and org-admin: a pending member invite for %s makes the person invited, with the invite's team and key in invites",
      async (_name, key) => {
        await seedPerson(carol.oid, {
          email: carol.email,
          name: carol.name,
          upn: CAROL_UPN,
        });
        await inviteFor(key);
        for (const who of ["admin", "orgAdmin"] as CallerName[]) {
          signInAs(who);
          const data = dataOf((await read(carol.oid)).body);
          expect(data.state, who).toBe("invited");
          expect(data.invites, who).toEqual([{ teamId: "team-b", key }]);
          expect(data, who).not.toHaveProperty("invite");
          IdentityDetailSchema.parse(data);
        }
      },
    );

    it.each(["admin", "orgAdmin"] as CallerName[])(
      "%s: invites under the UPN and under the email, on two teams, are both returned (W4)",
      async (who) => {
        await seedPerson(carol.oid, {
          email: carol.email,
          name: carol.name,
          upn: CAROL_UPN,
        });
        await inviteFor(CAROL_UPN);
        ok(
          await createPendingItem(
            {
              kind: "affiliation",
              emailOrUpn: carol.email,
              teamId: "team-c",
            },
            seedCtx(),
          ),
        );
        signInAs(who);
        const data = dataOf((await read(carol.oid)).body);
        expect(data.state).toBe("invited");
        expect(
          [...(data.invites ?? [])].sort(
            (a: { teamId: string }, b: { teamId: string }) =>
              a.teamId.localeCompare(b.teamId),
          ),
        ).toEqual([
          { teamId: "team-b", key: CAROL_UPN },
          { teamId: "team-c", key: carol.email },
        ]);
        IdentityDetailSchema.parse(data);
      },
    );

    it("the auditor and every other read-only role get neither state nor invites: the keys are not present, even with an invite pending", async () => {
      await seedPerson(carol.oid, {
        email: carol.email,
        name: carol.name,
        upn: CAROL_UPN,
      });
      await inviteFor(CAROL_UPN);
      signInAs("auditor");
      const { body, text } = await read(carol.oid);
      expect(body.data).not.toHaveProperty("state");
      expect(body.data).not.toHaveProperty("invites");
      expect(text).not.toContain("invited");
      expect(text).not.toContain("team-b");
    });
  });

  describe("a password user's SSO reference (D-US10, D-US12)", () => {
    it.each(["admin", "auditor"] as CallerName[])(
      "%s sees the expected UPN and Entra id, and no bound date before binding",
      async (who) => {
        const pam = await seedPasswordPerson(false);
        signInAs(who);
        const data = dataOf((await read(pam.oid)).body);
        expect(data.authMethod).toBe("password");
        expect(data.sso).toEqual({
          expectedUpn: PAM_UPN,
          expectedOid: EXPECTED_OID,
        });
      },
    );

    it.each(["admin", "auditor"] as CallerName[])(
      "%s sees the bound date once bound, and not the Entra tenant or bound oid",
      async (who) => {
        const pam = await seedPasswordPerson(true);
        signInAs(who);
        const { body, text } = await read(pam.oid);
        expect(dataOf(body).sso).toMatchObject({
          expectedUpn: PAM_UPN,
          boundAt: BOUND_AT,
        });
        expect(text).not.toContain(BOUND_OID);
      },
    );

    it.each([false, true])(
      "org-admin sees no sso block and none of its values (bound: %s)",
      async (bound) => {
        const pam = await seedPasswordPerson(bound);
        signInAs("orgAdmin");
        const { body, text } = await read(pam.oid);
        expect(dataOf(body).authMethod).toBe("password");
        expect(dataOf(body)).not.toHaveProperty("sso");
        for (const value of [PAM_UPN, EXPECTED_OID, BOUND_OID, BOUND_AT]) {
          expect(text).not.toContain(value);
        }
      },
    );
  });

  describe("never a credential, secret, lockout state, setup token or tenant id (T-US1)", () => {
    it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
      "%s: no hash, TOTP secret, lockout, token or tenant id in an Entra, an unbound and a bound password user's body",
      async (who) => {
        await seedAlicePrivate();
        const unbound = await seedPasswordPerson(false);
        signInAs(who);
        for (const oid of [alice.oid, unbound.oid]) {
          const { text } = await read(oid);
          expect(text).not.toMatch(SECRETS);
          expect(text).not.toContain(unbound.token);
          expect(text).not.toContain(sha256Hex(unbound.token));
        }
        await testDoc().send(
          new UpdateCommand({
            TableName: TEST_TABLE_NAME,
            Key: userKey(PAM_EMAIL),
            UpdateExpression:
              "SET #s = :b, sso.boundAt = :at, sso.tid = :t, sso.oid = :o",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
              ":b": "sso-bound",
              ":at": BOUND_AT,
              ":t": TENANT,
              ":o": BOUND_OID,
            },
          }),
        );
        expect((await read(unbound.oid)).text).not.toMatch(SECRETS);
      },
    );
  });

  describe("allowed actions, computed on the server from the effective roles (Design System D-US6/D-US7; T-US1)", () => {
    it("admin on another person may use every action; the name only for a password user", async () => {
      await seedAlicePrivate();
      const pam = await seedPasswordPerson(false);
      signInAs("admin");
      const onAlice = dataOf((await read(alice.oid)).body).allowed;
      expect(onAlice).toMatchObject({
        editDisplayName: false,
        linkLiteLLM: true,
        unlinkLiteLLM: true,
        changeMembership: true,
        changeLead: true,
        editRoles: true,
        editUsageIdentities: true,
      });
      expect(typeof onAlice.resetSpend).toBe("boolean");
      const onPam = dataOf((await read(pam.oid)).body).allowed;
      expect(onPam.editDisplayName).toBe(true);
    });

    // Design System "The user page" 2026-11-24 rulings: R1 (no dead control;
    // the name comes from Entra after binding) and Q-B1 (the page sends the
    // version it read; `passwordUserVersion` is present only when
    // allowed.editDisplayName).
    it("an SSO-bound password user has editDisplayName false and no passwordUserVersion, for an admin (R1)", async () => {
      const pam = await seedPasswordPerson(true);
      signInAs("admin");
      const body = dataOf((await read(pam.oid)).body);
      expect(body.allowed.editDisplayName).toBe(false);
      expect(body).not.toHaveProperty("passwordUserVersion");
    });

    it("an unbound password user read by an admin carries passwordUserVersion equal to the stored version, and a name edit bumps it (Q-B1)", async () => {
      const pam = await seedPasswordPerson(false);
      signInAs("admin");
      const first = dataOf((await read(pam.oid)).body);
      expect(first.allowed.editDisplayName).toBe(true);
      expect(first.passwordUserVersion).toBeGreaterThanOrEqual(1);
      const stored = await testDoc().send(
        new GetCommand({
          TableName: TEST_TABLE_NAME,
          Key: userKey(PAM_EMAIL),
        }),
      );
      expect(first.passwordUserVersion).toBe(Number(stored.Item?.version));
      await testDoc().send(
        new UpdateCommand({
          TableName: TEST_TABLE_NAME,
          Key: userKey(PAM_EMAIL),
          UpdateExpression: "SET version = version + :one",
          ExpressionAttributeValues: { ":one": 1 },
        }),
      );
      expect(dataOf((await read(pam.oid)).body).passwordUserVersion).toBe(
        Number(first.passwordUserVersion) + 1,
      );
    });

    it.each(["orgAdmin", "auditor"] as CallerName[])(
      "%s reads an unbound password user with no passwordUserVersion (present only when editDisplayName; Q-B1)",
      async (who) => {
        const pam = await seedPasswordPerson(false);
        signInAs(who);
        expect(dataOf((await read(pam.oid)).body)).not.toHaveProperty(
          "passwordUserVersion",
        );
      },
    );

    it("an Entra person has no passwordUserVersion (Q-B1)", async () => {
      await seedAlicePrivate();
      signInAs("admin");
      expect(dataOf((await read(alice.oid)).body)).not.toHaveProperty(
        "passwordUserVersion",
      );
    });

    it("org-admin: LiteLLM link, team and lead actions, but no role grant, usage identity edit or name edit", async () => {
      await seedAlicePrivate();
      const pam = await seedPasswordPerson(false);
      signInAs("orgAdmin");
      expect(dataOf((await read(alice.oid)).body).allowed).toMatchObject({
        editDisplayName: false,
        linkLiteLLM: true,
        unlinkLiteLLM: true,
        changeMembership: true,
        changeLead: true,
        editRoles: false,
        editUsageIdentities: false,
      });
      expect(dataOf((await read(pam.oid)).body).allowed.editDisplayName).toBe(
        false,
      );
    });

    it("auditor reads only: every action is false, for an Entra and a password user", async () => {
      await seedAlicePrivate();
      const pam = await seedPasswordPerson(false);
      signInAs("auditor");
      for (const oid of [alice.oid, pam.oid]) {
        const allowed = dataOf((await read(oid)).body).allowed;
        expect(Object.keys(allowed).length).toBeGreaterThan(0);
        expect(Object.values(allowed).every((v) => v === false)).toBe(true);
      }
    });

    it("on one's own page an admin has no role edit and no link write", async () => {
      await seedPerson(CALLERS.admin.oid, {
        email: CALLERS.admin.email,
        name: "Admin",
      });
      signInAs("admin");
      expect(
        dataOf((await read(CALLERS.admin.oid)).body).allowed,
      ).toMatchObject({
        editRoles: false,
        editUsageIdentities: false,
        linkLiteLLM: false,
        unlinkLiteLLM: false,
      });
    });

    it("on one's own page an org-admin has no LiteLLM link write", async () => {
      await seedPerson(CALLERS.orgAdmin.oid, {
        email: CALLERS.orgAdmin.email,
        name: "Org admin",
      });
      signInAs("orgAdmin");
      expect(
        dataOf((await read(CALLERS.orgAdmin.oid)).body).allowed,
      ).toMatchObject({ linkLiteLLM: false, unlinkLiteLLM: false });
    });
  });
});
