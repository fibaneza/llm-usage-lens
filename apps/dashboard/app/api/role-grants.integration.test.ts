import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import { grantRole, revokeRole } from "@/lib/data/access/role-grants";
import {
  expectData,
  expectError,
  invoke,
  signInAs,
} from "@/test/governance-route-support";
import { clearTable, ensureTestTable } from "@/test/test-support";

import * as roleGrantsRoute from "./role-grants/route";
import { POST as POST_MAPPING } from "./group-mappings/route";
import { GET } from "./role-grants/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/role-grants GET internal-admin or internal-auditor; POST and
// DELETE need re-auth and ship in a later slice), "Enforcement" items 2 and 4
// (403 before any read; private, no-store), D17 (a denied record is for
// writes). Spec: Access Control "API routes (additions)". Only `@/auth` is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const LIST = "/api/role-grants";
type Row = { oid: string; role: string; reason: string; version: number };

// A distinct request id per seed keeps each audit key unique.
let seedCount = 0;
async function seed(
  oid: string,
  role: "internal-admin" | "internal-org-admin" = "internal-org-admin",
) {
  return ok(
    await grantRole(
      { oid, role, reason: "quarterly review" },
      ctxAt(undefined, `req-seed-${++seedCount}`),
    ),
  );
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  signInAs("admin");
});

describe("GET /api/role-grants", () => {
  it.each(["viewer", "orgAdmin", "noRoles"] as const)(
    "403 FORBIDDEN for %s, and the body carries no grant data",
    async (caller) => {
      await seed("oid-grantee");
      signInAs(caller);
      const body = await expectError(
        await invoke(GET, { method: "GET", path: LIST }),
        403,
        "FORBIDDEN",
      );
      expect(JSON.stringify(body)).not.toContain("oid-grantee");
      expect(JSON.stringify(body)).not.toContain("quarterly review");
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s lists the grants as { data: { items } }",
    async (caller) => {
      const g1 = await seed("oid-one");
      const g2 = await seed("oid-two", "internal-admin");
      signInAs(caller);
      const data = await expectData<{ items: Row[]; cursor?: string }>(
        await invoke(GET, { method: "GET", path: LIST }),
      );
      expect(data.items).toHaveLength(2);
      expect(data.items).toEqual(expect.arrayContaining([g1, g2]));
      expect(data.cursor).toBeUndefined();
    },
  );

  it("an empty list is 200 with no items", async () => {
    const data = await expectData<{ items: Row[] }>(
      await invoke(GET, { method: "GET", path: LIST }),
    );
    expect(data.items).toEqual([]);
  });

  it("paginates with ?limit and an opaque cursor", async () => {
    await seed("oid-1");
    await seed("oid-2");
    await seed("oid-3");
    const first = await expectData<{ items: Row[]; cursor?: string }>(
      await invoke(GET, { method: "GET", path: `${LIST}?limit=2` }),
    );
    expect(first.items).toHaveLength(2);
    expect(typeof first.cursor).toBe("string");
    expect(first.cursor).not.toContain("ROLEGRANT");
    const second = await expectData<{ items: Row[]; cursor?: string }>(
      await invoke(GET, {
        method: "GET",
        path: `${LIST}?limit=2&cursor=${encodeURIComponent(first.cursor!)}`,
      }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.cursor).toBeUndefined();
    expect([...first.items, ...second.items].map((r) => r.oid).sort()).toEqual([
      "oid-1",
      "oid-2",
      "oid-3",
    ]);
  });

  it.each([
    ["a tampered cursor", "limit=2&cursor=garbage"],
    ["a zero limit", "limit=0"],
    ["a non-numeric limit", "limit=abc"],
  ])("400 BAD_REQUEST for %s", async (_name, query) => {
    await seed("oid-1");
    await expectError(
      await invoke(GET, { method: "GET", path: `${LIST}?${query}` }),
      400,
      "BAD_REQUEST",
    );
  });

  // Slice 4 adds POST (here) and DELETE; the re-auth suite is
  // role-grants.reauth.integration.test.ts. No other write method exists.
  it("exposes no write method besides POST", () => {
    expect(
      Object.keys(roleGrantsRoute).filter((k) =>
        /^(PUT|PATCH|DELETE)$/.test(k),
      ),
    ).toEqual([]);
  });
});

// Source: docs/specs/2026-11-10-access-control.md - "Roles" (global roles are
// the claim plus in-app grants), "Password users" (Global roles are in-app role
// grants), "Enforcement" item 4 and Rule 60.10 (authorization data is read per
// request, never cached), "Permission matrix". 4R.4 review B1: the route gates
// must see the same effective roles as the matrix routes. `POST
// /api/group-mappings` is requireAdmin and `GET /api/role-grants` is
// requireAdminOrAuditor; an invalid body (400) proves the 403 gate was passed.
describe("effective roles = claim + in-app grants, read per request (B1)", () => {
  const OID = "oid-granted-person";
  const signInWith = (authMethod: "password" | "entra" | "local") =>
    vi.mocked(auth).mockResolvedValue({
      user: {
        oid: OID,
        name: "G",
        roles: [],
        authMethod,
        authTime: Math.floor(Date.now() / 1000),
      },
    } as never);
  const postMapping = () =>
    invoke(POST_MAPPING, {
      method: "POST",
      path: "/api/group-mappings",
      body: {},
    });
  const list = () => invoke(GET, { method: "GET", path: LIST });

  it.each(["password", "entra"] as const)(
    "%s session with no role claim and an in-app internal-admin grant passes a requireAdmin route",
    async (method) => {
      await seed(OID, "internal-admin");
      signInWith(method);
      await expectError(await postMapping(), 400, "BAD_REQUEST");
    },
  );

  it("without the grant the same session is 403 on the requireAdmin route", async () => {
    signInWith("password");
    await expectError(await postMapping(), 403, "FORBIDDEN");
  });

  it("an in-app internal-admin grant also passes a requireAdminOrAuditor route", async () => {
    await seed(OID, "internal-admin");
    signInWith("password");
    await expectData(await list());
  });

  it("a revoked grant is 403 on the very next request (no caching of roles)", async () => {
    const grant = await seed(OID, "internal-admin");
    signInWith("password");
    await expectError(await postMapping(), 400, "BAD_REQUEST");
    ok(
      await revokeRole(
        { oid: OID, role: "internal-admin", version: grant.version },
        ctxAt(undefined, "req-revoke"),
      ),
    );
    await expectError(await postMapping(), 403, "FORBIDDEN");
  });

  it("an org-admin grant does not make a requireAdmin route reachable", async () => {
    await seed(OID, "internal-org-admin");
    signInWith("password");
    await expectError(await postMapping(), 403, "FORBIDDEN");
  });
});
