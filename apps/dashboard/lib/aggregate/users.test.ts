import { describe, expect, it } from "vitest";

import { buildRollup } from "@/test/fixtures/rollup-builder";

import { aggregateUsers } from "./users";

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas"
// (`UsersResponseSchema`: one row per team and user, the team's latest team
// and department names, decided 2026-11-06) and "Non-model cost is
// account-level only"; implementation-phases Phase 4.8; Rules 20.3, 20.12.
const acct = (n: number) => String(n).padStart(12, "0");

const LEDGER = {
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
};

const sonnet = (byUser: Record<string, number>) => ({
  "claude-sonnet": {
    cost: Object.values(byUser).reduce((a, b) => a + b, 0),
    byUser,
  },
});

describe("aggregateUsers -- one row per (team, user)", () => {
  it("merges a team's user across its accounts, models and days", () => {
    const rows = aggregateUsers([
      buildRollup({
        date: "2026-10-01",
        accountId: acct(1),
        models: {
          "claude-sonnet": { cost: 4, byUser: { "a@x.com": 4 } },
          "claude-haiku": { cost: 1, byUser: { "a@x.com": 1 } },
        },
      }),
      buildRollup({
        date: "2026-10-01",
        accountId: acct(2),
        models: sonnet({ "a@x.com": 5 }),
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: acct(1),
        models: sonnet({ "a@x.com": 2 }),
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "a@x.com",
      teamId: "team-payments",
      teamName: "Payments",
      departmentId: "dept-engineering",
      departmentName: "Engineering",
      cost: 12,
      costEstimated: true,
      inputTokens: 400,
      outputTokens: 200,
      invocations: 4,
    });
  });

  it("returns two rows when one user is in two teams", () => {
    const rows = aggregateUsers([
      buildRollup({ date: "2026-10-01", models: sonnet({ "a@x.com": 3 }) }),
      buildRollup({
        date: "2026-10-01",
        accountId: acct(3),
        ...LEDGER,
        models: sonnet({ "a@x.com": 8 }),
      }),
    ]);

    expect(rows.map((r) => [r.userId, r.teamId, r.cost])).toEqual([
      ["a@x.com", "team-ledger", 8],
      ["a@x.com", "team-payments", 3],
    ]);
    expect(rows[0]).toMatchObject({
      teamName: "Ledger",
      departmentId: "dept-finance",
      departmentName: "Finance",
    });
  });

  it("uses the team's latest team and department names in the range", () => {
    const rows = aggregateUsers([
      buildRollup({
        date: "2026-10-01",
        teamName: "Old Team Name",
        departmentId: "dept-old",
        departmentName: "Old Dept",
        models: sonnet({ "a@x.com": 1 }),
      }),
      buildRollup({
        date: "2026-10-03",
        teamName: "New Team Name",
        departmentId: "dept-new",
        departmentName: "New Dept",
        models: sonnet({ "a@x.com": 1 }),
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamName: "New Team Name",
      departmentId: "dept-new",
      departmentName: "New Dept",
      cost: 2,
    });
  });

  it("sorts by cost descending", () => {
    const rows = aggregateUsers([
      buildRollup({
        date: "2026-10-01",
        models: sonnet({ "s@x.com": 1, "b@x.com": 9, "m@x.com": 5 }),
      }),
    ]);
    expect(rows.map((r) => r.userId)).toEqual([
      "b@x.com",
      "m@x.com",
      "s@x.com",
    ]);
  });

  it("breaks cost ties by userId then teamId ascending", () => {
    const rows = aggregateUsers([
      buildRollup({
        date: "2026-10-01",
        models: sonnet({ "b@x.com": 2, "a@x.com": 2 }),
      }),
      buildRollup({
        date: "2026-10-01",
        accountId: acct(3),
        ...LEDGER,
        models: sonnet({ "a@x.com": 2 }),
      }),
    ]);
    expect(rows.map((r) => [r.userId, r.teamId])).toEqual([
      ["a@x.com", "team-ledger"],
      ["a@x.com", "team-payments"],
      ["b@x.com", "team-payments"],
    ]);
  });

  it("groups by each rollup's own teamId: an account that changes team mid-range feeds both teams", () => {
    const rows = aggregateUsers([
      buildRollup({
        date: "2026-10-01",
        accountId: acct(1),
        models: sonnet({ "a@x.com": 3 }),
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: acct(1),
        ...LEDGER,
        models: sonnet({ "a@x.com": 7 }),
      }),
    ]);
    expect(rows.map((r) => [r.teamId, r.cost])).toEqual([
      ["team-ledger", 7],
      ["team-payments", 3],
    ]);
  });

  it("excludes non-model cost and marks every row estimated", () => {
    const rows = aggregateUsers([
      buildRollup({
        date: "2026-10-01",
        models: sonnet({ "a@x.com": 5 }),
        nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
      }),
      buildRollup({
        date: "2026-10-02",
        models: {},
        nonModel: { guardrails: { cost: 7, recurring: false } },
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cost).toBe(5);
    expect(rows.every((r) => r.costEstimated === true)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("provisioned-throughput");
  });

  it("returns an empty array for no rollups", () => {
    expect(aggregateUsers([])).toEqual([]);
  });
});
