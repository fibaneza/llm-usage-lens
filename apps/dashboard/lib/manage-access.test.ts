import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: slice B2 brief B2-1 (managementAccessFor: flags from the stored
// roles and the LIVE scope, "as the LiteLLM page resolves them today"; never
// cached, Rule 60.10; "Fail closed: on a read error, every flag false");
// Access Control - Enforcement (a suspended SSO admin scope, groupsOverage,
// grants nothing; a manual one never suspends) and Rule 50.4 (stored role
// grants count). The per-caller matrix runs against DynamoDB Local in
// manage-access.integration.test.ts; this file holds only the edge cases that
// need a controlled authorization read. Management improvements M1: the
// `organisation` flag is replaced by `litellm` (Access Control MI-D2) and
// `teamUsage` is added (MI-D7: a global reader, or a caller with a live admin
// scope; a suspended SSO scope does not count; a read failure closes it).
vi.mock("server-only", () => ({}));
const loadAuthorization = vi.fn();
vi.mock("@/lib/data/access/authorization", () => ({
  loadAuthorization: (input: unknown) => loadAuthorization(input),
}));
vi.mock("@/env", () => ({
  env: { APP_ENV: "dev", AUTH_ACCESS_MODE: "enforce" },
}));

import { managementAccessFor } from "./manage-access";

const session = (roles: string[]) =>
  ({ user: { oid: "o", roles, authMethod: "entra" } }) as never;

const CLOSED = {
  global: false,
  team: false,
  teamUsage: false,
  litellm: false,
  users: false,
  audit: { app: false, gateway: false },
  settings: false,
};

beforeEach(() => {
  loadAuthorization.mockResolvedValue({ appEnv: "dev", roleGrants: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("managementAccessFor: live scope and stored grants (B2-1)", () => {
  it.each([
    ["suspended (sso scope, groupsOverage)", "sso", true, false],
    ["live sso scope without groupsOverage", "sso", false, true],
    ["manual scope is never suspended", "manual", true, true],
  ])(
    "a lead whose only admin scope is %s: team=teamUsage=%s",
    async (_n, source, groupsOverage, team) => {
      loadAuthorization.mockResolvedValue({
        appEnv: "dev",
        roleGrants: [],
        identity: { groupsOverage },
        adminScopes: [{ source, scopeType: "team", scopeId: "t1" }],
      });

      const access = await managementAccessFor(session(["internal-viewer"]));

      expect(access.team).toBe(team);
      // MI-D7: a live admin scope opens Team usage; a suspended one does not.
      expect(access.teamUsage).toBe(team);
      expect(access.settings).toBe(false);
      // MI-D2: the LiteLLM area is for global readers only, never a lead.
      expect(access.litellm).toBe(false);
      expect(access.users).toBe(false);
    },
  );

  it("a stored internal-admin grant opens every flag for a claim without the role (Rule 50.4)", async () => {
    loadAuthorization.mockResolvedValue({
      appEnv: "dev",
      roleGrants: [{ role: "internal-admin" }],
    });

    const access = await managementAccessFor(session(["internal-viewer"]));

    expect(access).toMatchObject({
      global: true,
      team: true,
      teamUsage: true,
      litellm: true,
      users: true,
      settings: true,
      audit: { app: true, gateway: true },
    });
  });

  it("a department-scope lead has Team and Team usage and nothing else (MI-D7)", async () => {
    loadAuthorization.mockResolvedValue({
      appEnv: "dev",
      roleGrants: [],
      adminScopes: [
        { source: "manual", scopeType: "department", scopeId: "d1" },
      ],
    });

    expect(await managementAccessFor(session(["internal-viewer"]))).toEqual({
      ...CLOSED,
      team: true,
      teamUsage: true,
    });
  });

  it.each([
    ["admin", "internal-admin"],
    ["org admin", "internal-org-admin"],
    ["auditor", "internal-auditor"],
  ])(
    "a global reader (%s) with no scope has Team usage and LiteLLM (MI-D7, MI-D2)",
    async (_n, role) => {
      const access = await managementAccessFor(session([role]));

      expect(access.teamUsage).toBe(true);
      expect(access.litellm).toBe(true);
    },
  );

  it("a user with no scope has neither Team usage nor LiteLLM (MI-D7, MI-D2)", async () => {
    expect(await managementAccessFor(session(["internal-viewer"]))).toEqual(
      CLOSED,
    );
  });

  it("a global reader whose own scope is suspended keeps Team usage (MI-D7: reader OR live scope)", async () => {
    loadAuthorization.mockResolvedValue({
      appEnv: "dev",
      roleGrants: [],
      identity: { groupsOverage: true },
      adminScopes: [{ source: "sso", scopeType: "team", scopeId: "t1" }],
    });

    const access = await managementAccessFor(session(["internal-auditor"]));

    expect(access.teamUsage).toBe(true);
  });

  it("the retired organisation flag is gone from the answer (MI-D2)", async () => {
    const access = await managementAccessFor(session(["internal-admin"]));

    expect(access).not.toHaveProperty("organisation");
  });
});

describe("managementAccessFor: fail closed (B2-1)", () => {
  it("answers every flag false when the authorization read throws", async () => {
    loadAuthorization.mockRejectedValue(new Error("dynamodb down"));

    expect(await managementAccessFor(session(["internal-admin"]))).toEqual(
      CLOSED,
    );
  });

  it("answers every flag false without a session", async () => {
    expect(await managementAccessFor(null)).toEqual(CLOSED);
  });
});
