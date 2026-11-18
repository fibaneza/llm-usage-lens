import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { globalRolesOf } from "@/lib/auth/policy";
import type { PolicySession } from "@/lib/auth/policy";
import {
  CURSOR_SECRET,
  OID_A,
  ctxAt,
  ok,
} from "@/test/support/access-test-support";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { loadAuthorization, loadWriteActor } from "./authorization";
import { createGroupMapping } from "./group-mappings";
import { grantRole, listRoleGrants, revokeRole } from "./role-grants";

// Source: docs/specs/2026-11-10-access-control.md - "Enforcement" item 1,
// "Effective global roles ... Fix, 2026-11-18": effective global roles are the
// token claims union the stored ROLEGRANT items for every caller, read per
// request and never cached; the legacy `Admin` alias stays gated outside
// APP_ENV=prod; group mappings never grant global roles (T4).
const ctx = ctxAt();
const sessionWith = (roles?: unknown): PolicySession => ({
  user: { oid: OID_A, email: "a@example.com", roles },
});

async function effectiveRoles(
  session: PolicySession,
  appEnv: "dev" | "prod" = "dev",
) {
  const loaded = await loadAuthorization({
    appEnv,
    session,
    teamIds: [],
    departmentIds: [],
  });
  return globalRolesOf(session, appEnv, loaded.roleGrants);
}

const sorted = (roles: readonly string[] | null) => [...(roles ?? [])].sort();

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("loadAuthorization effective global roles", () => {
  it("auditor claim + stored internal-org-admin grant yields both", async () => {
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-org-admin", reason: "cover" },
        ctx,
      ),
    );
    expect(
      sorted(await effectiveRoles(sessionWith(["internal-auditor"]))),
    ).toEqual(["internal-auditor", "internal-org-admin"]);
  });

  it("internal-org-admin claim + stored internal-admin grant yields both", async () => {
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-admin", reason: "cover" },
        ctx,
      ),
    );
    expect(
      sorted(await effectiveRoles(sessionWith(["internal-org-admin"]))),
    ).toEqual(["internal-admin", "internal-org-admin"]);
  });

  it("no global claim + a stored grant yields the granted role", async () => {
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-org-admin", reason: "cover" },
        ctx,
      ),
    );
    expect(sorted(await effectiveRoles(sessionWith()))).toContain(
      "internal-org-admin",
    );
  });

  it("a claim with no grant yields the claim only", async () => {
    expect(
      sorted(await effectiveRoles(sessionWith(["internal-org-admin"]))),
    ).toEqual(["internal-org-admin"]);
  });

  it("a grant revoked between two calls is gone on the second (never cached)", async () => {
    const session = sessionWith(["internal-auditor"]);
    const grant = ok(
      await grantRole(
        { oid: OID_A, role: "internal-org-admin", reason: "cover" },
        ctx,
      ),
    );
    expect(await effectiveRoles(session)).toContain("internal-org-admin");
    ok(
      await revokeRole(
        { oid: OID_A, role: "internal-org-admin", version: grant.version },
        ctxAt(ctx.now, "req-2"),
      ),
    );
    expect(
      ok(await listRoleGrants({ cursorSecret: CURSOR_SECRET })).items,
    ).toEqual([]);
    expect(sorted(await effectiveRoles(session))).toEqual(["internal-auditor"]);
  });

  it("a grant stored between two calls appears on the second", async () => {
    const session = sessionWith(["internal-auditor"]);
    expect(sorted(await effectiveRoles(session))).toEqual(["internal-auditor"]);
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-org-admin", reason: "cover" },
        ctxAt(ctx.now, "req-2"),
      ),
    );
    expect(sorted(await effectiveRoles(session))).toEqual([
      "internal-auditor",
      "internal-org-admin",
    ]);
  });

  it.each([
    ["dev", ["internal-admin"]],
    ["prod", ["internal-viewer"]],
  ] as const)(
    "legacy Admin claim in %s maps as before (alias off in prod)",
    async (appEnv, expected) => {
      expect(
        sorted(await effectiveRoles(sessionWith(["Admin"]), appEnv)),
      ).toEqual(expected);
    },
  );

  it("a group mapping for the caller never yields a global role (T4)", async () => {
    ok(
      await createGroupMapping(
        {
          groupId: "11111111-1111-4111-8111-111111111111",
          target: { type: "team", id: "team-payments" },
          scopedRole: "member",
        },
        ctx,
      ),
    );
    expect(sorted(await effectiveRoles(sessionWith()))).toEqual([
      "internal-viewer",
    ]);
  });
});

describe("loadWriteActor effective global roles", () => {
  // Same spec line: claims union stored ROLEGRANTs for every caller.
  const actorRoles = async (session: PolicySession) =>
    sorted((await loadWriteActor({ appEnv: "dev", session }))?.roles ?? null);

  it("internal-org-admin claim + stored internal-admin grant carries both", async () => {
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-admin", reason: "cover" },
        ctx,
      ),
    );
    expect(await actorRoles(sessionWith(["internal-org-admin"]))).toEqual([
      "internal-admin",
      "internal-org-admin",
    ]);
  });

  it("a grant revoked between two calls is gone on the second (never cached)", async () => {
    const session = sessionWith(["internal-auditor"]);
    const grant = ok(
      await grantRole(
        { oid: OID_A, role: "internal-org-admin", reason: "cover" },
        ctx,
      ),
    );
    expect(await actorRoles(session)).toContain("internal-org-admin");
    ok(
      await revokeRole(
        { oid: OID_A, role: "internal-org-admin", version: grant.version },
        ctxAt(ctx.now, "req-2"),
      ),
    );
    expect(await actorRoles(session)).toEqual(["internal-auditor"]);
  });
});
