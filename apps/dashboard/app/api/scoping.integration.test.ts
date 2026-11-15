import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { grantAdminScope } from "@/lib/data/access/admin-scopes";
import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import { addMember, removeMember } from "@/lib/data/access/affiliations";
import {
  putDepartmentVisibility,
  putTeamVisibility,
} from "@/lib/data/access/visibility";
import { buildRollup } from "@/test/rollup-builder";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

import { GET as getDepartmentDetail } from "./departments/[id]/route";
import { GET as getDepartments } from "./departments/route";
import { GET as getOverview } from "./overview/route";
import { GET as getRanking } from "./ranking/route";
import { GET as getServices } from "./services/route";
import { GET as getTeamDetail } from "./teams/[id]/route";
import { GET as getTeams } from "./teams/route";
import { GET as getUsers } from "./users/route";

// Source: docs/specs/2026-11-10-access-control.md — "Enforcement" items 2-4
// (404 parity, aggregates after filtering, caching cannot leak), "Visibility
// and inheritance", "Membership..." (department scope per day, W3); threats
// T5, T6, T12-T15; implementation-phases Phase 4R.3 Verify. DynamoDB Local;
// only the session is mocked, and next/cache is the memoizing fake so a
// scope-dependent or authorization read placed inside unstable_cache fails.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.fakeNextCache;
});

type Handler = (
  request: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";
const acctA = makeAccount(1, {
  teamId: "team-a",
  teamName: "A",
  departmentId: "dept-eng",
  departmentName: "Engineering",
});
const acctB = makeAccount(2, {
  teamId: "team-b",
  teamName: "B",
  departmentId: "dept-eng",
  departmentName: "Engineering",
});
const acctC = makeAccount(3, {
  teamId: "team-c",
  teamName: "C",
  departmentId: "dept-ops",
  departmentName: "Ops",
});
const acctM = makeAccount(4, {
  teamId: "team-m",
  teamName: "M",
  departmentId: "dept-ops",
  departmentName: "Ops",
});

function rollups(costC = 41) {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
  return days.flatMap((date, i) => [
    buildRollup({
      date,
      accountId: acctA.accountId,
      teamId: "team-a",
      teamName: "A",
      departmentId: "dept-eng",
      departmentName: "Engineering",
      models: {
        "claude-sonnet": {
          cost: 11,
          byUser: { "a1@company.com": 7, "a2@company.com": 4 },
        },
      },
    }),
    buildRollup({
      date,
      accountId: acctB.accountId,
      teamId: "team-b",
      teamName: "B",
      departmentId: "dept-eng",
      departmentName: "Engineering",
      models: {
        "claude-sonnet": { cost: 23, byUser: { "b1@company.com": 23 } },
      },
    }),
    buildRollup({
      date,
      accountId: acctC.accountId,
      teamId: "team-c",
      teamName: "C",
      departmentId: "dept-ops",
      departmentName: "Ops",
      models: {
        "claude-sonnet": { cost: costC, byUser: { "c1@company.com": costC } },
      },
    }),
    buildRollup({
      date,
      accountId: acctM.accountId,
      teamId: "team-m",
      teamName: "M",
      departmentId: i < 2 ? "dept-eng" : "dept-ops",
      departmentName: i < 2 ? "Engineering" : "Ops",
      models: { "claude-sonnet": { cost: 5, byUser: { "m1@company.com": 5 } } },
    }),
  ]);
}

const oid = (n: number) => `00000000-0000-4000-8000-0000000001${n}0`;
const CALLERS = {
  viewerNone: {
    oid: oid(1),
    email: "v0@company.com",
    roles: ["internal-viewer"],
  },
  memberA: { oid: oid(2), email: "a1@company.com", roles: ["internal-viewer"] },
  memberB: { oid: oid(3), email: "b1@company.com", roles: ["internal-viewer"] },
  teamAdminA: {
    oid: oid(4),
    email: "ta@company.com",
    roles: ["internal-viewer"],
  },
  deptAdminEng: {
    oid: oid(5),
    email: "da@company.com",
    roles: ["internal-viewer"],
  },
  orgAdmin: {
    oid: oid(6),
    email: "oa@company.com",
    roles: ["internal-org-admin"],
  },
  auditor: {
    oid: oid(7),
    email: "au@company.com",
    roles: ["internal-auditor"],
  },
  admin: { oid: oid(8), email: "ad@company.com", roles: ["internal-admin"] },
} as const;
type CallerName = keyof typeof CALLERS;

function signInAs(name: CallerName | "master" | null) {
  const mock = auth as unknown as ReturnType<typeof vi.fn>;
  if (name === null) return mock.mockResolvedValue(null);
  if (name === "master") {
    return mock.mockResolvedValue({
      user: {
        oid: "master:root",
        roles: ["internal-admin"],
        authMethod: "master",
      },
    });
  }
  const c = CALLERS[name];
  return mock.mockResolvedValue({
    user: {
      oid: c.oid,
      email: c.email,
      roles: [...c.roles],
      tid: "t",
      authMethod: "entra",
    },
  });
}

async function get(handler: unknown, path: string, id?: string) {
  const params: Record<string, string> = id === undefined ? {} : { id };
  const res = await (handler as Handler)(
    new Request(`http://localhost${path}`),
    { params: Promise.resolve(params) },
  );
  return { res, body: await res.json() };
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await loadFixtures({
    accounts: [acctA, acctB, acctC, acctM],
    rollups: rollups(),
  });
  const ctx = ctxAt();
  ok(await addMember({ oid: CALLERS.memberA.oid, teamId: "team-a" }, ctx));
  ok(await addMember({ oid: CALLERS.memberB.oid, teamId: "team-b" }, ctx));
  ok(
    await grantAdminScope(
      { oid: CALLERS.teamAdminA.oid, scopeType: "team", scopeId: "team-a" },
      ctx,
    ),
  );
  ok(
    await grantAdminScope(
      {
        oid: CALLERS.deptAdminEng.oid,
        scopeType: "department",
        scopeId: "dept-eng",
      },
      ctx,
    ),
  );
});

const teamIds = async () =>
  (await get(getTeams, `/api/teams?${RANGE}`)).body.data.teams
    .map((t: { teamId: string }) => t.teamId)
    .sort();

describe("lists contain only in-scope rows (role x route)", () => {
  it.each([
    ["viewerNone", []],
    ["memberA", ["team-a"]],
    ["memberB", ["team-b"]],
    ["teamAdminA", ["team-a"]],
    // team-m belongs to dept-eng on 2 of the 3 days only (W3).
    ["deptAdminEng", ["team-a", "team-b", "team-m"]],
    ["orgAdmin", ["team-a", "team-b", "team-c", "team-m"]],
    ["auditor", ["team-a", "team-b", "team-c", "team-m"]],
    ["admin", ["team-a", "team-b", "team-c", "team-m"]],
    ["master", ["team-a", "team-b", "team-c", "team-m"]],
  ] as const)("GET /api/teams as %s", async (name, expected) => {
    signInAs(name);
    expect(await teamIds()).toEqual([...expected]);
  });

  it("a department-scope holder totals the moved team only for its days in the department", async () => {
    signInAs("deptAdminEng");
    const { body } = await get(getTeams, `/api/teams?${RANGE}`);
    const m = body.data.teams.find(
      (t: { teamId: string }) => t.teamId === "team-m",
    );
    expect(m.cost).toBe(10);
  });

  it("usage data alone grants nothing (T6): a viewer whose email is in byUser sees no team", async () => {
    signInAs("viewerNone");
    const { body } = await get(getUsers, `/api/users?${RANGE}`);
    expect(body.data.users).toEqual([]);
    expect(
      (await get(getOverview, `/api/overview?${RANGE}`)).body.data.totalCost,
    ).toBe(0);
  });

  it("a removed affiliation grants nothing on the next request", async () => {
    signInAs("memberA");
    expect(await teamIds()).toEqual(["team-a"]);
    ok(
      await removeMember(
        { oid: CALLERS.memberA.oid, teamId: "team-a", version: 1 },
        ctxAt(undefined, "req-2"),
      ),
    );
    expect(await teamIds()).toEqual([]);
  });

  it("per-user rows: member sees only own row at the default user level", async () => {
    signInAs("memberA");
    const { body } = await get(getUsers, `/api/users?${RANGE}`);
    expect(body.data.users.map((u: { userId: string }) => u.userId)).toEqual([
      "a1@company.com",
    ]);
  });

  it("services route is scoped too", async () => {
    signInAs("viewerNone");
    expect(
      (await get(getServices, `/api/services?${RANGE}`)).body.data.services,
    ).toEqual([]);
  });
});

describe("404 parity for details (T15)", () => {
  it("out-of-scope team detail has the same status and body as a missing one", async () => {
    signInAs("memberA");
    const out = await get(
      getTeamDetail,
      `/api/teams/team-b?${RANGE}`,
      "team-b",
    );
    const missing = await get(
      getTeamDetail,
      `/api/teams/team-zzz?${RANGE}`,
      "team-zzz",
    );
    expect(out.res.status).toBe(404);
    expect(missing.res.status).toBe(404);
    expect(out.body).toEqual(missing.body);
    const own = await get(
      getTeamDetail,
      `/api/teams/team-a?${RANGE}`,
      "team-a",
    );
    expect(own.res.status).toBe(200);
  });

  it("out-of-scope department detail matches a missing one; hidden department too", async () => {
    signInAs("memberA");
    const hidden = await get(
      getDepartmentDetail,
      `/api/departments/dept-eng?${RANGE}`,
      "dept-eng",
    );
    const other = await get(
      getDepartmentDetail,
      `/api/departments/dept-ops?${RANGE}`,
      "dept-ops",
    );
    const missing = await get(
      getDepartmentDetail,
      `/api/departments/dept-zzz?${RANGE}`,
      "dept-zzz",
    );
    expect(hidden.res.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
    expect(other.body).toEqual(missing.body);
  });

  it("a department scope reads its department detail; a hidden team is gone for its member", async () => {
    signInAs("deptAdminEng");
    expect(
      (
        await get(
          getDepartmentDetail,
          `/api/departments/dept-eng?${RANGE}`,
          "dept-eng",
        )
      ).res.status,
    ).toBe(200);
    ok(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "hidden",
          userLevel: "own",
          version: null,
        },
        ctxAt(undefined, "req-3"),
      ),
    );
    signInAs("memberA");
    const res = await get(
      getTeamDetail,
      `/api/teams/team-a?${RANGE}`,
      "team-a",
    );
    expect(res.res.status).toBe(404);
  });
});

function numbersIn(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === "number") out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => numbersIn(v, out));
  }
  return out;
}

async function snapshotAll(): Promise<unknown[]> {
  const q = RANGE;
  const calls = [
    get(getOverview, `/api/overview?${q}`),
    get(getTeams, `/api/teams?${q}`),
    get(getServices, `/api/services?${q}`),
    get(getUsers, `/api/users?${q}`),
    get(getDepartments, `/api/departments?${q}`),
    get(getRanking, `/api/ranking?${q}&tab=teams`),
    get(getRanking, `/api/ranking?${q}&tab=departments`),
  ];
  return (await Promise.all(calls)).map((r) => r.body);
}

describe("aggregates after filtering (T12)", () => {
  it.each([
    "viewerNone",
    "memberA",
    "memberB",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s sees identical numbers when out-of-scope team-c cost changes",
    async (name) => {
      signInAs(name);
      const before = await snapshotAll();
      const { resetFakeCache } = await import("@/test/next-cache-fake");
      resetFakeCache();
      await loadFixtures({ rollups: rollups(97) });
      expect(await snapshotAll()).toEqual(before);
    },
  );

  it("memberA is unaffected when team-b (a sibling team) changes", async () => {
    signInAs("memberA");
    const before = await snapshotAll();
    const { resetFakeCache } = await import("@/test/next-cache-fake");
    resetFakeCache();
    await loadFixtures({
      rollups: rollups().map((r) =>
        r.teamId === "team-b"
          ? buildRollup({
              date: r.date,
              accountId: r.accountId,
              teamId: "team-b",
              teamName: "B",
              models: {
                "claude-sonnet": {
                  cost: 999,
                  byUser: { "b1@company.com": 999 },
                },
              },
            })
          : r,
      ),
    });
    expect(await snapshotAll()).toEqual(before);
  });
});

describe("department total cannot be reconstructed when hidden (T13)", () => {
  it("memberA sees no number equal to a sibling team or the department total", async () => {
    signInAs("memberA");
    const departments = await get(getDepartments, `/api/departments?${RANGE}`);
    expect(departments.body.data.departments).toEqual([]);
    const seen = new Set<number>();
    for (const body of await snapshotAll()) numbersIn(body, seen);
    // dept-eng total 112 (33 + 69 + 10), team-b 69, team-a + team-b 102.
    for (const forbidden of [112, 69, 102, 23])
      expect(seen.has(forbidden)).toBe(false);
    const ranking = await get(
      getRanking,
      `/api/ranking?${RANGE}&tab=departments`,
    );
    expect(ranking.body.data.rows).toEqual([]);
  });

  it("once department level is visible the member sees the department total", async () => {
    ok(
      await putDepartmentVisibility(
        {
          departmentId: "dept-eng",
          departmentLevel: "visible",
          maxUserLevel: "own",
          version: null,
        },
        ctxAt(undefined, "req-4"),
      ),
    );
    signInAs("memberA");
    const { body } = await get(getDepartments, `/api/departments?${RANGE}`);
    expect(
      body.data.departments.map(
        (d: { departmentId: string }) => d.departmentId,
      ),
    ).toEqual(["dept-eng"]);
  });
});

describe("caching cannot leak (T14)", () => {
  it("callers with different scopes back to back never see each other's rows", async () => {
    const order: CallerName[] = [
      "memberA",
      "orgAdmin",
      "memberB",
      "viewerNone",
      "memberA",
      "deptAdminEng",
    ];
    const expected: Record<string, string[]> = {
      memberA: ["team-a"],
      orgAdmin: ["team-a", "team-b", "team-c", "team-m"],
      memberB: ["team-b"],
      viewerNone: [],
      deptAdminEng: ["team-a", "team-b", "team-m"],
    };
    for (const name of order) {
      signInAs(name);
      expect(await teamIds()).toEqual(expected[name]);
    }
  });

  it("authorization changes apply on the next request (never cached)", async () => {
    signInAs("memberA");
    expect(await teamIds()).toEqual(["team-a"]);
    ok(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "hidden",
          userLevel: "own",
          version: null,
        },
        ctxAt(undefined, "req-5"),
      ),
    );
    expect(await teamIds()).toEqual([]);
  });
});
