import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  CURSOR_SECRET,
  NOW,
  auditRecords,
  collectPages,
  ctxAt,
  dumpTable,
  ok,
} from "./access-test-support";
import {
  completePasswordSetupWrite,
  getPasswordCredential,
  resetPasswordUserTotp,
} from "./password-credentials-store";
import {
  createPasswordUser,
  disablePasswordUser,
  getPasswordUser,
  listPasswordUsers,
  sha256Hex,
  userKey,
} from "./password-users";

// Source: docs/specs/2026-11-10-access-control.md - "Password users"
// (Accounts, Setup D22, Passwords: a hash is never returned; TOTP D23: the
// secret is never returned, a reset forces re-enrolment at the next sign-in),
// "API routes (additions)" (/api/password-users GET, .../totp-reset POST),
// "Enforcement" item 4 (auth data is read uncached), "Audit log" (every write
// one record; a failure writes none), threat T24. Contract:
// temp/run-r4/contract-slice2.md.
// Assumed API (tdd-test-engineer, slice 2; both are server-only, uncached):
//   listPasswordUsers({ cursorSecret, cursor?, limit? })
//     -> AccessResult<Page<PasswordUserListItem>>  (BAD_CURSOR for a bad cursor)
//     PasswordUserListItem = { email, displayName, status, totpEnrolled,
//       createdAt, version }, ordered by email; status is
//       "enabled" | "disabled" | "pending-setup" | "sso-bound" where
//       "pending-setup" = enabled with no password set yet. Never a hash,
//       TOTP secret, token or token hash. Lives in ./password-users.
//   resetPasswordUserTotp(email, ctx) -> AccessResult<void>
//     Lives in ./password-credentials-store (the only module that touches the
//     TOTP ciphertext). Removes totpCipher and totpLastStep, keeps the password
//     hash, bumps version by 1, writes one localuser.update record (no
//     secret in it). NOT_FOUND when absent; CONFLICT for an sso-bound user;
//     succeeds (and is audited) when nothing was enrolled. Email is
//     case-insensitive.
const ctx = ctxAt();
const PASSWORD_HASH = "$argon2id$v=19$SENTINEL-PASSWORD-HASH";
const TOTP_CIPHER = "SENTINEL-TOTP-CIPHER";
const FORBIDDEN_WORDS =
  /argon2|SENTINEL|passwordHash|totpCipher|totpSecret|tokenHash|setupTokenHash/i;

beforeAll(ensureTestTable);
beforeEach(clearTable);

let n = 0;
const next = () => ctxAt(NOW, `req-${++n}`);

const create = (email: string, name = "Test User") =>
  createPasswordUser({ email, displayName: name }, next());

async function complete(email: string, token: string, withTotp = true) {
  ok(
    await completePasswordSetupWrite(
      {
        email,
        tokenHash: sha256Hex(token),
        passwordHash: PASSWORD_HASH,
        ...(withTotp ? { totp: { cipher: TOTP_CIPHER, step: 7 } } : {}),
      },
      next(),
    ),
  );
}

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

const list = (options: { cursor?: string; limit?: number } = {}) =>
  listPasswordUsers({ cursorSecret: CURSOR_SECRET, ...options });

describe("listPasswordUsers", () => {
  it("returns an empty page when there are no users", async () => {
    expect(await list()).toEqual({ ok: true, value: { items: [] } });
  });

  it("lists a new user with the contract fields only", async () => {
    ok(await create("alice@example.com", "Alice"));
    expect(ok(await list()).items).toEqual([
      {
        email: "alice@example.com",
        displayName: "Alice",
        status: "pending-setup",
        totpEnrolled: false,
        createdAt: NOW.toISOString(),
        version: 1,
      },
    ]);
  });

  it("derives status: pending-setup, enabled, disabled, sso-bound", async () => {
    ok(await create("pending@example.com"));
    const active = ok(await create("active@example.com"));
    await complete("active@example.com", active.setupToken, false);
    const off = ok(await create("off@example.com"));
    await complete("off@example.com", off.setupToken, false);
    ok(await disablePasswordUser("off@example.com", next()));
    ok(await create("bound@example.com"));
    await setRawStatus("bound@example.com", "sso-bound");
    const by = Object.fromEntries(
      ok(await list()).items.map((r) => [r.email, r.status]),
    );
    expect(by).toEqual({
      "pending@example.com": "pending-setup",
      "active@example.com": "enabled",
      "off@example.com": "disabled",
      "bound@example.com": "sso-bound",
    });
  });

  it("a disabled user who never finished setup is still disabled, not pending", async () => {
    ok(await create("a@example.com"));
    ok(await disablePasswordUser("a@example.com", next()));
    expect(ok(await list()).items[0]?.status).toBe("disabled");
  });

  it("reports TOTP enrolment from the stored secret, without exposing it", async () => {
    const a = ok(await create("with@example.com"));
    await complete("with@example.com", a.setupToken, true);
    const b = ok(await create("without@example.com"));
    await complete("without@example.com", b.setupToken, false);
    const by = Object.fromEntries(
      ok(await list()).items.map((r) => [r.email, r.totpEnrolled]),
    );
    expect(by).toEqual({
      "with@example.com": true,
      "without@example.com": false,
    });
  });

  it("never exposes a hash, TOTP secret, token or token hash", async () => {
    const a = ok(await create("a@example.com"));
    await complete("a@example.com", a.setupToken);
    const b = ok(await create("b@example.com"));
    const json = JSON.stringify(ok(await list()));
    expect(json).not.toMatch(FORBIDDEN_WORDS);
    for (const token of [a.setupToken, b.setupToken]) {
      expect(json).not.toContain(token);
      expect(json).not.toContain(sha256Hex(token));
    }
  });

  it("lists only users: reservations, setup links and usage keys are not rows", async () => {
    ok(
      await createPasswordUser(
        {
          email: "a@example.com",
          displayName: "A",
          sso: { expectedUpn: "a@corp.example.com", expectedOid: "oid-a" },
        },
        next(),
      ),
    );
    expect(ok(await list()).items.map((r) => r.email)).toEqual([
      "a@example.com",
    ]);
  });

  it("orders by email and follows the opaque cursor to the end", async () => {
    for (const email of ["c@example.com", "a@example.com", "b@example.com"]) {
      ok(await create(email));
    }
    const { items, pages } = await collectPages((cursor) =>
      list({ limit: 2, ...(cursor ? { cursor } : {}) }),
    );
    expect(pages).toBe(2);
    expect(items.map((r) => r.email)).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("returns BAD_CURSOR for a tampered cursor", async () => {
    ok(await create("a@example.com"));
    expect(await list({ cursor: "not-a-real-cursor" })).toEqual({
      ok: false,
      code: "BAD_CURSOR",
    });
  });

  it("is read live: a user disabled after a first call shows as disabled in the next", async () => {
    const a = ok(await create("a@example.com"));
    await complete("a@example.com", a.setupToken, false);
    expect(ok(await list()).items[0]?.status).toBe("enabled");
    ok(await disablePasswordUser("a@example.com", next()));
    expect(ok(await list()).items[0]).toMatchObject({
      status: "disabled",
      version: 3,
    });
  });
});

describe("resetPasswordUserTotp", () => {
  it("clears the enrolment, keeps the password hash and bumps the version", async () => {
    const a = ok(await create("alice@example.com"));
    await complete("alice@example.com", a.setupToken);
    const before = await getPasswordCredential("alice@example.com");
    expect(before).toMatchObject({
      totpCipher: TOTP_CIPHER,
      totpLastStep: 7,
      passwordHash: PASSWORD_HASH,
    });
    const versionBefore = (await getPasswordUser("alice@example.com"))!.version;
    expect(await resetPasswordUserTotp("alice@example.com", next())).toEqual({
      ok: true,
      value: undefined,
    });
    const after = await getPasswordCredential("alice@example.com");
    expect(after?.totpCipher).toBeUndefined();
    expect(after?.totpLastStep).toBeUndefined();
    expect(after?.passwordHash).toBe(PASSWORD_HASH);
    expect((await getPasswordUser("alice@example.com"))?.version).toBe(
      versionBefore + 1,
    );
    expect(await dumpTable()).not.toContain(TOTP_CIPHER);
    expect(ok(await list()).items[0]?.totpEnrolled).toBe(false);
  });

  it("is case-insensitive on the email", async () => {
    const a = ok(await create("alice@example.com"));
    await complete("alice@example.com", a.setupToken);
    ok(await resetPasswordUserTotp("ALICE@Example.com", next()));
    expect(
      (await getPasswordCredential("alice@example.com"))?.totpCipher,
    ).toBeUndefined();
  });

  it("writes exactly one localuser.update success record that carries no secret", async () => {
    const a = ok(await create("alice@example.com"));
    await complete("alice@example.com", a.setupToken);
    const audit0 = (await auditRecords()).length;
    ok(await resetPasswordUserTotp("alice@example.com", next()));
    const records = await auditRecords();
    expect(records).toHaveLength(audit0 + 1);
    const last = records[records.length - 1]!;
    expect(last).toMatchObject({
      action: "localuser.update",
      category: "change",
      result: "success",
      target: { type: "identity" },
    });
    expect(JSON.stringify(last)).not.toMatch(FORBIDDEN_WORDS);
  });

  it("succeeds and is audited when nothing was enrolled", async () => {
    ok(await create("alice@example.com"));
    const audit0 = (await auditRecords()).length;
    ok(await resetPasswordUserTotp("alice@example.com", next()));
    expect((await auditRecords()).length).toBe(audit0 + 1);
  });

  it("returns NOT_FOUND for an unknown email and writes nothing", async () => {
    expect(await resetPasswordUserTotp("nobody@example.com", ctx)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await auditRecords()).toEqual([]);
  });

  it("returns CONFLICT for an sso-bound user and leaves the enrolment", async () => {
    const a = ok(await create("alice@example.com"));
    await complete("alice@example.com", a.setupToken);
    await setRawStatus("alice@example.com", "sso-bound");
    const audit0 = (await auditRecords()).length;
    expect(await resetPasswordUserTotp("alice@example.com", next())).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect((await getPasswordCredential("alice@example.com"))?.totpCipher).toBe(
      TOTP_CIPHER,
    );
    expect((await auditRecords()).length).toBe(audit0);
  });
});
