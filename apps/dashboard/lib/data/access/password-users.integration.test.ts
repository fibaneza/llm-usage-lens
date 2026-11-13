import { createHash } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);

import { NOW, dumpTable, auditRecords, ctxAt, ok } from "./access-test-support";
import { putIdentityLink } from "./identity-links";
import {
  createPasswordUser,
  deletePasswordUser,
  disablePasswordUser,
  enablePasswordUser,
  getPasswordSignIn,
  getPasswordUser,
  issueSetupLink,
  setPasswordSignIn,
} from "./password-users";

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
