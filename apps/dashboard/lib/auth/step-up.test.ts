import { describe, expect, it } from "vitest";

import {
  STEP_UP_REDIRECTS,
  buildDevLoginStepUp,
  buildEntraStepUp,
  buildMasterStepUp,
  buildPasswordStepUp,
} from "./step-up";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication",
// Step-up: a step-up is a full sign-in through the existing providers. Entra:
// signIn("microsoft-entra-id", { redirectTo }, { prompt: "login", max_age:
// "900" }); password and master users re-enter the credential, the identifier
// comes from the session and never from the form, a caller with no session or
// of another authMethod is refused; `redirectTo` is the fixed
// a fixed allowlist chosen by a section key ("role-grants" |
// "password-users"), never a URL (D33); an unknown key is rejected with null.
// Threat T32. These are the pure builders; the Server
// Actions that call signIn() are wired in the UI step.
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const passwordSession = {
  user: { authMethod: "password", email: "root.admin@example.test" },
};
const masterSession = { user: { authMethod: "master" } };
const entraSession = { user: { authMethod: "entra" } };

// Access Control spec - "Recent authentication" (D33): the return target is a
// fixed allowlist keyed by section.
// Access Control D33 + Design System Settings Page: the return lands on the
// section's final tab URL (the index redirect would drop the fragment).
const FINAL = {
  "role-grants": "/dashboard/settings/access/roles#role-grants",
  "password-users": "/dashboard/settings/access/sign-in#password-users",
} as const;

describe("STEP_UP_REDIRECTS", () => {
  it("is exactly the two allowlisted final tab URLs", () => {
    expect(STEP_UP_REDIRECTS).toEqual({
      ...FINAL,
    });
  });
});

describe("step-up section key (D33)", () => {
  it.each(["role-grants", "password-users"] as const)(
    "all three builders return to the %s anchor",
    (section) => {
      const anchor = FINAL[section];
      expect(buildEntraStepUp(section, entraSession)?.redirectTo).toBe(anchor);
      expect(
        buildPasswordStepUp(passwordSession, form({ password: "pw" }), section)
          ?.redirectTo,
      ).toBe(anchor);
      expect(
        buildMasterStepUp(
          masterSession,
          form({ password: "pw" }),
          "root",
          section,
        )?.redirectTo,
      ).toBe(anchor);
    },
  );

  it.each([
    ["an unknown key", "settings"],
    ["a URL", "https://evil.example.test/"],
    ["a path", "/dashboard/settings#role-grants"],
    ["an empty string", ""],
    ["a prototype key", "__proto__"],
  ])("rejects %s with null in every builder", (_n, key) => {
    expect(buildEntraStepUp(key, entraSession)).toBeNull();
    expect(
      buildPasswordStepUp(passwordSession, form({ password: "pw" }), key),
    ).toBeNull();
    expect(
      buildMasterStepUp(masterSession, form({ password: "pw" }), "root", key),
    ).toBeNull();
  });
});

describe("buildEntraStepUp", () => {
  it("asks Entra for a fresh login within 900 seconds and returns to /dashboard/settings/access/roles#role-grants", () => {
    expect(buildEntraStepUp("role-grants", entraSession)).toEqual({
      providerId: "microsoft-entra-id",
      redirectTo: FINAL["role-grants"],
      authorizationParams: { prompt: "login", max_age: "900" },
    });
  });
});

describe("buildPasswordStepUp", () => {
  it("takes the email from the session and the secrets from the form", () => {
    const result = buildPasswordStepUp(
      passwordSession,
      form({ password: "correct horse", totp: "123456" }),
      "role-grants",
    );
    expect(result).toEqual({
      providerId: "password",
      redirectTo: FINAL["role-grants"],
      credentials: {
        email: "root.admin@example.test",
        password: "correct horse",
        totp: "123456",
      },
    });
  });

  it("ignores an email or username in the form (a step-up cannot switch identity)", () => {
    const result = buildPasswordStepUp(
      passwordSession,
      form({
        password: "pw",
        totp: "123456",
        email: "attacker@example.test",
        username: "attacker",
      }),
      "role-grants",
    );
    expect(result?.credentials).toMatchObject({
      email: "root.admin@example.test",
    });
    expect(JSON.stringify(result)).not.toContain("attacker");
  });

  it.each([
    ["no session", null],
    ["an undefined session", undefined],
    ["a session with no user", {}],
    ["an Entra session", { user: { authMethod: "entra", email: "a@b.test" } }],
    ["a master session", { user: { authMethod: "master", email: "a@b.test" } }],
    [
      "a dev-login session",
      { user: { authMethod: "local", email: "a@b.test" } },
    ],
    ["a password session with no email", { user: { authMethod: "password" } }],
  ])("returns null for %s", (_n, session) => {
    expect(
      buildPasswordStepUp(session, form({ password: "pw" }), "role-grants"),
    ).toBeNull();
  });
});

describe("buildMasterStepUp", () => {
  it("takes the username from the configured master username, never from the form", () => {
    const result = buildMasterStepUp(
      masterSession,
      form({
        username: "attacker",
        email: "attacker@example.test",
        password: "pw",
        totp: "654321",
      }),
      "root",
      "role-grants",
    );
    expect(result).toEqual({
      providerId: "master-user",
      redirectTo: FINAL["role-grants"],
      credentials: { username: "root", password: "pw", totp: "654321" },
    });
    expect(JSON.stringify(result)).not.toContain("attacker");
  });

  it.each([
    ["no session", null],
    ["a session with no user", {}],
    ["an Entra session", { user: { authMethod: "entra" } }],
    ["a password session", { user: { authMethod: "password" } }],
  ])("returns null for %s", (_n, session) => {
    expect(
      buildMasterStepUp(
        session,
        form({ password: "pw" }),
        "root",
        "role-grants",
      ),
    ).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
  ])("returns null when the master username is %s", (_n, username) => {
    expect(
      buildMasterStepUp(
        masterSession,
        form({ password: "pw" }),
        username,
        "role-grants",
      ),
    ).toBeNull();
  });
});

// Access Control spec - "Recent authentication" (D33), T32: the dev-login
// step-up confirms as the session's own role and never invents one. 4R.4
// round 3 W: a local session with no global role yields null, not
// internal-admin.
describe("buildDevLoginStepUp (T32)", () => {
  const local = (roles: unknown) => ({
    user: { authMethod: "local", roles },
  });

  it("uses the session's own global role", () => {
    expect(
      buildDevLoginStepUp(local(["internal-viewer"]), "role-grants")?.role,
    ).toBe("internal-viewer");
  });

  it.each([[[]], [undefined], [["not-a-role"]]])(
    "returns null instead of falling back to internal-admin when the session has no global role (%j)",
    (roles) => {
      expect(buildDevLoginStepUp(local(roles), "role-grants")).toBeNull();
    },
  );
});
