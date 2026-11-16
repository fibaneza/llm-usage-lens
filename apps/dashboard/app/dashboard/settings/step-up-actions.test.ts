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

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "./step-up-actions";

const entraSession = { user: { authMethod: "entra", email: "e@example.test" } };
const localSession = {
  user: { authMethod: "local", roles: ["internal-admin"] },
};
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

// Access Control D33 + Design System Settings Page: the return lands on the
// section's final tab URL (the index redirect would drop the fragment).
const FINAL = {
  "role-grants": "/dashboard/settings/access/roles#role-grants",
  "password-users": "/dashboard/settings/access/sign-in#password-users",
} as const;

describe("step-up-actions - section key (D33)", () => {
  it.each(["role-grants", "password-users"] as const)(
    "stepUpWithEntra(%s) signs in returning to that anchor",
    async (section) => {
      auth.mockResolvedValue(entraSession);
      await stepUpWithEntra(section);
      expect(signIn).toHaveBeenCalledWith(
        "microsoft-entra-id",
        { redirectTo: FINAL[section] },
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
          redirectTo: FINAL[section],
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

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication",
// Step-up (T32): a step-up is a full sign-in through the provider of the
// session's own method, the identifier from the session. 4R.4 review B3: the
// Entra action had no session or method guard, and a dev-login session had no
// path of its own.
describe("stepUpWithEntra - session and method guard (B3, T32)", () => {
  it("starts the Microsoft redirect for an Entra session, forcing a fresh login", async () => {
    auth.mockResolvedValue(entraSession);
    expect(await stepUpWithEntra("role-grants")).toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith(
      "microsoft-entra-id",
      { redirectTo: FINAL["role-grants"] },
      { prompt: "login", max_age: "900" },
    );
  });

  it("refuses without a session, without signing in", async () => {
    auth.mockResolvedValue(null);
    expect(await stepUpWithEntra("role-grants")).toEqual({ ok: false });
    expect(signIn).not.toHaveBeenCalled();
  });

  it.each(["password", "master", "local"] as const)(
    "refuses a %s session, without signing in",
    async (authMethod) => {
      auth.mockResolvedValue({ user: { authMethod } });
      expect(await stepUpWithEntra("password-users")).toEqual({ ok: false });
      expect(signIn).not.toHaveBeenCalled();
    },
  );

  it("refuses a session that names no sign-in method", async () => {
    auth.mockResolvedValue({ user: {} });
    expect(await stepUpWithEntra("role-grants")).toEqual({ ok: false });
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("stepUpWithDevLogin - the dev-login session's own step-up (B3, T32)", () => {
  it.each(["role-grants", "password-users"] as const)(
    "signs in again with the dev login, as the session's own role, returning to #%s",
    async (section) => {
      auth.mockResolvedValue(localSession);
      expect(await stepUpWithDevLogin(section)).toBeUndefined();
      expect(signIn).toHaveBeenCalledWith("dev-login", {
        role: "internal-admin",
        redirectTo: FINAL[section],
      });
    },
  );

  it.each([
    ["no session", null],
    ["an Entra session", entraSession],
    ["a password session", passwordSession],
    ["a master session", { user: { authMethod: "master" } }],
  ])("refuses %s without signing in", async (_name, session) => {
    auth.mockResolvedValue(session);
    expect(await stepUpWithDevLogin("role-grants")).toEqual({ ok: false });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("refuses an unknown or URL section key without signing in", async () => {
    auth.mockResolvedValue(localSession);
    // @ts-expect-error - a section outside the allowlist is rejected at runtime too
    expect(await stepUpWithDevLogin("https://evil.example.test/")).toEqual({
      ok: false,
    });
    expect(signIn).not.toHaveBeenCalled();
  });
});
