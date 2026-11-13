import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizePasswordUser = vi.hoisted(() => vi.fn());
const completePasswordSetup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/password-credentials", () => ({ authorizePasswordUser }));
vi.mock("@/lib/auth/password-setup", () => ({ completePasswordSetup }));

import {
  createPasswordProvider,
  createPasswordSetupProvider,
} from "@/lib/auth/password-providers";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (Setup:
// the Auth.js `password-setup` provider; Sign-in: the `password` provider);
// R2b contract (factories registered in auth.ts at integration).
// Assumed: createPasswordProvider() / createPasswordSetupProvider() return an
// Auth.js Credentials provider whose authorize() delegates to
// authorizePasswordUser(credentials) / completePasswordSetup(parsed fields)
// and returns { id: oid, ...identity } or null. Setup credentials are
// { token, password, totpSecret?, totpCode? } as strings.
type Provider = {
  id?: string;
  type?: string;
  authorize?: (c: unknown) => Promise<unknown>;
  options?: { authorize?: (c: unknown) => Promise<unknown> };
};
const authorizeOf = (p: Provider) => {
  const fn = p.options?.authorize ?? p.authorize;
  if (!fn) throw new Error("provider has no authorize");
  return fn;
};
const IDENTITY = {
  oid: "local:abc",
  tid: "local",
  email: "a@example.com",
  authMethod: "password",
};

beforeEach(() => {
  authorizePasswordUser.mockReset();
  completePasswordSetup.mockReset();
});

describe("createPasswordProvider", () => {
  it("is a credentials provider with id `password`", () => {
    const p = createPasswordProvider() as Provider;
    expect(p.id).toBe("password");
    expect(p.type).toBe("credentials");
  });

  it("returns the identity as the Auth.js user, with id = oid", async () => {
    authorizePasswordUser.mockResolvedValue(IDENTITY);
    const creds = { email: "a@example.com", password: "x" };
    const user = await authorizeOf(createPasswordProvider() as Provider)(creds);
    expect(authorizePasswordUser).toHaveBeenCalledWith(creds);
    expect(user).toMatchObject({ id: "local:abc", ...IDENTITY });
  });

  it("returns null when the credentials are refused", async () => {
    authorizePasswordUser.mockResolvedValue(null);
    expect(
      await authorizeOf(createPasswordProvider() as Provider)({ email: "a" }),
    ).toBeNull();
  });
});

describe("createPasswordSetupProvider", () => {
  it("is a credentials provider with id `password-setup`", () => {
    const p = createPasswordSetupProvider() as Provider;
    expect(p.id).toBe("password-setup");
    expect(p.type).toBe("credentials");
  });

  it("passes token, password and the TOTP enrolment to completePasswordSetup", async () => {
    completePasswordSetup.mockResolvedValue({ ok: true, identity: IDENTITY });
    const user = await authorizeOf(createPasswordSetupProvider() as Provider)({
      token: "t".repeat(43),
      password: "a long enough passphrase",
      totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      totpCode: "123456",
    });
    expect(completePasswordSetup).toHaveBeenCalledWith(
      {
        token: "t".repeat(43),
        password: "a long enough passphrase",
        totp: { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", code: "123456" },
      },
      expect.anything(),
    );
    expect(user).toMatchObject({ id: "local:abc", ...IDENTITY });
  });

  it("omits totp when none is posted", async () => {
    completePasswordSetup.mockResolvedValue({ ok: true, identity: IDENTITY });
    await authorizeOf(createPasswordSetupProvider() as Provider)({
      token: "t",
      password: "p",
    });
    expect(completePasswordSetup.mock.calls[0]?.[0]).toEqual({
      token: "t",
      password: "p",
    });
  });

  it("returns null for every refusal code", async () => {
    for (const code of [
      "INVALID_LINK",
      "WEAK_PASSWORD",
      "TOTP_REQUIRED",
      "TOTP_INVALID",
    ]) {
      completePasswordSetup.mockResolvedValue({ ok: false, code });
      expect(
        await authorizeOf(createPasswordSetupProvider() as Provider)({
          token: "t",
          password: "p",
        }),
      ).toBeNull();
    }
  });

  it("returns null for a malformed payload without calling the setup module", async () => {
    expect(
      await authorizeOf(createPasswordSetupProvider() as Provider)({
        password: "p",
      }),
    ).toBeNull();
    expect(completePasswordSetup).not.toHaveBeenCalled();
  });
});
