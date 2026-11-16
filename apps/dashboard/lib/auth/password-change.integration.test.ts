import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GOOD_PASSWORD,
  OTHER_PASSWORD,
  fakeEnvelope,
} from "@/lib/auth/password-test-support";
import { NOW, ctxAt, ok } from "@/lib/data/access/access-test-support";
import { getPasswordCredential } from "@/lib/data/access/password-credentials-store";
import { createPasswordUser } from "@/lib/data/access/password-users";
import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/lib/data/access/access-test-support").then((m) =>
    m.faultyDynamodb(),
  ),
);
vi.mock("@/lib/auth/secret-envelope", () => fakeEnvelope);

import { changeOwnPassword } from "@/lib/auth/password-change";
import { completePasswordSetup } from "@/lib/auth/password-setup";

// Source: docs/specs/2026-11-10-access-control.md - "Password users"
// (Passwords: a signed-in user changes their own password), D29: a successful change raises the credentialVersion
// (older sessions end) and records the changing session's `signedInAt` so that
// one session is re-keyed by the jwt callback and stays signed in. Assumed API:
// changeOwnPassword({ oid, email, currentPassword, newPassword, totp?,
//   signedInAt? }, ctx) - `signedInAt` is the session's epoch-seconds sign-in
// time (session.user.signedInAt).
const ctx = ctxAt();
const EMAIL = "alice@example.com";
const SIGNED_IN_AT = 1_793_000_000;

beforeAll(ensureTestTable);
beforeEach(clearTable);

async function activeUser() {
  const { user, setupToken } = ok(
    await createPasswordUser({ email: EMAIL, displayName: "Alice" }, ctx),
  );
  const done = await completePasswordSetup(
    { token: setupToken, password: GOOD_PASSWORD },
    { now: () => NOW },
  );
  expect(done.ok).toBe(true);
  return user;
}

describe(
  "changeOwnPassword and the credentialVersion (F7)",
  {
    timeout: 60_000,
  },
  () => {
    it("raises the version by 1 and stores the session's signedInAt on success", async () => {
      const user = await activeUser();
      const before = (await getPasswordCredential(EMAIL))?.credentialVersion;
      const result = await changeOwnPassword(
        {
          oid: user.oid,
          email: EMAIL,
          currentPassword: GOOD_PASSWORD,
          newPassword: OTHER_PASSWORD,
          signedInAt: SIGNED_IN_AT,
        },
        ctx,
      );
      expect(result).toEqual({ ok: true });
      const after = await getPasswordCredential(EMAIL);
      expect(after?.credentialVersion).toBe((before ?? 0) + 1);
      expect(after?.selfChangeSignedInAt).toBe(SIGNED_IN_AT);
    });

    it.each([
      ["a wrong current password", GOOD_PASSWORD + "x", OTHER_PASSWORD],
      ["a weak new password", GOOD_PASSWORD, "short"],
    ])(
      "leaves the version and marker alone on %s",
      async (_n, current, next) => {
        const user = await activeUser();
        const before = await getPasswordCredential(EMAIL);
        const result = await changeOwnPassword(
          {
            oid: user.oid,
            email: EMAIL,
            currentPassword: current,
            newPassword: next,
            signedInAt: SIGNED_IN_AT,
          },
          ctx,
        );
        expect(result.ok).toBe(false);
        const after = await getPasswordCredential(EMAIL);
        expect(after?.credentialVersion).toBe(before?.credentialVersion);
        expect(after?.selfChangeSignedInAt).toBeUndefined();
      },
    );
  },
);
