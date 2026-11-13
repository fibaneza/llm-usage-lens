import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GOOD_PASSWORD,
  TOTP_SECRET,
  fakeEnvelope,
  totpAt,
} from "@/lib/auth/password-test-support";
import {
  NOW,
  dumpTable,
  auditRecords,
  ctxAt,
  ok,
} from "@/lib/data/access/access-test-support";
import { grantAdminScope } from "@/lib/data/access/admin-scopes";
import {
  createPasswordUser,
  deletePasswordUser,
  getPasswordUser,
  issueSetupLink,
  setPasswordSignIn,
} from "@/lib/data/access/password-users";
import { grantRole } from "@/lib/data/access/role-grants";
import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/lib/data/access/access-test-support").then((m) =>
    m.faultyDynamodb(),
  ),
);
vi.mock("@/lib/auth/secret-envelope", () => fakeEnvelope);

import { completePasswordSetup } from "@/lib/auth/password-setup";
import { authorizePasswordUser } from "@/lib/auth/password-credentials";
import { isTotpRequired } from "@/lib/auth/totp-user";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (Setup
// D22, Passwords, TOTP D23), threat T24, T27.
// Assumed API: completePasswordSetup({ token, password, totp?: { secret, code } },
//   { now?: () => Date }) -> { ok: true; identity: { oid; tid: "local"; email; authMethod: "password" } }
//   | { ok: false; code: "INVALID_LINK" | "WEAK_PASSWORD" | "TOTP_REQUIRED" | "TOTP_INVALID" }
//   isTotpRequired(oid) -> boolean (any global role other than internal-viewer, or any admin scope).
// A failed attempt (weak password, TOTP) does not consume the token. Setup
// enrolment confirms the code at `now`, so that step is spent (replay, T27).
// Argon2id runs at the master user's parameters, hence the timeouts.
const ctx = ctxAt();
const deps = { now: () => NOW };
const EMAIL = "alice@example.com";

beforeAll(ensureTestTable);
beforeEach(clearTable);

const newUser = async () =>
  ok(await createPasswordUser({ email: EMAIL, displayName: "Alice" }, ctx));

describe("completePasswordSetup", { timeout: 30_000 }, () => {
  it("sets an Argon2id password, returns the identity and audits the setup", async () => {
    const { user, setupToken } = await newUser();
    const result = await completePasswordSetup(
      { token: setupToken, password: GOOD_PASSWORD },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      identity: {
        oid: user.oid,
        tid: "local",
        email: EMAIL,
        authMethod: "password",
      },
    });
    const dump = await dumpTable();
    expect(dump).toContain("$argon2id$");
    expect(dump).not.toContain(GOOD_PASSWORD);
    expect(
      (await auditRecords()).some(
        (r) => r.action === "localuser.update" && r.actor === user.oid,
      ),
    ).toBe(true);
    expect(
      await authorizePasswordUser(
        { email: EMAIL, password: GOOD_PASSWORD },
        deps,
      ),
    ).toMatchObject({ oid: user.oid });
  });

  it("is single use: the same token fails the second time", async () => {
    const { setupToken } = await newUser();
    expect(
      (
        await completePasswordSetup(
          { token: setupToken, password: GOOD_PASSWORD },
          deps,
        )
      ).ok,
    ).toBe(true);
    expect(
      await completePasswordSetup(
        { token: setupToken, password: "a different long passphrase" },
        deps,
      ),
    ).toEqual({ ok: false, code: "INVALID_LINK" });
  });

  it("gives one identical generic error for unknown, used and expired tokens", async () => {
    const { setupToken } = await newUser();
    const unknown = await completePasswordSetup(
      { token: "A".repeat(43), password: GOOD_PASSWORD },
      deps,
    );
    const expired = await completePasswordSetup(
      { token: setupToken, password: GOOD_PASSWORD },
      { now: () => new Date(NOW.getTime() + 72 * 3_600_000 + 1_000) },
    );
    const second = await newUser2();
    await completePasswordSetup(
      { token: second, password: GOOD_PASSWORD },
      deps,
    );
    const used = await completePasswordSetup(
      { token: second, password: GOOD_PASSWORD },
      deps,
    );
    expect(unknown).toEqual({ ok: false, code: "INVALID_LINK" });
    expect(expired).toEqual(unknown);
    expect(used).toEqual(unknown);
  });

  it("is refused while the password sign-in switch is off, without consuming the token (D24, T28)", async () => {
    const { setupToken } = await newUser();
    ok(await setPasswordSignIn({ enabled: false, entraConfigured: true }, ctx));
    expect(
      await completePasswordSetup(
        { token: setupToken, password: GOOD_PASSWORD },
        deps,
      ),
    ).toEqual({ ok: false, code: "INVALID_LINK" });
    ok(await setPasswordSignIn({ enabled: true, entraConfigured: true }, ctx));
    expect(
      (
        await completePasswordSetup(
          { token: setupToken, password: GOOD_PASSWORD },
          deps,
        )
      ).ok,
    ).toBe(true);
  });

  it("accepts the token just inside its 72 h window", async () => {
    const { setupToken } = await newUser();
    const result = await completePasswordSetup(
      { token: setupToken, password: GOOD_PASSWORD },
      { now: () => new Date(NOW.getTime() + 72 * 3_600_000 - 1_000) },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects common, too-short and too-long passwords without consuming the token", async () => {
    const { setupToken } = await newUser();
    for (const password of ["password1234", "short-11-ch", "x".repeat(129)]) {
      expect(
        await completePasswordSetup({ token: setupToken, password }, deps),
      ).toEqual({
        ok: false,
        code: "WEAK_PASSWORD",
      });
    }
    expect(
      (
        await completePasswordSetup(
          { token: setupToken, password: GOOD_PASSWORD },
          deps,
        )
      ).ok,
    ).toBe(true);
  });

  it("accepts a password at the 128-character limit", async () => {
    const { setupToken } = await newUser();
    const password = "Zq7-".repeat(32);
    expect(password).toHaveLength(128);
    expect(
      (await completePasswordSetup({ token: setupToken, password }, deps)).ok,
    ).toBe(true);
  });

  it("a reset invalidates the previous token (T24)", async () => {
    const first = await newUser();
    const reset = ok(await issueSetupLink(EMAIL, ctxAt(NOW, "req-2")));
    expect(
      await completePasswordSetup(
        { token: first.setupToken, password: GOOD_PASSWORD },
        deps,
      ),
    ).toEqual({ ok: false, code: "INVALID_LINK" });
    expect(
      (
        await completePasswordSetup(
          { token: reset.setupToken, password: GOOD_PASSWORD },
          deps,
        )
      ).ok,
    ).toBe(true);
  });

  it("a delete invalidates the token (T24)", async () => {
    const { setupToken } = await newUser();
    ok(await deletePasswordUser(EMAIL, ctx));
    expect(
      await completePasswordSetup(
        { token: setupToken, password: GOOD_PASSWORD },
        deps,
      ),
    ).toEqual({
      ok: false,
      code: "INVALID_LINK",
    });
    expect(await getPasswordUser(EMAIL)).toBeNull();
  });
});

describe("TOTP at setup (D23, T27)", { timeout: 30_000 }, () => {
  it("is not required without roles or scopes, nor for the default viewer (no grant needed)", async () => {
    const { user, setupToken } = await newUser();
    expect(await isTotpRequired(user.oid)).toBe(false);
    expect(await isTotpRequired(user.oid)).toBe(false);
    expect(
      (
        await completePasswordSetup(
          { token: setupToken, password: GOOD_PASSWORD },
          deps,
        )
      ).ok,
    ).toBe(true);
  });

  it.each(["internal-admin", "internal-org-admin"] as const)(
    "is required for a %s grant",
    async (role) => {
      const { user } = await newUser();
      ok(await grantRole({ oid: user.oid, role, reason: "r" }, ctx));
      expect(await isTotpRequired(user.oid)).toBe(true);
    },
  );

  it("is required for any admin scope", async () => {
    const { user } = await newUser();
    ok(
      await grantAdminScope(
        { oid: user.oid, scopeType: "team", scopeId: "t1" },
        ctx,
      ),
    );
    expect(await isTotpRequired(user.oid)).toBe(true);
  });

  it("refuses setup without enrolment, without consuming the token", async () => {
    const { user, setupToken } = await newUser();
    ok(
      await grantRole(
        { oid: user.oid, role: "internal-admin", reason: "r" },
        ctx,
      ),
    );
    expect(
      await completePasswordSetup(
        { token: setupToken, password: GOOD_PASSWORD },
        deps,
      ),
    ).toEqual({
      ok: false,
      code: "TOTP_REQUIRED",
    });
    expect(
      await completePasswordSetup(
        {
          token: setupToken,
          password: GOOD_PASSWORD,
          totp: { secret: TOTP_SECRET, code: "000000" },
        },
        deps,
      ),
    ).toEqual({ ok: false, code: "TOTP_INVALID" });
    const done = await completePasswordSetup(
      {
        token: setupToken,
        password: GOOD_PASSWORD,
        totp: { secret: TOTP_SECRET, code: totpAt(NOW) },
      },
      deps,
    );
    expect(done.ok).toBe(true);
  });

  it("stores the secret as ciphertext only, never the base32 value", async () => {
    const { user, setupToken } = await newUser();
    ok(
      await grantRole(
        { oid: user.oid, role: "internal-admin", reason: "r" },
        ctx,
      ),
    );
    await completePasswordSetup(
      {
        token: setupToken,
        password: GOOD_PASSWORD,
        totp: { secret: TOTP_SECRET, code: totpAt(NOW) },
      },
      deps,
    );
    const dump = await dumpTable();
    expect(dump).not.toContain(TOTP_SECRET);
    expect(dump).toContain("ct:");
    expect(JSON.stringify(await getPasswordUser(EMAIL))).not.toContain("ct:");
  });
});

async function newUser2(): Promise<string> {
  const { setupToken } = ok(
    await createPasswordUser(
      { email: "bob@example.com", displayName: "Bob" },
      ctx,
    ),
  );
  return setupToken;
}
