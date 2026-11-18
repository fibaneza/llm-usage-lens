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
import { RANGE_Q, seedLedger } from "@/test/support/budget-reset-support";
import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

import { GET } from "./route";

// Sources: LiteLLM spec - MG-D10 ("per-member counts are per-user data: until
// the per-user approval is given in `prod` only team totals show (user,
// 2026-11-17, Q6), and they follow the visibility rules"); Access Control -
// "Visibility and inheritance" (the per-user approval gate, APP_ENV=prod,
// GOVERNANCE/PER_USER) and BR10 ("per-member figures only with the per-user
// approval in prod"). Mirrors scoping-prod-gate.integration.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
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

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await seedOrg();
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
  await seedLedger();
});

type Data = {
  teams: {
    teamId: string;
    count: number;
    amount: number;
    members?: unknown[];
  }[];
  own: { count: number; amount: number };
};
const read = async () =>
  (await get(GET, `/api/budget-resets?${RANGE_Q}`)).body.data as Data;

describe("GET /api/budget-resets in prod without the per-user approval (MG-D10, BR10)", () => {
  it.each(["admin", "orgAdmin", "auditor", "teamAdminA"] as const)(
    "%s sees team totals and no per-member rows",
    async (who) => {
      signInAs(who);
      const data = await read();
      const a = data.teams.find((t) => t.teamId === "team-a");
      expect(a).toMatchObject({ count: 3, amount: 12.25 });
      expect(a?.members).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain(CALLERS.memberA.oid);
    },
  );

  it("a user still sees their own count and amount (everyone always sees their own usage)", async () => {
    signInAs("memberA");
    expect((await read()).own).toEqual({ count: 2, amount: 7.25 });
  });

  it("recording the approval adds the per-member rows", async () => {
    await putRaw({
      PK: "GOVERNANCE",
      SK: "PER_USER",
      approvedBy: CALLERS.admin.oid,
      approvedAt: "2026-11-14T10:00:00.000Z",
      reference: "works-council-1",
      version: 1,
    });
    signInAs("admin");
    const a = (await read()).teams.find((t) => t.teamId === "team-a");
    expect(a?.members).toHaveLength(2);
  });
});
