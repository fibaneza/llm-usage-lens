import { describe, expect, it } from "vitest";

import { buildAccessViewer } from "./settings-access";

// Source: docs/specs/2026-11-10-access-control.md - "Enforcement" / "Evaluation
// order" (the session carries the global roles; admin scopes are resolved per
// request on the server and suspended SSO scopes grant nothing), "Recent
// authentication" (`session.user.authTime` is copied read-only to the session;
// the UI may read it), Rule 10.3 / 50.3 (roles resolved on the server and
// passed to the Settings UI as plain data).
//
// Module under test: `lib/auth/settings-access.ts` (no server-only import for
// the pure builder; the data lookup lives beside it):
//   buildAccessViewer(session, adminScopes) -> AccessViewer | null
//   loadSettingsAccessViewer(session) -> Promise<AccessViewer | undefined>
//     = buildAccessViewer(session, <resolved scopes>) ?? undefined. It MUST
//     return undefined WITHOUT any data access when buildAccessViewer would
//     return null, so a session without `authMethod` (the existing page tests)
//     never reaches DynamoDB.
const SCOPE = { scopeType: "team", scopeId: "team-pay" } as const;

describe("buildAccessViewer", () => {
  it("copies roles, authMethod, authTime and the resolved scopes", () => {
    expect(
      buildAccessViewer(
        {
          user: {
            oid: "oid-1",
            roles: ["internal-admin", "internal-auditor"],
            authMethod: "password",
            authTime: 1_800_000_000,
          },
        },
        [SCOPE],
      ),
    ).toEqual({
      roles: ["internal-admin", "internal-auditor"],
      authMethod: "password",
      authTime: 1_800_000_000,
      adminScopes: [SCOPE],
    });
  });

  it("omits authTime when the session has none (an Entra token without auth_time)", () => {
    const viewer = buildAccessViewer(
      { user: { oid: "oid-1", roles: [], authMethod: "entra" } },
      [],
    );
    expect(viewer).not.toBeNull();
    expect(viewer).not.toHaveProperty("authTime");
  });

  it("drops non-string roles instead of reinterpreting them", () => {
    const viewer = buildAccessViewer(
      {
        user: {
          oid: "oid-1",
          roles: ["internal-admin", 7, null],
          authMethod: "entra",
        },
      },
      [],
    );
    expect(viewer?.roles).toEqual(["internal-admin"]);
  });

  it.each([
    ["no session", null],
    ["no user", {}],
    ["no oid", { user: { roles: ["internal-admin"], authMethod: "entra" } }],
    ["no authMethod", { user: { oid: "oid-1", roles: ["internal-admin"] } }],
  ])("returns null for %s (fail closed)", (_name, session) => {
    expect(buildAccessViewer(session as never, [SCOPE])).toBeNull();
  });
});
