import { createHash } from "node:crypto";

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  NOW,
  dumpTable,
  auditRecords,
  ctxAt,
  ok,
} from "@/test/support/access-test-support";
import { putIdentityLink } from "./identity-links";
import {
  changePasswordWrite,
  completePasswordSetupWrite,
  getPasswordCredential,
  resetPasswordUserTotp,
} from "./password-credentials-store";
import {
  createPasswordUser,
  deletePasswordUser,
  disablePasswordUser,
  enablePasswordUser,
  getPasswordSignIn,
  getPasswordUser,
  issueSetupLink,
  setPasswordSignIn,
  sha256Hex,
  userKey,
} from "./password-users";
import type { AccessResult } from "./result";

// Source: docs/specs/2026-11-10-access-control.md — "Password users"
// (Accounts, Identity, Setup D22, Alongside Entra D24), "SSO reference and
// binding" (reservations), "Data model additions", threats T24, T26.
// Assumed API (R2b-2 contract, tdd-test-engineer):
//   createPasswordUser({ email, displayName, sso?: { expectedUpn?, expectedOid? } }, ctx)
//     -> AccessResult<{ user: PasswordUser; setupToken: string }>
//   PasswordUser = { email, oid: "local:<uuid>", tid: "local", displayName,
//     status: "enabled" | "disabled" | "sso-bound", version,
//     sso: { expectedUpn, expectedOid?, tid?, oid?, boundAt? },
//     setup?: { expiresAt }, ssoConflict?: boolean }   (never a hash or secret)
//   getPasswordUser(email) -> PasswordUser | null
//   disablePasswordUser(email, ctx) / enablePasswordUser(email, ctx) / deletePasswordUser(email, ctx)
//     -> AccessResult<void>; NOT_FOUND when absent
//   issueSetupLink(email, ctx) -> AccessResult<{ setupToken: string }>
//   getPasswordSignIn() -> { enabled: boolean; version: number }   (default on)
//   setPasswordSignIn({ enabled, entraConfigured }, ctx) -> AccessResult<{ enabled; version }>
// Audit actions reuse localuser.create / localuser.update / localuser.delete.
const ctx = ctxAt();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

beforeAll(ensureTestTable);
beforeEach(clearTable);

const create = (
  email: string,
  sso?: { expectedUpn?: string; expectedOid?: string },
) =>
  createPasswordUser(
    { email, displayName: "Test User", ...(sso ? { sso } : {}) },
    ctx,
  );

describe("createPasswordUser", () => {
  it("lower-cases the email, assigns a local:<uuid> identity and returns a 32-byte setup token once", async () => {
    const { user, setupToken } = ok(await create("Alice@Example.COM"));
    expect(user).toMatchObject({
      email: "alice@example.com",
      tid: "local",
      status: "enabled",
      displayName: "Test User",
      sso: { expectedUpn: "alice@example.com" },
    });
    expect(user.oid).toMatch(/^local:[0-9a-f-]{36}$/);
    expect(setupToken).toMatch(TOKEN);
    expect(await getPasswordUser("ALICE@example.com")).toEqual(user);
  });

  it("writes exactly one localuser.create audit record that carries no token", async () => {
    const { user, setupToken } = ok(await create("alice@example.com"));
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "localuser.create",
      category: "change",
      result: "success",
      target: { type: "identity", id: user.oid },
    });
    expect(JSON.stringify(records)).not.toContain(setupToken);
  });

  it("stores only the SHA-256 of the token with a 72 h expiry (T24)", async () => {
    const { user, setupToken } = ok(await create("alice@example.com"));
    const dump = await dumpTable();
    const hash = createHash("sha256").update(setupToken).digest();
    expect(dump).not.toContain(setupToken);
    expect(
      dump.includes(hash.toString("hex")) ||
        dump.includes(hash.toString("base64url")) ||
        dump.includes(hash.toString("base64")),
    ).toBe(true);
    expect(user.setup?.expiresAt).toBe("2026-11-17T10:00:00.000Z");
    expect(NOW.toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });

  it("returns CONFLICT for an email that is already a password user", async () => {
    ok(await create("alice@example.com"));
    const second = await create("ALICE@example.com");
    expect(second).toEqual({ ok: false, code: "CONFLICT" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("returns CONFLICT when the email is another identity's usage identity or alias", async () => {
    ok(
      await putIdentityLink(
        {
          oid: "00000000-0000-4000-8000-000000000001",
          usageIdentities: ["taken@example.com"],
          aliases: ["alias@example.com"],
          version: null,
        },
        ctx,
      ),
    );
    expect(await create("taken@example.com")).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await create("alias@example.com")).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await getPasswordUser("taken@example.com")).toBeNull();
  });

  it("never exposes a hash, secret or token through the read model", async () => {
    ok(await create("alice@example.com"));
    const json = JSON.stringify(await getPasswordUser("alice@example.com"));
    expect(json).not.toMatch(/argon2|passwordHash|tokenHash|totpSecret/i);
  });
});

describe("SSO reservations (D25, T26)", () => {
  it("reserves expectedOid and expectedUpn so a duplicate is a CONFLICT and creates nothing", async () => {
    ok(
      await create("a@example.com", {
        expectedUpn: "Shared@Example.com",
        expectedOid: "oid-aaa",
      }),
    );
    expect(
      await create("b@example.com", { expectedUpn: "shared@example.com" }),
    ).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await create("c@example.com", { expectedOid: "oid-aaa" })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await getPasswordUser("b@example.com")).toBeNull();
    expect(await getPasswordUser("c@example.com")).toBeNull();
  });

  it("treats another user's default expectedUpn (their email) as reserved", async () => {
    ok(await create("a@example.com"));
    expect(
      await create("b@example.com", { expectedUpn: "a@example.com" }),
    ).toEqual({
      ok: false,
      code: "CONFLICT",
    });
  });
});

describe("disable, enable, delete", () => {
  it("disables and re-enables with one localuser.update record each", async () => {
    ok(await create("alice@example.com"));
    ok(await disablePasswordUser("alice@example.com", ctx));
    expect((await getPasswordUser("alice@example.com"))?.status).toBe(
      "disabled",
    );
    ok(await enablePasswordUser("alice@example.com", ctx));
    expect((await getPasswordUser("alice@example.com"))?.status).toBe(
      "enabled",
    );
    const updates = (await auditRecords()).filter(
      (r) => r.action === "localuser.update",
    );
    expect(updates).toHaveLength(2);
  });

  it("returns NOT_FOUND for an unknown email", async () => {
    expect(await disablePasswordUser("nobody@example.com", ctx)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await enablePasswordUser("nobody@example.com", ctx)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await deletePasswordUser("nobody@example.com", ctx)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("deletes the user, releases its reservations and audits localuser.delete", async () => {
    ok(
      await create("a@example.com", {
        expectedUpn: "upn@example.com",
        expectedOid: "oid-aaa",
      }),
    );
    ok(await deletePasswordUser("a@example.com", ctx));
    expect(await getPasswordUser("a@example.com")).toBeNull();
    expect(
      (await auditRecords()).some((r) => r.action === "localuser.delete"),
    ).toBe(true);
    ok(
      await create("b@example.com", {
        expectedUpn: "upn@example.com",
        expectedOid: "oid-aaa",
      }),
    );
  });
});

describe("issueSetupLink (reset)", () => {
  it("returns a fresh 32-byte token, stores only its hash and a new 72 h expiry", async () => {
    const first = ok(await create("alice@example.com"));
    const later = ctxAt(new Date("2026-11-15T10:00:00.000Z"), "req-2");
    const { setupToken } = ok(await issueSetupLink("alice@example.com", later));
    expect(setupToken).toMatch(TOKEN);
    expect(setupToken).not.toBe(first.setupToken);
    expect((await getPasswordUser("alice@example.com"))?.setup?.expiresAt).toBe(
      "2026-11-18T10:00:00.000Z",
    );
    const dump = await dumpTable();
    expect(dump).not.toContain(setupToken);
    expect(dump).not.toContain(first.setupToken);
    expect(
      (await auditRecords("2026-11-15")).some(
        (r) => r.action === "localuser.update",
      ),
    ).toBe(true);
  });

  it("returns NOT_FOUND for an unknown email", async () => {
    expect(await issueSetupLink("nobody@example.com", ctx)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe("password sign-in switch (D24, T28)", () => {
  it("is on by default", async () => {
    expect(await getPasswordSignIn()).toMatchObject({ enabled: true });
  });

  it("cannot be turned off while Entra is not configured", async () => {
    expect(
      await setPasswordSignIn({ enabled: false, entraConfigured: false }, ctx),
    ).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect((await getPasswordSignIn()).enabled).toBe(true);
    expect(await auditRecords()).toHaveLength(0);
  });

  it("turns off and on again when Entra is configured, one audit record per change, versioned", async () => {
    const off = ok(
      await setPasswordSignIn({ enabled: false, entraConfigured: true }, ctx),
    );
    expect(off.enabled).toBe(false);
    const on = ok(
      await setPasswordSignIn({ enabled: true, entraConfigured: true }, ctx),
    );
    expect(on.version).toBeGreaterThan(off.version);
    const records = await auditRecords();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      category: "change",
      result: "success",
      target: { id: "PASSWORD_SIGNIN" },
    });
  });
});

// D29 (Access Control spec - "Password users",
// Credential version): `credentialVersion` on the LOCALUSER item reads 0 while
// absent, and each of these raises it by exactly 1 so older sessions stop
// matching: completing setup, an own password change, an admin reset link and
// an admin TOTP reset (usually a lost or compromised device) and a disable; a
// delete removes the user. A re-enable does not raise it. Read uncached through
// getPasswordCredential (Rule 60.10). Each write is still one audit record.
describe("credentialVersion (F7)", () => {
  const EMAIL = "alice@example.com";
  const HASH = "$argon2id$v=19$SENTINEL-HASH";
  const version = async () =>
    (await getPasswordCredential(EMAIL))?.credentialVersion;

  async function activeUser() {
    const { setupToken } = ok(await create(EMAIL));
    ok(
      await completePasswordSetupWrite(
        {
          email: EMAIL,
          tokenHash: sha256Hex(setupToken),
          passwordHash: HASH,
        },
        ctxAt(NOW, "req-setup"),
      ),
    );
  }
  const dropAttribute = (names: string) =>
    testDoc().send(
      new UpdateCommand({
        TableName: TEST_TABLE_NAME,
        Key: userKey(EMAIL),
        UpdateExpression: `REMOVE ${names}`,
      }),
    );
  const updates = async () =>
    (await auditRecords()).filter((r) => r.action === "localuser.update");

  it("reads 0 for a user who has not completed setup (the attribute is absent)", async () => {
    ok(await create(EMAIL));
    expect(await version()).toBe(0);
  });

  it("completing setup raises it by 1", async () => {
    await activeUser();
    expect(await version()).toBe(1);
  });

  it("an item stored without the attribute reads 0, and the first change makes it 1", async () => {
    await activeUser();
    await dropAttribute("credentialVersion");
    expect(await version()).toBe(0);
    ok(await changePasswordWrite({ email: EMAIL, passwordHash: HASH }, ctx));
    expect(await version()).toBe(1);
  });

  const CHANGES: [string, () => Promise<unknown>][] = [
    [
      "an own password change",
      () => changePasswordWrite({ email: EMAIL, passwordHash: HASH }, ctx),
    ],
    ["an admin reset link", () => issueSetupLink(EMAIL, ctx)],
    ["an admin TOTP reset", () => resetPasswordUserTotp(EMAIL, ctx)],
    ["a disable", () => disablePasswordUser(EMAIL, ctx)],
  ];

  it.each(CHANGES)(
    "%s raises it by exactly 1 and writes one audit record",
    async (_n, change) => {
      await activeUser();
      const before = await version();
      const auditBefore = (await updates()).length;
      ok((await change()) as AccessResult<unknown>);
      expect(await version()).toBe((before ?? 0) + 1);
      expect((await updates()).length - auditBefore).toBe(1);
    },
  );

  it("raises it again on each further change", async () => {
    await activeUser();
    ok(await changePasswordWrite({ email: EMAIL, passwordHash: HASH }, ctx));
    ok(await issueSetupLink(EMAIL, ctx));
    ok(await resetPasswordUserTotp(EMAIL, ctx));
    ok(await disablePasswordUser(EMAIL, ctx));
    expect(await version()).toBe(5);
  });

  it("re-enabling does not raise it", async () => {
    await activeUser();
    ok(await disablePasswordUser(EMAIL, ctx));
    const afterDisable = await version();
    ok(await enablePasswordUser(EMAIL, ctx));
    expect(await version()).toBe(afterDisable);
  });

  it("a delete removes the credential, so an old session has nothing to match", async () => {
    await activeUser();
    ok(await deletePasswordUser(EMAIL, ctx));
    expect(await getPasswordCredential(EMAIL)).toBeNull();
  });

  it("a refused own change (user disabled meanwhile) leaves the version alone", async () => {
    await activeUser();
    ok(await disablePasswordUser(EMAIL, ctx));
    const before = await version();
    const refused = await changePasswordWrite(
      { email: EMAIL, passwordHash: HASH },
      ctx,
    );
    expect(refused.ok).toBe(false);
    expect(await version()).toBe(before);
  });

  describe("self-change marker (re-keys the changing session only)", () => {
    const marker = async () =>
      (await getPasswordCredential(EMAIL))?.selfChangeSignedInAt;

    it("an own change stores the session's signedInAt", async () => {
      await activeUser();
      ok(
        await changePasswordWrite(
          { email: EMAIL, passwordHash: HASH, signedInAt: 1_793_000_000 },
          ctx,
        ),
      );
      expect(await marker()).toBe(1_793_000_000);
    });

    it("an own change without a signedInAt stores no marker", async () => {
      await activeUser();
      ok(await changePasswordWrite({ email: EMAIL, passwordHash: HASH }, ctx));
      expect(await marker()).toBeUndefined();
    });

    it.each([
      ["an admin reset link", () => issueSetupLink(EMAIL, ctx)],
      ["an admin TOTP reset", () => resetPasswordUserTotp(EMAIL, ctx)],
      ["a disable", () => disablePasswordUser(EMAIL, ctx)],
    ])("%s clears it", async (_n, change) => {
      await activeUser();
      ok(
        await changePasswordWrite(
          { email: EMAIL, passwordHash: HASH, signedInAt: 1_793_000_000 },
          ctx,
        ),
      );
      ok((await change()) as AccessResult<unknown>);
      expect(await marker()).toBeUndefined();
    });

    it("a later own change by another session replaces it", async () => {
      await activeUser();
      ok(
        await changePasswordWrite(
          { email: EMAIL, passwordHash: HASH, signedInAt: 1_793_000_000 },
          ctx,
        ),
      );
      ok(
        await changePasswordWrite(
          { email: EMAIL, passwordHash: HASH, signedInAt: 1_793_000_500 },
          ctx,
        ),
      );
      expect(await marker()).toBe(1_793_000_500);
    });
  });
});
