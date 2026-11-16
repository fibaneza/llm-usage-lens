import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ctxAt, ok } from "@/test/support/access-test-support";
import { grantRole, revokeRole } from "@/lib/data/access/role-grants";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { loadSettingsAccessViewer } from "./settings-access";

// Source: docs/specs/2026-11-10-access-control.md - "Roles" (global roles are
// the claim plus in-app grants), "Password users" (global roles are in-app
// role grants), "Enforcement" item 4 and Rule 60.10 (authorization data is read
// per request, never cached), Rule 10.3 (roles resolved on the server and
// passed to the Settings UI). 4R.4 review B1: the viewer's roles feed
// `accessCapabilities`, so a password or Entra user with an in-app
// internal-admin grant must see the admin sections.
const OID = "oid-granted-person";
const session = (roles: string[], authMethod: "password" | "entra") =>
  ({ user: { oid: OID, roles, authMethod } }) as never;

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("loadSettingsAccessViewer effective roles (B1)", () => {
  it.each(["password", "entra"] as const)(
    "a %s session with no role claim and an in-app internal-admin grant gets the role in the viewer",
    async (method) => {
      ok(
        await grantRole(
          { oid: OID, role: "internal-admin", reason: "cover" },
          ctxAt(),
        ),
      );
      const viewer = await loadSettingsAccessViewer(session([], method));
      expect(viewer?.roles).toContain("internal-admin");
      expect(viewer?.authMethod).toBe(method);
    },
  );

  it("keeps the claim roles and adds the grant (a union, no duplicates)", async () => {
    ok(
      await grantRole(
        { oid: OID, role: "internal-admin", reason: "cover" },
        ctxAt(),
      ),
    );
    const viewer = await loadSettingsAccessViewer(
      session(["internal-auditor", "internal-admin"], "entra"),
    );
    expect([...(viewer?.roles ?? [])].sort()).toEqual([
      "internal-admin",
      "internal-auditor",
    ]);
  });

  it("without a grant the roles are the claim's alone", async () => {
    const viewer = await loadSettingsAccessViewer(session([], "password"));
    expect(viewer?.roles ?? []).not.toContain("internal-admin");
  });

  it("is read per request: a revoked grant is gone on the next call", async () => {
    const grant = ok(
      await grantRole(
        { oid: OID, role: "internal-admin", reason: "cover" },
        ctxAt(undefined, "req-grant"),
      ),
    );
    expect(
      (await loadSettingsAccessViewer(session([], "password")))?.roles,
    ).toContain("internal-admin");
    ok(
      await revokeRole(
        { oid: OID, role: "internal-admin", version: grant.version },
        ctxAt(undefined, "req-revoke"),
      ),
    );
    expect(
      (await loadSettingsAccessViewer(session([], "password")))?.roles ?? [],
    ).not.toContain("internal-admin");
  });
});
