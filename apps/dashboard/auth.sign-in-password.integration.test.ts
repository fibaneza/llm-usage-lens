import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);
vi.mock("@/lib/auth/secret-envelope", () =>
  import("@/test/support/password-test-support").then((m) => m.fakeEnvelope),
);

import {
  GOOD_PASSWORD,
  OTHER_PASSWORD,
  TOTP_SECRET,
  totpAt,
} from "@/test/support/password-test-support";
import { NOW, ctxAt, ok } from "@/test/support/access-test-support";
import {
  createPasswordUser,
  disablePasswordUser,
  userKey,
} from "@/lib/data/access/password-users";
import { grantRole } from "@/lib/data/access/role-grants";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  putRaw,
  testDoc,
} from "@/test/support/test-support";
import { completePasswordSetup } from "@/lib/auth/password-setup";
import { createPasswordProvider } from "@/lib/auth/password-providers";

// Source: Design System - Sign-in page, "The forms (unit SI1)" tests T-SI3 and
// T-SI4; Access Control - Password users (Sign-in), threats T20, T23. The
// refusal cases of authorizePasswordUser itself (unknown, wrong password,
// lockout, dummy hash, replayed code) are proved in
// lib/auth/password-credentials.integration.test.ts; this file adds only what
// the sign-in form relies on: the field names the action sends reach the
// provider's authorize, and the provider returns the one same null for every
// refusal, including an SSO-bound user (not covered there).
const ctx = ctxAt();
let seq = 0;

beforeAll(ensureTestTable);
beforeEach(clearTable);

type Provider = {
  options?: {
    credentials?: Record<string, unknown>;
    authorize?: (c: unknown) => Promise<unknown>;
  };
};
function provider() {
  const p = createPasswordProvider() as Provider;
  const authorize = p.options?.authorize;
  if (!authorize) throw new Error("password provider has no authorize");
  return { authorize, credentials: p.options?.credentials ?? {} };
}

async function activeUser(opts: { enrolled?: boolean } = {}) {
  seq += 1;
  const email = `si1user${seq}@example.com`;
  const { user, setupToken } = ok(
    await createPasswordUser({ email, displayName: "Test User" }, ctx),
  );
  if (opts.enrolled) {
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
      ...(opts.enrolled
        ? { totp: { secret: TOTP_SECRET, code: totpAt(NOW) } }
        : {}),
    },
    { now: () => NOW },
  );
  expect(done.ok).toBe(true);
  return { user, email };
}

describe(
  "password provider as the sign-in form drives it",
  { timeout: 60_000 },
  () => {
    it("takes the field names email, password and totp that the action sends (T-SI3)", () => {
      expect(Object.keys(provider().credentials).sort()).toEqual([
        "email",
        "password",
        "totp",
      ]);
    });

    it("returns the Auth.js user for the right email and password (T-SI3)", async () => {
      const { user, email } = await activeUser();
      expect(
        await provider().authorize({
          email,
          password: GOOD_PASSWORD,
          totp: "",
        }),
      ).toMatchObject({ id: user.oid, email, authMethod: "password" });
    });

    it("returns the user with a current code when enrolled, null without it (T-SI3)", async () => {
      const { user, email } = await activeUser({ enrolled: true });
      const { authorize } = provider();
      expect(
        await authorize({ email, password: GOOD_PASSWORD, totp: "" }),
      ).toBeNull();
      expect(
        await authorize({
          email,
          password: GOOD_PASSWORD,
          totp: totpAt(new Date(), TOTP_SECRET),
        }),
      ).toMatchObject({ id: user.oid });
    });

    // T-SI4, T20, T23: every cause is the same null.
    it("returns the same null for an unknown, disabled, SSO-bound or locked user, a wrong password and a wrong code (T-SI4, T20, T23)", async () => {
      const { authorize } = provider();
      const attempt = (email: string, password: string, totp = "") =>
        authorize({ email, password, totp });
      const refusals: unknown[] = [];

      refusals.push(await attempt("nobody@example.com", GOOD_PASSWORD));

      const disabled = await activeUser();
      ok(await disablePasswordUser(disabled.email, ctx));
      refusals.push(await attempt(disabled.email, GOOD_PASSWORD));

      const bound = await activeUser();
      const stored = await testDoc().send(
        new GetCommand({
          TableName: TEST_TABLE_NAME,
          Key: userKey(bound.email),
        }),
      );
      await putRaw({ ...(stored.Item ?? {}), status: "sso-bound" });
      refusals.push(await attempt(bound.email, GOOD_PASSWORD));

      const wrongPassword = await activeUser();
      refusals.push(await attempt(wrongPassword.email, OTHER_PASSWORD));

      const wrongCode = await activeUser({ enrolled: true });
      refusals.push(await attempt(wrongCode.email, GOOD_PASSWORD, "000000"));

      const locked = await activeUser();
      for (let i = 0; i < 5; i += 1) {
        await attempt(locked.email, OTHER_PASSWORD);
      }
      refusals.push(await attempt(locked.email, GOOD_PASSWORD));

      expect(refusals).toEqual([null, null, null, null, null, null]);
    });
  },
);
