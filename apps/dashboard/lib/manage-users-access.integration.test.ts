import type { Session } from "next-auth";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { grantRole } from "@/lib/data/access/role-grants";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { usersPageAccessFor } from "./manage-users-access";

// Source: Design System - Management improvements, Users (D15, "a step is
// shown only to a caller who may do it") and User link states (D16: link
// controls for admin and org-admin); Access Control - Enforcement (effective
// permission = session role claim UNION the caller's in-app ROLEGRANT items,
// read per request, never cached); implementation-phases M3 Verify. Real
// authorization reads from DynamoDB Local (Rule 60.22).
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.fakeNextCache;
});

const OID = "00000000-0000-4000-8000-0000000000c1";
const session = (roles: string[], oid: string | null = OID) =>
  ({
    user: {
      oid: oid ?? undefined,
      email: "me@company.com",
      roles,
      tid: "t",
      authMethod: "entra",
    },
  }) as unknown as Session;

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("usersPageAccessFor", () => {
  it.each([
    [
      "an admin before SSO",
      ["internal-admin"],
      false,
      { password: true, team: true, link: true },
    ],
    [
      "an org-admin",
      ["internal-org-admin"],
      false,
      { password: false, team: true, link: true },
    ],
    [
      "an admin under Entra",
      ["internal-admin"],
      true,
      { password: false, team: true, link: true },
    ],
    [
      "an auditor",
      ["internal-auditor"],
      false,
      { password: false, team: false, link: false },
    ],
  ])("%s gets the steps they may do (D15)", async (_l, roles, entra, steps) => {
    const access = await usersPageAccessFor(session(roles), entra);
    expect(access?.steps).toEqual(steps);
    expect(access?.ownOid).toBe(OID);
  });

  it("a role held only as an in-app grant counts as the role (Enforcement: claims union grants)", async () => {
    ok(
      await grantRole(
        { oid: OID, role: "internal-admin", reason: "quarterly review" },
        ctxAt(),
      ),
    );
    const access = await usersPageAccessFor(
      session(["internal-viewer"]),
      false,
    );
    expect(access?.steps).toEqual({ password: true, team: true, link: true });
  });

  it("is read per request: a viewer has no steps until the grant exists (Rule 60.10)", async () => {
    const before = await usersPageAccessFor(
      session(["internal-viewer"]),
      false,
    );
    expect(before?.steps).toEqual({
      password: false,
      team: false,
      link: false,
    });
    ok(
      await grantRole(
        { oid: OID, role: "internal-org-admin", reason: "cover" },
        ctxAt(),
      ),
    );
    const after = await usersPageAccessFor(session(["internal-viewer"]), false);
    expect(after?.steps.link).toBe(true);
  });

  it("is null without a session or an oid (fail closed)", async () => {
    expect(await usersPageAccessFor(null, false)).toBeNull();
    expect(
      await usersPageAccessFor(session(["internal-admin"], null), false),
    ).toBeNull();
  });
});
