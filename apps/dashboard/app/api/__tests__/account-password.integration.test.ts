import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { auth } from "@/auth";
import { authorizePasswordUser } from "@/lib/auth/password-credentials";
import { hashPassword } from "@/lib/auth/password-hash";
import {
  GOOD_PASSWORD,
  OTHER_PASSWORD,
  TOTP_SECRET,
  fakeEnvelope,
  totpAt,
} from "@/test/support/password-test-support";
import {
  NOW,
  auditRecords,
  ctxAt,
  ok,
} from "@/test/support/access-test-support";
import { resetDeniedAudit } from "@/lib/data/access/audit";
import { grantRole } from "@/lib/data/access/role-grants";
import {
  completePasswordSetupWrite,
  getPasswordCredential,
} from "@/lib/data/access/password-credentials-store";
import {
  createPasswordUser,
  deletePasswordUser,
  getPasswordUser,
  sha256Hex,
  userKey,
} from "@/lib/data/access/password-users";
import {
  expectData,
  expectError,
  invoke,
  nonAuditItems,
} from "@/test/support/governance-route-support";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

import { POST } from "../account/password/route";

// Source: docs/specs/2026-11-10-access-control.md - "Password users"
// (Passwords: Argon2id hash only, 12-128 characters, no composition rules,
// rejected when in the bundled common-password list; "A signed-in password
// user may change their own password with the current one (and TOTP when
// enrolled)"; TOTP D23: last used step stored, a reused code refused; Sign-in:
// per-user lockout 5 failures -> 15 minutes shared with sign-in, generic
// errors; SSO reference and binding: a bound user is refused the password),
// "API routes (additions)" (POST /api/account/password: the signed-in password
// user, own password, current password and TOTP required), "Enforcement" items
// 2, 4 and 6 (401, then 403 before parsing, then the same-origin 403, then Zod
// 400; every response private, no-store; write body must be application/json),
// "Audit log" (own password change is audited; any other rejection writes no
// record), "Error-code registry" (WEAK_PASSWORD 400, SSO_BOUND 409), threats
// T23 (generic errors), T27 (TOTP replay).
//
// Decisions this suite fixes where the spec is silent (see the report):
//  - Body { currentPassword, newPassword, totp? }. Success is 200 { data: {} }
//    (any object without secrets).
//  - The user is identified from the session (`authMethod: "password"` plus its
//    email/oid), never from the body.
//  - A wrong or missing current password, a wrong, missing, replayed TOTP
//    code, a locked, disabled or deleted user: one identical 403 FORBIDDEN
//    body (the session stays valid, so not 401), counted toward lockout.
//  - The new password is checked against the policy before any credential is
//    verified, so a weak password neither counts as a failed attempt nor spends
//    the TOTP time step.
//  - Success audits exactly one `localuser.update` (the action setup uses),
//    actor = the user's oid, with no secrets. The current session is not
//    touched (stateless JWT; no Set-Cookie); other sessions are not revoked.
//  - TOTP is demanded when the user has enrolled, or is required to (D23) and
//    has not; otherwise the current password alone suffices.
// Only `@/auth` and the KMS envelope boundary are mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/env", () => ({
  env: new Proxy({}, { get: (_t, key) => process.env[String(key)] }),
}));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});
vi.mock("@/lib/auth/secret-envelope", () =>
  import("@/test/support/password-test-support").then((m) => m.fakeEnvelope),
);

const PATH = "/api/account/password";
const EMAIL = "alice@example.com";
const NEW_PASSWORD = "a brand new sturdy passphrase";
const SECRET_WORDS =
  /argon2|passwordHash|totpCipher|totpSecret|tokenHash|"token"|currentPassword|newPassword/i;

let seq = 0;
const seedCtx = () =>
  ctxAt(new Date("2020-01-01T00:00:00.000Z"), `seed-${++seq}`);
const step = (at: Date) => Math.floor(at.getTime() / 30_000);

type Seeded = { oid: string; email: string };

// D-TS1: the real Argon2id hash of GOOD_PASSWORD, computed once per file and
// reused by every seeded user; the route's verify and re-hash still run for real.
let goodPasswordHash: string;

// A user who finished setup: a real Argon2id hash for GOOD_PASSWORD and, when
// asked, an enrolled TOTP secret whose last used step is long past.
async function seedUser(
  options: { email?: string; totp?: boolean } = {},
): Promise<Seeded> {
  const email = options.email ?? EMAIL;
  const created = ok(
    await createPasswordUser({ email, displayName: "Alice" }, seedCtx()),
  );
  ok(
    await completePasswordSetupWrite(
      {
        email,
        tokenHash: sha256Hex(created.setupToken),
        passwordHash: goodPasswordHash,
        ...(options.totp
          ? {
              totp: {
                cipher: await fakeEnvelope.encryptSecret(TOTP_SECRET),
                step: step(NOW) - 10,
              },
            }
          : {}),
      },
      seedCtx(),
    ),
  );
  return { oid: created.user.oid, email };
}

function signInAsPasswordUser(
  user: Seeded,
  extra: Record<string, unknown> = {},
) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      oid: user.oid,
      tid: "local",
      email: user.email,
      name: "Alice",
      roles: [],
      authMethod: "password",
      authTime: Math.floor(NOW.getTime() / 1000),
      ...extra,
    },
  } as never);
}

function signInAs(user: Record<string, unknown> | null) {
  vi.mocked(auth).mockResolvedValue((user ? { user } : null) as never);
}

const change = (
  body: unknown,
  options: { origin?: string | null; contentType?: string | null } = {},
) =>
  invoke(POST, {
    method: "POST",
    path: PATH,
    body,
    ...options,
  });

const credentialOf = async (email = EMAIL) =>
  (await getPasswordCredential(email))!;

const body = (overrides: Record<string, unknown> = {}) => ({
  currentPassword: GOOD_PASSWORD,
  newPassword: NEW_PASSWORD,
  ...overrides,
});

async function setRawStatus(email: string, status: string) {
  await testDoc().send(
    new UpdateCommand({
      TableName: TEST_TABLE_NAME,
      Key: userKey(email),
      UpdateExpression: "SET #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status },
    }),
  );
}

async function setNow(at: Date) {
  vi.setSystemTime(at);
}

// Every localuser.update record except a `denied` one (F6: a non-password
// session's refusal is an authorization record, not a password write).
const updateRecords = async () =>
  (await auditRecords()).filter(
    (r) => r.action === "localuser.update" && r.result !== "denied",
  );

beforeAll(ensureTestTable);
beforeAll(async () => {
  goodPasswordHash = await hashPassword(GOOD_PASSWORD);
});
beforeEach(async () => {
  await clearTable();
  vi.mocked(auth).mockReset();
  // Only the clock is faked, so Argon2 and the SDK still run for real.
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => vi.useRealTimers());

describe("POST /api/account/password", { timeout: 60_000 }, () => {
  describe("session, identity and origin gates", () => {
    const NOT_PASSWORD_USERS: [string, Record<string, unknown>][] = [
      [
        "an Entra admin with the same email",
        {
          oid: "11111111-aaaa-4aaa-8aaa-111111111111",
          tid: "tenant",
          email: EMAIL,
          roles: ["internal-admin"],
          authMethod: "entra",
        },
      ],
      [
        "the master user",
        {
          oid: "master:",
          tid: "master",
          email: EMAIL,
          roles: ["internal-admin"],
          authMethod: "master",
        },
      ],
      [
        "the dev login",
        {
          oid: "local:dev@localhost",
          tid: "local",
          email: EMAIL,
          roles: ["internal-admin"],
          authMethod: "local",
        },
      ],
      [
        "a session with no authMethod",
        { oid: "oid-old", email: EMAIL, roles: ["internal-admin"] },
      ],
    ];

    it.each(NOT_PASSWORD_USERS)(
      "403 FORBIDDEN for %s, even with the right current password, before parsing; the password is untouched",
      async (_name, user) => {
        await seedUser();
        const before = await credentialOf();
        const versionBefore = (await getPasswordUser(EMAIL))!.version;
        signInAs(user);
        for (const sent of [body(), "{not json", {}]) {
          await expectError(await change(sent), 403, "FORBIDDEN");
        }
        expect(await credentialOf()).toEqual(before);
        expect((await getPasswordUser(EMAIL))!.version).toBe(versionBefore);
        expect(await updateRecords()).toHaveLength(0);
      },
    );

    // F6 (run-r4b decisions) and D17: a non-password session is refused by an
    // authorization check, so exactly one `denied` record (actor, the operation
    // the route serves, FORBIDDEN, the fixed route pattern; no secrets).
    it.each(NOT_PASSWORD_USERS)(
      "F6: %s writes exactly one denied record with the fixed route pattern and no secrets",
      async (_name, user) => {
        await seedUser();
        resetDeniedAudit();
        signInAs(user);
        await expectError(await change(body()), 403, "FORBIDDEN");
        const denied = (await auditRecords()).filter(
          (r) => r.result === "denied",
        );
        expect(denied).toHaveLength(1);
        expect(denied[0]).toMatchObject({
          actor: user.oid,
          action: "localuser.update",
          category: "security",
          code: "FORBIDDEN",
          route: { method: "POST", pattern: "/api/account/password" },
        });
        const text = JSON.stringify(denied[0]);
        expect(text).not.toMatch(SECRET_WORDS);
        expect(text).not.toContain(GOOD_PASSWORD);
        expect(text).not.toContain(NEW_PASSWORD);
      },
    );

    it("F6: a password session refused for a wrong current password is a credential failure, not an authorization refusal: no denied record", async () => {
      const alice = await seedUser();
      resetDeniedAudit();
      signInAsPasswordUser(alice);
      await expectError(
        await change(body({ currentPassword: "not the password" })),
        403,
        "FORBIDDEN",
      );
      expect(
        (await auditRecords()).filter((r) => r.result === "denied"),
      ).toHaveLength(0);
    });

    it("the Origin check never reaches a different user: x-forwarded-host does not make a foreign Origin pass", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      const res = await POST(
        new Request(`http://localhost:3000${PATH}`, {
          method: "POST",
          headers: {
            host: "localhost:3000",
            origin: "https://evil.example.test",
            "x-forwarded-host": "evil.example.test",
            "content-type": "application/json",
          },
          body: JSON.stringify(body()),
        }),
        { params: Promise.resolve({}) },
      );
      await expectError(res, 403, "FORBIDDEN");
    });
  });

  describe("400 on a bad request", () => {
    it.each([
      ["a body that is not JSON", "{not json", undefined],
      ["a JSON array", [], undefined],
      ["an empty object", {}, undefined],
      ["a missing newPassword", { currentPassword: GOOD_PASSWORD }, undefined],
      ["a missing currentPassword", { newPassword: NEW_PASSWORD }, undefined],
      ["a numeric newPassword", body({ newPassword: 123456789012 }), undefined],
      ["a numeric currentPassword", body({ currentPassword: 7 }), undefined],
      ["a non-string totp", body({ totp: 123456 }), undefined],
      ["a content type other than application/json", body(), "text/plain"],
      ["no content type", body(), null],
    ] as const)(
      "400 BAD_REQUEST for %s, and nothing changes",
      async (_name, sent, contentType) => {
        const alice = await seedUser();
        signInAsPasswordUser(alice);
        const before = await credentialOf();
        const res = await change(sent, {
          ...(contentType !== undefined ? { contentType } : {}),
        });
        await expectError(res, 400, "BAD_REQUEST");
        expect(await credentialOf()).toEqual(before);
        expect(await updateRecords()).toHaveLength(0);
      },
    );

    it("an absurdly long newPassword is a 400 and changes nothing", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      const before = await credentialOf();
      const res = await change(body({ newPassword: "x1".repeat(50_000) }));
      expect(res.status).toBe(400);
      expect(await credentialOf()).toEqual(before);
    });

    it("the identity comes from the session: an email in the body never selects another user", async () => {
      const alice = await seedUser();
      await seedUser({ email: "bob@example.com" });
      signInAsPasswordUser(alice);
      const bobBefore = await credentialOf("bob@example.com");
      const res = await change(body({ email: "bob@example.com" }));
      expect([200, 400]).toContain(res.status);
      expect(await credentialOf("bob@example.com")).toEqual(bobBefore);
    });
  });

  describe("WEAK_PASSWORD", () => {
    it.each([
      ["too short (11 characters)", "elevenchars"],
      ["too long (129 characters)", "a1".repeat(64) + "b"],
      ["on the common-password list", "password1234"],
      ["the common list ignoring case", "PassWord1234"],
      ["one character repeated", "zzzzzzzzzzzzzz"],
    ])(
      "400 WEAK_PASSWORD when the new password is %s; nothing changes",
      async (_name, weak) => {
        const alice = await seedUser();
        signInAsPasswordUser(alice);
        const before = await credentialOf();
        const versionBefore = (await getPasswordUser(EMAIL))!.version;
        await expectError(
          await change(body({ newPassword: weak })),
          400,
          "WEAK_PASSWORD",
        );
        expect(await credentialOf()).toEqual(before);
        expect((await getPasswordUser(EMAIL))!.version).toBe(versionBefore);
        expect(await updateRecords()).toHaveLength(0);
      },
    );

    it("accepts exactly 12 and exactly 128 characters, with no composition rule", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      const twelve = "plum-otter-4";
      await expectData(await change(body({ newPassword: twelve })));
      expect(
        await authorizePasswordUser(
          { email: alice.email, password: twelve },
          { now: () => NOW },
        ),
      ).not.toBeNull();
      const long = "qz".repeat(64);
      await expectData(
        await change(body({ currentPassword: twelve, newPassword: long })),
      );
      expect(
        await authorizePasswordUser(
          { email: alice.email, password: long },
          { now: () => NOW },
        ),
      ).not.toBeNull();
    });

    it("a weak password does not count toward lockout", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      for (let i = 0; i < 6; i += 1) {
        await change(body({ newPassword: "short" }));
      }
      await expectData(await change(body()));
    });
  });

  describe("a wrong credential gives one generic error", () => {
    async function attempt(
      overrides: Record<string, unknown>,
    ): Promise<{ status: number; json: unknown }> {
      const res = await change(body(overrides));
      return { status: res.status, json: await res.json() };
    }

    it("a wrong current password is a 403 FORBIDDEN that names no cause, with nothing changed", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      const before = await credentialOf();
      const res = await change(body({ currentPassword: OTHER_PASSWORD }));
      const parsed = await expectError(res, 403, "FORBIDDEN");
      expect(parsed.error.message).not.toMatch(
        /lock|disabled|deleted|sso|totp|authenticator|exist/i,
      );
      expect(JSON.stringify(parsed)).not.toContain(OTHER_PASSWORD);
      expect(JSON.stringify(parsed)).not.toContain(NEW_PASSWORD);
      expect(await credentialOf()).toEqual(before);
      expect(await updateRecords()).toHaveLength(0);
    });

    it("wrong password, wrong TOTP, missing TOTP, locked, disabled and deleted all answer with the identical body", async () => {
      const bodies: { status: number; json: unknown }[] = [];

      const alice = await seedUser({ totp: true });
      signInAsPasswordUser(alice);
      bodies.push(
        await attempt({ currentPassword: OTHER_PASSWORD, totp: totpAt(NOW) }),
      );
      bodies.push(await attempt({ totp: "000000" }));
      bodies.push(await attempt({}));

      const locked = await seedUser({ email: "locked@example.com" });
      signInAsPasswordUser(locked);
      for (let i = 0; i < 5; i += 1) {
        await attempt({ currentPassword: OTHER_PASSWORD });
      }
      bodies.push(await attempt({}));

      const off = await seedUser({ email: "off@example.com" });
      signInAsPasswordUser(off);
      await setRawStatus("off@example.com", "disabled");
      bodies.push(await attempt({}));

      const gone = await seedUser({ email: "gone@example.com" });
      signInAsPasswordUser(gone);
      ok(await deletePasswordUser("gone@example.com", seedCtx()));
      bodies.push(await attempt({}));

      const [first] = bodies;
      expect(first!.status).toBe(403);
      for (const other of bodies) expect(other).toEqual(first);
    });

    it("a session for a user that never existed gets the same generic body", async () => {
      signInAs({
        oid: "local:00000000-0000-4000-8000-00000000dead",
        tid: "local",
        email: "ghost@example.com",
        roles: [],
        authMethod: "password",
      });
      const ghost = await attempt({});
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      expect(ghost).toEqual(await attempt({ currentPassword: OTHER_PASSWORD }));
    });

    it("the old password still signs in after every refusal", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      await attempt({ currentPassword: OTHER_PASSWORD });
      expect(
        await authorizePasswordUser(
          { email: alice.email, password: GOOD_PASSWORD },
          { now: () => NOW },
        ),
      ).not.toBeNull();
    });
  });

  describe("lockout (5 failures -> 15 minutes, shared with sign-in)", () => {
    it("5 wrong current passwords lock the account, even for the right password, until 15 minutes pass", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      for (let i = 0; i < 5; i += 1) {
        await expectError(
          await change(body({ currentPassword: OTHER_PASSWORD })),
          403,
          "FORBIDDEN",
        );
      }
      const before = await credentialOf();
      await expectError(await change(body()), 403, "FORBIDDEN");
      expect(await credentialOf()).toMatchObject({
        passwordHash: before.passwordHash,
      });

      await setNow(new Date(NOW.getTime() + 14 * 60_000));
      await expectError(await change(body()), 403, "FORBIDDEN");

      await setNow(new Date(NOW.getTime() + 16 * 60_000));
      await expectData(await change(body()));
    });

    it("the lock is the sign-in lock: it also refuses a password sign-in", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      for (let i = 0; i < 5; i += 1) {
        await change(body({ currentPassword: OTHER_PASSWORD }));
      }
      expect(
        await authorizePasswordUser(
          { email: alice.email, password: GOOD_PASSWORD },
          { now: () => NOW },
        ),
      ).toBeNull();
    });

    it("failed sign-ins count too: 4 of them plus 1 wrong change locks the account", async () => {
      const alice = await seedUser();
      for (let i = 0; i < 4; i += 1) {
        await authorizePasswordUser(
          { email: alice.email, password: OTHER_PASSWORD },
          { now: () => NOW },
        );
      }
      signInAsPasswordUser(alice);
      await change(body({ currentPassword: OTHER_PASSWORD }));
      await expectError(await change(body()), 403, "FORBIDDEN");
    });

    it("a success resets the count: 4 failures, a success, 4 more failures do not lock", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      for (let i = 0; i < 4; i += 1) {
        await change(body({ currentPassword: OTHER_PASSWORD }));
      }
      await expectData(await change(body()));
      for (let i = 0; i < 4; i += 1) {
        await change(
          body({ currentPassword: OTHER_PASSWORD, newPassword: GOOD_PASSWORD }),
        );
      }
      await expectData(
        await change(
          body({ currentPassword: NEW_PASSWORD, newPassword: GOOD_PASSWORD }),
        ),
      );
    });

    it("does not lock another user", async () => {
      const alice = await seedUser();
      const bob = await seedUser({ email: "bob@example.com" });
      signInAsPasswordUser(alice);
      for (let i = 0; i < 5; i += 1) {
        await change(body({ currentPassword: OTHER_PASSWORD }));
      }
      signInAsPasswordUser(bob);
      await expectData(await change(body()));
    });

    it("wrong TOTP codes count toward the lock too", async () => {
      const alice = await seedUser({ totp: true });
      signInAsPasswordUser(alice);
      for (let i = 0; i < 5; i += 1) {
        await expectError(
          await change(body({ totp: "000000" })),
          403,
          "FORBIDDEN",
        );
      }
      await expectError(
        await change(body({ totp: totpAt(NOW) })),
        403,
        "FORBIDDEN",
      );
    });
  });

  describe("TOTP", () => {
    it("an enrolled user must send a valid code: none, wrong, or a malformed one is refused", async () => {
      const alice = await seedUser({ totp: true });
      signInAsPasswordUser(alice);
      const before = await credentialOf();
      for (const totp of [undefined, "000000", "12345", "abcdef"]) {
        await expectError(
          await change(body(totp === undefined ? {} : { totp })),
          403,
          "FORBIDDEN",
        );
      }
      expect((await credentialOf()).passwordHash).toBe(before.passwordHash);
    });

    it("a valid code from the +-1 step window changes the password", async () => {
      const alice = await seedUser({ totp: true });
      signInAsPasswordUser(alice);
      await expectData(
        await change(body({ totp: totpAt(new Date(NOW.getTime() - 30_000)) })),
      );
      expect(
        await authorizePasswordUser(
          {
            email: alice.email,
            password: NEW_PASSWORD,
            totp: totpAt(new Date(NOW.getTime() + 30_000)),
          },
          { now: () => NOW },
        ),
      ).not.toBeNull();
    });

    it("a code is accepted once: replaying it is refused with the generic error (T27)", async () => {
      const alice = await seedUser({ totp: true });
      signInAsPasswordUser(alice);
      const code = totpAt(NOW);
      await expectData(await change(body({ totp: code })));
      await expectError(
        await change(
          body({
            currentPassword: NEW_PASSWORD,
            newPassword: OTHER_PASSWORD,
            totp: code,
          }),
        ),
        403,
        "FORBIDDEN",
      );
      expect(
        await authorizePasswordUser(
          { email: alice.email, password: NEW_PASSWORD, totp: code },
          { now: () => NOW },
        ),
      ).toBeNull();
    });

    it("a user without TOTP changes the password with the current password alone", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      await expectData(await change(body()));
    });

    it("a user who now needs TOTP but has not enrolled is refused the generic error (no session before enrolment, D23)", async () => {
      const alice = await seedUser();
      ok(
        await grantRole(
          { oid: alice.oid, role: "internal-admin", reason: "r" },
          seedCtx(),
        ),
      );
      signInAsPasswordUser(alice, { roles: ["internal-admin"] });
      const before = await credentialOf();
      await expectError(await change(body()), 403, "FORBIDDEN");
      expect((await credentialOf()).passwordHash).toBe(before.passwordHash);
    });

    it("a refused weak password leaves the code usable for the retry", async () => {
      const alice = await seedUser({ totp: true });
      signInAsPasswordUser(alice);
      const code = totpAt(NOW);
      await expectError(
        await change(body({ newPassword: "short", totp: code })),
        400,
        "WEAK_PASSWORD",
      );
      await expectData(await change(body({ totp: code })));
    });

    it("the stored secret stays ciphertext and the change never returns it", async () => {
      const alice = await seedUser({ totp: true });
      signInAsPasswordUser(alice);
      const res = await change(body({ totp: totpAt(NOW) }));
      expect(await res.clone().text()).not.toContain(TOTP_SECRET);
      expect((await credentialOf()).totpCipher).not.toContain(TOTP_SECRET);
    });
  });

  describe("SSO_BOUND", () => {
    it("409 SSO_BOUND for a user bound to Entra, with the correct current password; nothing changes", async () => {
      const alice = await seedUser();
      await setRawStatus(EMAIL, "sso-bound");
      signInAsPasswordUser(alice);
      const before = await credentialOf();
      await expectError(await change(body()), 409, "SSO_BOUND");
      expect(await credentialOf()).toEqual(before);
      expect(await updateRecords()).toHaveLength(0);
    });
  });

  describe("success", () => {
    it("200 { data } with no-store; the new password signs in, the old one does not", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      const res = await change(body());
      const data = await expectData<Record<string, unknown>>(res.clone());
      expect(typeof data).toBe("object");
      expect(await res.text()).not.toMatch(SECRET_WORDS);
      expect(
        await authorizePasswordUser(
          { email: alice.email, password: NEW_PASSWORD },
          { now: () => NOW },
        ),
      ).toMatchObject({ oid: alice.oid, email: EMAIL });
      expect(
        await authorizePasswordUser(
          { email: alice.email, password: GOOD_PASSWORD },
          { now: () => NOW },
        ),
      ).toBeNull();
    });

    it("re-hashes with Argon2id (a fresh salt), keeps the TOTP enrolment, bumps the version by one and stores no plaintext", async () => {
      const alice = await seedUser({ totp: true });
      signInAsPasswordUser(alice);
      const before = await credentialOf();
      const versionBefore = (await getPasswordUser(EMAIL))!.version;
      await expectData(await change(body({ totp: totpAt(NOW) })));
      const after = await credentialOf();
      expect(after.passwordHash).toMatch(/^\$argon2id\$/);
      expect(after.passwordHash).not.toBe(before.passwordHash);
      expect(after.totpCipher).toBe(before.totpCipher);
      expect((await getPasswordUser(EMAIL))!.version).toBe(versionBefore + 1);
      const dump = JSON.stringify(await nonAuditItems());
      expect(dump).not.toContain(NEW_PASSWORD);
      expect(dump).not.toContain(GOOD_PASSWORD);
    });

    it("writes exactly one audit record: localuser.update, success, actor = the user, no secrets", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      const before = (await updateRecords()).length;
      await expectData(await change(body()));
      const records = await updateRecords();
      expect(records).toHaveLength(before + 1);
      const record = records.at(-1)!;
      expect(record).toMatchObject({
        action: "localuser.update",
        actor: alice.oid,
        result: "success",
        category: "change",
      });
      expect(JSON.stringify(record)).not.toMatch(SECRET_WORDS);
      expect(JSON.stringify(record)).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(record)).not.toContain(GOOD_PASSWORD);
    });

    it("leaves the current session alone: no cookie is set or cleared and the user is not signed out", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      const res = await change(body());
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("the same session can change the password again with the new one", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice);
      await expectData(await change(body()));
      await expectData(
        await change({
          currentPassword: NEW_PASSWORD,
          newPassword: OTHER_PASSWORD,
        }),
      );
    });

    it("does not touch another user's credential", async () => {
      const alice = await seedUser();
      await seedUser({ email: "bob@example.com" });
      const bobBefore = await credentialOf("bob@example.com");
      signInAsPasswordUser(alice);
      await expectData(await change(body()));
      expect(await credentialOf("bob@example.com")).toEqual(bobBefore);
    });

    it("works for an email in a different case in the session", async () => {
      const alice = await seedUser();
      signInAsPasswordUser(alice, { email: "ALICE@Example.com" });
      await expectData(await change(body()));
    });
  });

  describe("no-store on every status", () => {
    // 401, 403 and 400 carry it by the route-contract suite; the 409 and the
    // 200 are this route's own statuses.
    it("409 and 200 carry Cache-Control: private, no-store", async () => {
      const alice = await seedUser();
      const heads: (string | null)[] = [];
      signInAsPasswordUser(alice);
      heads.push(
        (await change(body({ currentPassword: OTHER_PASSWORD }))).headers.get(
          "cache-control",
        ),
      );
      heads.push((await change(body())).headers.get("cache-control"));
      for (const head of heads) expect(head).toBe("private, no-store");
    });
  });
});
