import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  putDepartmentVisibility,
  putTeamVisibility,
} from "@/lib/data/access/visibility";
import { ctxAt, ok } from "@/test/support/access-test-support";
import {
  CALLERS,
  get,
  seedOrg,
  signInAs,
} from "@/test/fixtures/scope-fixtures";
import {
  PEOPLE,
  RANGE_Q,
  seedLedger,
} from "@/test/support/budget-reset-support";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { GET } from "./route";

// Sources: LiteLLM spec - MG-D9 (what counts: a reset a person triggered
// through the dashboard, within the selected UTC date range, 90-day cap),
// MG-D10 (a user sees their own; a Lead the teams in its scope, per team and
// per member; Admin, org-admin and Auditor every team; one scoped read route
// filtered after the read); Data Model - API Routes (`GET /api/budget-resets`:
// `{ teams: [{ teamId, count, amount, members? }], own: { count, amount } }`);
// Access Control - role table (`GET /api/budget-resets`) and BR10 (a user
// never sees another person's, a Lead never another team's); Rule 20.1
// (UTC), Rule 20.8 (90-day cap). 401, 400 shape and no-store are the shared
// route-contract suite's (Rule 60.23). The prod-only per-user cap is in
// route.prod-gate.integration.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await seedOrg();
  // Per-member rows follow the visibility rules: min(department cap, team
  // level) must be `all` (Access Control - Visibility and inheritance).
  ok(
    await putDepartmentVisibility(
      {
        departmentId: "dept-eng",
        departmentLevel: "visible",
        maxUserLevel: "all",
        version: null,
      },
      ctxAt(undefined, "req-vis-dept"),
    ),
  );
  for (const teamId of ["team-a", "team-b"]) {
    ok(
      await putTeamVisibility(
        { teamId, teamLevel: "visible", userLevel: "all", version: null },
        ctxAt(undefined, `req-vis-${teamId}`),
      ),
    );
  }
  await seedLedger();
});

type Counts = {
  teams: {
    teamId: string;
    count: number;
    amount: number;
    members?: { oid: string; count: number; amount: number }[];
  }[];
  own: { count: number; amount: number };
};
async function counts(query = RANGE_Q) {
  const { res, body } = await get(GET, `/api/budget-resets?${query}`);
  return {
    status: res.status,
    data: body.data as Counts,
    text: JSON.stringify(body),
  };
}
const teamIds = (c: Counts) => c.teams.map((t) => t.teamId);
const team = (c: Counts, id: string) => c.teams.find((t) => t.teamId === id);

describe("GET /api/budget-resets: a user sees their own count and amount only (MG-D10, BR10)", () => {
  it.each([
    ["memberA", { count: 2, amount: 7.25 }],
    ["memberB", { count: 1, amount: 2 }],
    ["viewerNone", { count: 0, amount: 0 }],
  ] as const)("%s: own %j, no team rows, no other person", async (who, own) => {
    signInAs(who);
    const { status, data, text } = await counts();
    expect(status).toBe(200);
    expect(data.own).toEqual(own);
    expect(data.teams).toEqual([]);
    for (const other of [
      PEOPLE.alice.oid,
      PEOPLE.carol.oid,
      ...(who === "memberA" ? [] : [CALLERS.memberA.oid]),
      ...(who === "memberB" ? [] : [CALLERS.memberB.oid]),
    ]) {
      expect(text, `${who} must not see ${other}`).not.toContain(other);
    }
  });
});

describe("GET /api/budget-resets: a Lead sees the teams in scope, never another team's (MG-D10, BR10)", () => {
  it("a team Lead gets team-a with per-team totals and per-member rows, and nothing of team-b or team-c", async () => {
    signInAs("teamAdminA");
    const { data, text } = await counts();
    expect(teamIds(data)).toEqual(["team-a"]);
    expect(team(data, "team-a")).toMatchObject({ count: 3, amount: 12.25 });
    expect(team(data, "team-a")?.members).toEqual([
      { oid: CALLERS.memberA.oid, count: 2, amount: 7.25 },
      { oid: PEOPLE.alice.oid, count: 1, amount: 5 },
    ]);
    expect(data.own).toEqual({ count: 0, amount: 0 });
    for (const other of [CALLERS.memberB.oid, PEOPLE.carol.oid]) {
      expect(text).not.toContain(other);
    }
  });

  it("a department Lead gets the department's teams (team-a, team-b) and not team-c", async () => {
    signInAs("deptAdminEng");
    const { data, text } = await counts();
    expect(
      teamIds(data).filter((id) => ["team-a", "team-b", "team-c"].includes(id)),
    ).toEqual(["team-a", "team-b"]);
    expect(team(data, "team-b")).toMatchObject({ count: 1, amount: 2 });
    expect(text).not.toContain(PEOPLE.carol.oid);
  });

  it("asking a Lead's route for a team outside their scope returns nothing of it", async () => {
    signInAs("teamAdminA");
    const { status, data, text } = await counts(`${RANGE_Q}&teamId=team-b`);
    expect(status).toBe(200);
    expect(teamIds(data)).not.toContain("team-b");
    expect(text).not.toContain(CALLERS.memberB.oid);
  });
});

describe("GET /api/budget-resets: per-member rows follow the visibility rules (MG-D10)", () => {
  it("with the default visibility (user level own) a Lead gets team totals and no per-member rows; a global role still does (only the organisation cap limits it)", async () => {
    await clearTable();
    await seedOrg();
    await seedLedger();
    signInAs("teamAdminA");
    const lead = await counts();
    expect(team(lead.data, "team-a")).toMatchObject({
      count: 3,
      amount: 12.25,
    });
    expect(team(lead.data, "team-a")?.members).toBeUndefined();
    expect(lead.text).not.toContain(PEOPLE.alice.oid);
    signInAs("admin");
    const admin = await counts();
    expect(team(admin.data, "team-a")?.members).toHaveLength(2);
  });
});

describe("GET /api/budget-resets: Admin, org-admin and Auditor see every team (MG-D10)", () => {
  it.each(["admin", "orgAdmin", "auditor"] as const)("%s", async (who) => {
    signInAs(who);
    const { status, data } = await counts();
    expect(status).toBe(200);
    expect(team(data, "team-a")).toMatchObject({ count: 3, amount: 12.25 });
    expect(team(data, "team-b")).toMatchObject({ count: 1, amount: 2 });
    expect(team(data, "team-c")).toMatchObject({ count: 1, amount: 7 });
  });

  it("the teamId filter narrows to one team", async () => {
    signInAs("admin");
    const { data } = await counts(`${RANGE_Q}&teamId=team-c`);
    expect(teamIds(data)).toEqual(["team-c"]);
  });
});

describe("GET /api/budget-resets: the date range (MG-D9; Rule 20.1, 20.8)", () => {
  it("counts by UTC day, inclusive of the last second of dateTo, and not the day before or after", async () => {
    signInAs("admin");
    const { data } = await counts("dateFrom=2026-11-14&dateTo=2026-11-14");
    expect(team(data, "team-a")).toMatchObject({ count: 1, amount: 4 });
    const none = await counts("dateFrom=2026-11-15&dateTo=2026-11-15");
    expect(team(none.data, "team-a")).toMatchObject({ count: 1, amount: 100 });
    const before = await counts("dateFrom=2026-10-31&dateTo=2026-10-31");
    expect(team(before.data, "team-a")).toMatchObject({
      count: 1,
      amount: 100,
    });
  });

  it("accepts a 90-day range and refuses 91 days with 400 (cap)", async () => {
    signInAs("admin");
    expect((await counts("dateFrom=2026-08-01&dateTo=2026-10-29")).status).toBe(
      200,
    );
    const over = await get(
      GET,
      "/api/budget-resets?dateFrom=2026-08-01&dateTo=2026-10-30",
    );
    expect(over.res.status).toBe(400);
  });
});
