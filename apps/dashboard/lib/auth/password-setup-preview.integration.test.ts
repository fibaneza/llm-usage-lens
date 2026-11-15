import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GOOD_PASSWORD, fakeEnvelope } from "@/lib/auth/password-test-support";
import {
  NOW,
  ctxAt,
  dumpTable,
  ok,
} from "@/lib/data/access/access-test-support";
import { grantAdminScope } from "@/lib/data/access/admin-scopes";
import {
  createPasswordUser,
  deletePasswordUser,
  disablePasswordUser,
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

import {
  completePasswordSetup,
  previewPasswordSetup,
} from "@/lib/auth/password-setup";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (Setup
// D22: the setup page takes the token from the URL fragment, so it can only
// reach the server through a Server Action or the provider, never a new
// unauthenticated Route Handler; an unknown, used or expired token gives one
// generic error; TOTP D23 decides whether enrolment is mandatory), threats T24
// and T25 ("the email is shown at setup" so the person can spot a mistyped
// address before choosing a password).
// Assumed API (lib/auth/password-setup.ts):
//   previewPasswordSetup(token, { now?: () => Date })
//     -> { email, displayName, totpRequired } | null
// It reads only; it never consumes the token, never counts as an attempt and
// returns null (one generic answer) exactly where completePasswordSetup answers
// INVALID_LINK. Its result carries no oid, hash, token or expiry.
const ctx = ctxAt();
const deps = { now: () => NOW };
const EMAIL = "alice@example.com";

beforeAll(ensureTestTable);
beforeEach(clearTable);

const newUser = async () =>
  ok(await createPasswordUser({ email: EMAIL, displayName: "Alice" }, ctx));

describe("previewPasswordSetup", { timeout: 30_000 }, () => {
  it("returns the email, display name and TOTP requirement for a live token", async () => {
    const { setupToken } = await newUser();
    expect(await previewPasswordSetup(setupToken, deps)).toEqual({
      email: EMAIL,
      displayName: "Alice",
      totpRequired: false,
    });
  });

  it("does not consume the token: setup still succeeds afterwards, and only once", async () => {
    const { setupToken } = await newUser();
    await previewPasswordSetup(setupToken, deps);
    await previewPasswordSetup(setupToken, deps);
    expect(
      (
        await completePasswordSetup(
          { token: setupToken, password: GOOD_PASSWORD },
          deps,
        )
      ).ok,
    ).toBe(true);
    expect(await previewPasswordSetup(setupToken, deps)).toBeNull();
  });

  it("writes nothing", async () => {
    const { setupToken } = await newUser();
    const before = await dumpTable();
    await previewPasswordSetup(setupToken, deps);
    expect(await dumpTable()).toBe(before);
  });

  it("returns no oid, hash, token or expiry", async () => {
    const { user, setupToken } = await newUser();
    const text = JSON.stringify(await previewPasswordSetup(setupToken, deps));
    expect(text).not.toContain(user.oid);
    expect(text).not.toContain(setupToken);
    expect(text).not.toMatch(/hash|expires|oid|version/i);
  });

  it("is true for TOTP when the user holds a role above internal-viewer", async () => {
    const { user, setupToken } = await newUser();
    ok(
      await grantRole(
        { oid: user.oid, role: "internal-admin", reason: "r" },
        ctx,
      ),
    );
    expect(await previewPasswordSetup(setupToken, deps)).toMatchObject({
      totpRequired: true,
    });
  });

  it("is true for TOTP when the user holds any admin scope", async () => {
    const { user, setupToken } = await newUser();
    ok(
      await grantAdminScope(
        { oid: user.oid, scopeType: "team", scopeId: "t1" },
        ctx,
      ),
    );
    expect(await previewPasswordSetup(setupToken, deps)).toMatchObject({
      totpRequired: true,
    });
  });

  it("answers null for unknown, malformed, expired and used tokens, identically", async () => {
    const { setupToken } = await newUser();
    const answers = [
      await previewPasswordSetup("A".repeat(43), deps),
      await previewPasswordSetup("", deps),
      await previewPasswordSetup("not-a-token", deps),
      await previewPasswordSetup(setupToken.slice(0, 42), deps),
      await previewPasswordSetup(`${setupToken}A`, deps),
      await previewPasswordSetup(setupToken, {
        now: () => new Date(NOW.getTime() + 72 * 3_600_000 + 1_000),
      }),
    ];
    for (const answer of answers) expect(answer).toBeNull();
    await completePasswordSetup(
      { token: setupToken, password: GOOD_PASSWORD },
      deps,
    );
    expect(await previewPasswordSetup(setupToken, deps)).toBeNull();
  });

  it("accepts the token just inside its 72 h window", async () => {
    const { setupToken } = await newUser();
    expect(
      await previewPasswordSetup(setupToken, {
        now: () => new Date(NOW.getTime() + 72 * 3_600_000 - 1_000),
      }),
    ).not.toBeNull();
  });

  it("answers null after a reset (the older token), but not for the new one (T24)", async () => {
    const { setupToken } = await newUser();
    const reset = ok(await issueSetupLink(EMAIL, ctx));
    expect(await previewPasswordSetup(setupToken, deps)).toBeNull();
    expect(await previewPasswordSetup(reset.setupToken, deps)).not.toBeNull();
  });

  it("answers null for a deleted user", async () => {
    const { setupToken } = await newUser();
    ok(await deletePasswordUser(EMAIL, ctx));
    expect(await previewPasswordSetup(setupToken, deps)).toBeNull();
  });

  it("answers null for a disabled user", async () => {
    const { setupToken } = await newUser();
    ok(await disablePasswordUser(EMAIL, ctx));
    expect(await previewPasswordSetup(setupToken, deps)).toBeNull();
  });

  it("answers null while the password sign-in switch is off (D24), and again a link when on", async () => {
    const { setupToken } = await newUser();
    ok(await setPasswordSignIn({ enabled: false, entraConfigured: true }, ctx));
    expect(await previewPasswordSetup(setupToken, deps)).toBeNull();
    ok(await setPasswordSignIn({ enabled: true, entraConfigured: true }, ctx));
    expect(await previewPasswordSetup(setupToken, deps)).not.toBeNull();
  });
});
