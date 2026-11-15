import { beforeEach, describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication"
// (D33): the Server Actions take the section key ("role-grants" |
// "password-users"), return to that fixed anchor, and refuse any other key
// without calling signIn (threat T32).
const signIn = vi.fn(async () => undefined);
const auth = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => auth(),
  signIn: (...args: unknown[]) => signIn(...(args as [])),
}));
vi.mock("@/env", () => ({ env: { AUTH_MASTER_USERNAME: "root" } }));

import { stepUpWithCredentials, stepUpWithEntra } from "./step-up-actions";

const passwordSession = {
  user: { authMethod: "password", email: "root.admin@example.test" },
};
const credsForm = () => {
  const data = new FormData();
  data.set("password", "pw");
  data.set("totp", "123456");
  return data;
};

beforeEach(() => {
  signIn.mockClear();
  auth.mockReset();
  auth.mockResolvedValue(passwordSession);
});

describe("step-up-actions - section key (D33)", () => {
  it.each(["role-grants", "password-users"] as const)(
    "stepUpWithEntra(%s) signs in returning to that anchor",
    async (section) => {
      await stepUpWithEntra(section);
      expect(signIn).toHaveBeenCalledWith(
        "microsoft-entra-id",
        { redirectTo: `/dashboard/settings#${section}` },
        { prompt: "login", max_age: "900" },
      );
    },
  );

  it.each(["role-grants", "password-users"] as const)(
    "stepUpWithCredentials(form, %s) signs in returning to that anchor",
    async (section) => {
      await stepUpWithCredentials(credsForm(), section);
      expect(signIn).toHaveBeenCalledWith(
        "password",
        expect.objectContaining({
          redirectTo: `/dashboard/settings#${section}`,
        }),
      );
    },
  );

  it("refuses an unknown or URL section key without signing in", async () => {
    // @ts-expect-error - a section outside the allowlist is rejected at runtime too
    expect(await stepUpWithEntra("https://evil.example.test/")).toEqual({
      ok: false,
    });
    expect(
      // @ts-expect-error - a section outside the allowlist is rejected at runtime too
      await stepUpWithCredentials(credsForm(), "/dashboard/settings"),
    ).toEqual({ ok: false });
    expect(signIn).not.toHaveBeenCalled();
  });
});
