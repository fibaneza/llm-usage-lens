import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  expectData,
  expectError,
  invoke,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/support/matrix-route-support";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/support/test-support";

import { GET } from "../access/org-units/route";

// Source: Access Control D37 (access pickers list from the account
// registry, not rollups, scoped to what the caller can manage); Access Control
// spec - "Permission matrix" (scopes: a team-scope admin manages its teams, a
// department-scope admin its departments and their teams, internal-admin and
// internal-org-admin everything), "Roles" (internal-auditor reads
// configuration, read-only: allowed to read all), "Enforcement" item 2 (403
// for a caller with no management role; reads set no-store). 401 is covered by
// unauthenticated-routes.integration.test.ts (it discovers every route file).
// seedWorld loads the accounts and no rollups, so every team here is one that
// "has no recent usage". Only `@/auth` is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

type OrgUnits = {
  teams: { id: string; name: string; departmentId: string }[];
  departments: { id: string; name: string }[];
};

const byId = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));
const read = () =>
  invoke(GET, { method: "GET", path: "/api/access/org-units" });

const ALL_TEAMS = [
  { id: "team-a", name: "A", departmentId: "dept-eng" },
  { id: "team-b", name: "B", departmentId: "dept-eng" },
  { id: "team-c", name: "C", departmentId: "dept-ops" },
  { id: "team-m", name: "M", departmentId: "dept-ops" },
];
const ALL_DEPARTMENTS = [
  { id: "dept-eng", name: "Engineering" },
  { id: "dept-ops", name: "Ops" },
];

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await seedWorld();
});

describe("GET /api/access/org-units", () => {
  it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
    "%s sees every team and department of the registry, teams with no rollups included, with no-store",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<OrgUnits>(await read());
      expect(byId(data.teams)).toEqual(ALL_TEAMS);
      expect(byId(data.departments)).toEqual(ALL_DEPARTMENTS);
    },
  );

  it("a department-scope admin sees its department and that department's teams only", async () => {
    signInAs("deptAdminEng");
    const data = await expectData<OrgUnits>(await read());
    expect(byId(data.teams)).toEqual(ALL_TEAMS.slice(0, 2));
    expect(data.departments).toEqual([ALL_DEPARTMENTS[0]]);
  });

  it("a team-scope admin sees its team only and no department", async () => {
    signInAs("teamAdminA");
    const data = await expectData<OrgUnits>(await read());
    expect(data.teams).toEqual([ALL_TEAMS[0]]);
    expect(data.departments).toEqual([]);
  });

  it.each(["viewerNone", "memberA"] as CallerName[])(
    "%s (no management role or scope) gets 403 FORBIDDEN and no org data",
    async (caller) => {
      signInAs(caller);
      const body = await expectError(await read(), 403, "FORBIDDEN");
      const text = JSON.stringify(body);
      for (const leak of ["team-a", "dept-eng", "Engineering"]) {
        expect(text).not.toContain(leak);
      }
    },
  );

  it("several accounts of one team list the team once; a team moved to another department is listed under the registry's current one", async () => {
    await loadFixtures({
      accounts: [
        makeAccount(5, {
          teamId: "team-a",
          teamName: "A",
          departmentId: "dept-eng",
          departmentName: "Engineering",
        }),
        makeAccount(6, {
          teamId: "team-m",
          teamName: "M",
          departmentId: "dept-eng",
          departmentName: "Engineering",
        }),
      ],
    });
    signInAs("admin");
    const data = await expectData<OrgUnits>(await read());
    expect(data.teams.filter((t) => t.id === "team-a")).toHaveLength(1);
    expect(data.departments.filter((d) => d.id === "dept-eng")).toHaveLength(1);
  });

  it("authorization is read per request: a scope granted after the first read shows on the next, with no stale cache", async () => {
    signInAs("viewerNone");
    await expectError(await read(), 403, "FORBIDDEN");
    const { seedAdminScope } =
      await import("@/test/support/matrix-route-support");
    await seedAdminScope(CALLERS.viewerNone.oid, "team", "team-c");
    const data = await expectData<OrgUnits>(await read());
    expect(data.teams).toEqual([ALL_TEAMS[2]]);
  });

  it("returns teams and departments sorted by name, not by id or registry order (D37, 4R.4 review B4)", async () => {
    await loadFixtures({
      accounts: [
        makeAccount(7, {
          teamId: "team-z",
          teamName: "0 First",
          departmentId: "dept-zz",
          departmentName: "Aardvark",
        }),
      ],
    });
    signInAs("admin");
    const data = await expectData<OrgUnits>(await read());
    expect(data.teams.map((t) => t.name)).toEqual([
      "0 First",
      "A",
      "B",
      "C",
      "M",
    ]);
    expect(data.departments.map((d) => d.name)).toEqual([
      "Aardvark",
      "Engineering",
      "Ops",
    ]);
  });
});
