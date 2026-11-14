import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { putTeamVisibility } from "@/lib/data/access/visibility";
import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import { CALLERS, RANGE, get, seedOrg, signInAs } from "@/test/scope-fixtures";
import { clearTable, ensureTestTable, putRaw } from "@/test/test-support";

import { GET as getTeams } from "./teams/route";
import { GET as getUsers } from "./users/route";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (organisation cap = the per-user approval gate, APP_ENV=prod),
// threat T16. Until an internal-admin records the approval every caller sees
// per-user counts only and user level is capped at own; everyone always sees
// their own usage. Approval item: GOVERNANCE/PER_USER.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});
vi.mock("@/env", async (orig) => {
  const actual = await orig<typeof import("@/env")>();
  return {
    env: new Proxy(actual.env, {
      get: (target, prop, receiver) =>
        prop === "APP_ENV" ? "prod" : Reflect.get(target, prop, receiver),
    }),
  };
});

const userIds = async () =>
  (
    (await get(getUsers, `/api/users?${RANGE}`)).body.data as {
      users: { userId: string }[];
    }
  ).users
    .map((u) => u.userId)
    .sort();

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await seedOrg();
  ok(
    await putTeamVisibility(
      {
        teamId: "team-a",
        teamLevel: "visible",
        userLevel: "all",
        version: null,
      },
      ctxAt(undefined, "req-vis"),
    ),
  );
});

describe("per-user approval gate in prod (T16)", () => {
  it.each(["admin", "orgAdmin", "auditor"] as const)(
    "%s sees only their own per-user rows until the approval exists",
    async (name) => {
      signInAs(name);
      expect(await userIds()).toEqual([]);
      signInAs(name, "b1@company.com");
      expect(await userIds()).toEqual(["b1@company.com"]);
    },
  );

  it("a team admin is capped at own even with team user level all", async () => {
    signInAs("teamAdminA");
    expect(await userIds()).toEqual([]);
  });

  it("per-user counts stay visible while rows are capped", async () => {
    for (const name of ["admin", "teamAdminA"] as const) {
      signInAs(name);
      const { body } = await get(getTeams, `/api/teams?${RANGE}`);
      const rows = (
        body.data as { teams: { teamId: string; userCount: number }[] }
      ).teams;
      expect(rows.find((t) => t.teamId === "team-a")?.userCount).toBe(2);
    }
  });

  it("recording the approval lifts the cap", async () => {
    await putRaw({
      PK: "GOVERNANCE",
      SK: "PER_USER",
      approvedBy: CALLERS.admin.oid,
      approvedAt: "2026-11-14T10:00:00.000Z",
      reference: "works-council-1",
      version: 1,
    });
    signInAs("admin");
    expect(await userIds()).toEqual([
      "a1@company.com",
      "a2@company.com",
      "b1@company.com",
      "c1@company.com",
      "m1@company.com",
    ]);
  });
});
