import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const verifySpy = vi.hoisted(() => vi.fn());
vi.mock("hash-wasm", async (orig) => {
  const actual = await orig<typeof import("hash-wasm")>();
  verifySpy.mockImplementation(actual.argon2Verify);
  return { ...actual, argon2Verify: verifySpy };
});
vi.mock("@/lib/dynamodb", () =>
  import("@/lib/data/access/access-test-support").then((m) =>
    m.faultyDynamodb(),
  ),
);
vi.mock("@/lib/auth/secret-envelope", () =>
  import("@/lib/auth/password-test-support").then((m) => m.fakeEnvelope),
);

import {
  GOOD_PASSWORD,
  OTHER_PASSWORD,
  TOTP_SECRET,
  totpAt,
} from "@/lib/auth/password-test-support";
import {
  NOW,
  dumpTable,
  ctxAt,
  ok,
} from "@/lib/data/access/access-test-support";
import {
  createPasswordUser,
  deletePasswordUser,
  disablePasswordUser,
  enablePasswordUser,
  setPasswordSignIn,
} from "@/lib/data/access/password-users";
import {
  changePasswordWrite,
  getPasswordCredential,
} from "@/lib/data/access/password-credentials-store";
import { grantRole } from "@/lib/data/access/role-grants";
import { clearTable, ensureTestTable } from "@/test/test-support";

import { authorizePasswordUser } from "@/lib/auth/password-credentials";
import { completePasswordSetup } from "@/lib/auth/password-setup";

// Source: docs/specs/2026-11-10-access-control.md — "Password users"
// (Sign-in, Passwords, TOTP, Alongside Entra D24), threats T7, T23, T27, T28.
// Assumed API: authorizePasswordUser(credentials: unknown,
//   deps?: { now?: () => Date }) -> { oid; tid: "local"; email; displayName?;
//   authMethod: "password" } | null. Every failure is the same generic null.
// Lockout: 5 failures -> 15 minutes, per user, persisted (not in memory).
const ctx = ctxAt();
const at = (ms = 0) => ({ now: () => new Date(NOW.getTime() + ms) });
const MIN = 60_000;
let seq = 0;

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  verifySpy.mockClear();
});

async function activeUser(opts: { admin?: boolean } = {}) {
  seq += 1;
  const email = `user${seq}@example.com`;
  const { user, setupToken } = ok(
    await createPasswordUser({ email, displayName: "Test User" }, ctx),
  );
  if (opts.admin) {
    ok(
      await grantRole(
        { oid: user.oid, role: "internal-admin", reason: "seed" },
        ctx,
      ),
    );
  }
  const done = await completePasswordSetup(
    {
      token: setupToken,
      password: GOOD_PASSWORD,
      ...(opts.admin
        ? { totp: { secret: TOTP_SECRET, code: totpAt(NOW) } }
        : {}),
    },
    at(),
  );
  expect(done.ok).toBe(true);
  return { user, email };
}

describe("authorizePasswordUser", { timeout: 60_000 }, () => {
  it("signs in with email (case-insensitive) and password", async () => {
    const { user, email } = await activeUser();
    expect(
      await authorizePasswordUser(
        { email: email.toUpperCase(), password: GOOD_PASSWORD },
        at(MIN),
      ),
    ).toMatchObject({
      oid: user.oid,
      tid: "local",
      email,
      authMethod: "password",
    });
  });

  // F7 (temp/run-r4b/decisions.md): the identity carries the stored
  // credentialVersion so the session can be matched against it per request.
  it("returns the stored credentialVersion, which an own password change raises (F7)", async () => {
    const { email } = await activeUser();
    const first = await authorizePasswordUser(
      { email, password: GOOD_PASSWORD },
      at(MIN),
    );
    expect(first?.credentialVersion).toBe(
      (await getPasswordCredential(email))?.credentialVersion,
    );
    ok(await changePasswordWrite({ email, passwordHash: "x" }, ctx));
    expect((await getPasswordCredential(email))?.credentialVersion).toBe(
      (first?.credentialVersion ?? 0) + 1,
    );
  });

  it("returns null for a wrong password, a malformed payload and an empty password", async () => {
    const { email } = await activeUser();
    expect(
      await authorizePasswordUser({ email, password: OTHER_PASSWORD }, at(MIN)),
    ).toBeNull();
    expect(await authorizePasswordUser({ email }, at(MIN))).toBeNull();
    expect(
      await authorizePasswordUser({ email, password: "" }, at(MIN)),
    ).toBeNull();
    expect(await authorizePasswordUser(null, at(MIN))).toBeNull();
  });

  it("runs the dummy-hash path for an unknown email and returns the same null (T23)", async () => {
    await activeUser();
    verifySpy.mockClear();
    const unknown = await authorizePasswordUser(
      { email: "ghost@example.com", password: GOOD_PASSWORD },
      at(MIN),
    );
    expect(unknown).toBeNull();
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it("verifies exactly once for a known user with a wrong password", async () => {
    const { email } = await activeUser();
    verifySpy.mockClear();
    await authorizePasswordUser({ email, password: OTHER_PASSWORD }, at(MIN));
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it("runs the same Argon2id verify for a locked user and returns the generic null (T23)", async () => {
    const { email } = await activeUser();
    for (let i = 0; i < 5; i += 1) {
      await authorizePasswordUser({ email, password: OTHER_PASSWORD }, at(MIN));
    }
    verifySpy.mockClear();
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD },
        at(2 * MIN),
      ),
    ).toBeNull();
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it("locks the user for 15 minutes after 5 failures, even for the right password", async () => {
    const { email } = await activeUser();
    for (let i = 0; i < 5; i += 1) {
      expect(
        await authorizePasswordUser(
          { email, password: OTHER_PASSWORD },
          at(MIN),
        ),
      ).toBeNull();
    }
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD },
        at(2 * MIN),
      ),
    ).toBeNull();
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD },
        at(MIN + 14 * MIN),
      ),
    ).toBeNull();
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD },
        at(MIN + 15 * MIN + 1_000),
      ),
    ).not.toBeNull();
  });

  it("does not lock another user, and a success resets the failure count", async () => {
    const a = await activeUser();
    const b = await activeUser();
    for (let i = 0; i < 5; i += 1) {
      await authorizePasswordUser(
        { email: a.email, password: OTHER_PASSWORD },
        at(MIN),
      );
    }
    expect(
      await authorizePasswordUser(
        { email: b.email, password: GOOD_PASSWORD },
        at(2 * MIN),
      ),
    ).not.toBeNull();
    for (let round = 0; round < 2; round += 1) {
      for (let i = 0; i < 4; i += 1) {
        await authorizePasswordUser(
          { email: b.email, password: OTHER_PASSWORD },
          at(3 * MIN),
        );
      }
      expect(
        await authorizePasswordUser(
          { email: b.email, password: GOOD_PASSWORD },
          at(3 * MIN),
        ),
      ).not.toBeNull();
    }
  });

  it("refuses a disabled user, then accepts again once re-enabled", async () => {
    const { email } = await activeUser();
    ok(await disablePasswordUser(email, ctx));
    expect(
      await authorizePasswordUser({ email, password: GOOD_PASSWORD }, at(MIN)),
    ).toBeNull();
    ok(await enablePasswordUser(email, ctx));
    expect(
      await authorizePasswordUser({ email, password: GOOD_PASSWORD }, at(MIN)),
    ).not.toBeNull();
  });

  it("refuses a deleted user", async () => {
    const { email } = await activeUser();
    ok(await deletePasswordUser(email, ctx));
    expect(
      await authorizePasswordUser({ email, password: GOOD_PASSWORD }, at(MIN)),
    ).toBeNull();
  });

  it("refuses a user who has not completed setup (no password yet)", async () => {
    ok(
      await createPasswordUser(
        { email: "fresh@example.com", displayName: "Fresh" },
        ctx,
      ),
    );
    expect(
      await authorizePasswordUser(
        { email: "fresh@example.com", password: GOOD_PASSWORD },
        at(MIN),
      ),
    ).toBeNull();
  });
});

describe("password sign-in switch (D24, T28)", { timeout: 60_000 }, () => {
  it("refuses every password user while the switch is off and accepts again when on", async () => {
    const a = await activeUser();
    const b = await activeUser();
    ok(await setPasswordSignIn({ enabled: false, entraConfigured: true }, ctx));
    expect(
      await authorizePasswordUser(
        { email: a.email, password: GOOD_PASSWORD },
        at(MIN),
      ),
    ).toBeNull();
    expect(
      await authorizePasswordUser(
        { email: b.email, password: GOOD_PASSWORD },
        at(MIN),
      ),
    ).toBeNull();
    ok(await setPasswordSignIn({ enabled: true, entraConfigured: true }, ctx));
    expect(
      await authorizePasswordUser(
        { email: a.email, password: GOOD_PASSWORD },
        at(MIN),
      ),
    ).not.toBeNull();
  });
});

describe("TOTP at sign-in (D23, T27)", { timeout: 60_000 }, () => {
  it("requires a valid code when enrolled", async () => {
    const { user, email } = await activeUser({ admin: true });
    const t = at(2 * MIN);
    expect(
      await authorizePasswordUser({ email, password: GOOD_PASSWORD }, t),
    ).toBeNull();
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD, totp: "000000" },
        t,
      ),
    ).toBeNull();
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD, totp: totpAt(t.now()) },
        t,
      ),
    ).toMatchObject({ oid: user.oid });
  });

  it("refuses a replayed code (last used step is stored)", async () => {
    const { email } = await activeUser({ admin: true });
    const t = at(5 * MIN);
    const code = totpAt(t.now());
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD, totp: code },
        t,
      ),
    ).not.toBeNull();
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD, totp: code },
        t,
      ),
    ).toBeNull();
    const next = at(5 * MIN + 60_000);
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD, totp: totpAt(next.now()) },
        next,
      ),
    ).not.toBeNull();
  });

  it("refuses the code consumed at setup enrolment", async () => {
    const { email } = await activeUser({ admin: true });
    expect(
      await authorizePasswordUser(
        { email, password: GOOD_PASSWORD, totp: totpAt(NOW) },
        at(),
      ),
    ).toBeNull();
  });

  it("refuses a user who now needs TOTP but has not enrolled (no session before enrolment)", async () => {
    const { user, email } = await activeUser();
    ok(
      await grantRole(
        { oid: user.oid, role: "internal-admin", reason: "promoted" },
        ctx,
      ),
    );
    expect(
      await authorizePasswordUser({ email, password: GOOD_PASSWORD }, at(MIN)),
    ).toBeNull();
  });

  it("keeps the secret as ciphertext at rest", async () => {
    await activeUser({ admin: true });
    expect(await dumpTable()).not.toContain(TOTP_SECRET);
  });
});
