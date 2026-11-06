import { describe, expect, it } from "vitest";

import { buildRollup } from "@/test/rollup-builder";

import { aggregateServices } from "./services";

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas"
// (`ServicesResponseSchema`: one row per team and service, the team's latest
// team and department names, decided 2026-11-06) and "Non-model cost is
// account-level only"; implementation-phases Phase 4.7; Rules 20.3, 20.10,
// 20.12.
const acct = (n: number) => String(n).padStart(12, "0");

const LEDGER = {
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
};

const sonnet = (byService: Record<string, number>) => ({
  "claude-sonnet": {
    cost: Object.values(byService).reduce((a, b) => a + b, 0),
    byService,
  },
});

describe("aggregateServices -- one row per (team, service)", () => {
  it("merges a team's service across its accounts, models and days", () => {
    const rows = aggregateServices([
      buildRollup({
        date: "2026-10-01",
        accountId: acct(1),
        models: {
          "claude-sonnet": { cost: 4, byService: { "payments-api": 4 } },
          "claude-haiku": { cost: 1, byService: { "payments-api": 1 } },
        },
      }),
      buildRollup({
        date: "2026-10-01",
        accountId: acct(2),
        models: sonnet({ "payments-api": 5 }),
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: acct(1),
        models: sonnet({ "payments-api": 2 }),
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serviceName: "payments-api",
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

  it("returns two rows when the same service name is used by two teams", () => {
    const rows = aggregateServices([
      buildRollup({
        date: "2026-10-01",
        models: sonnet({ shared: 3 }),
      }),
      buildRollup({
        date: "2026-10-01",
        accountId: acct(3),
        ...LEDGER,
        models: sonnet({ shared: 8 }),
      }),
    ]);

    expect(rows.map((r) => [r.serviceName, r.teamId, r.cost])).toEqual([
      ["shared", "team-ledger", 8],
      ["shared", "team-payments", 3],
    ]);
    expect(rows[0]).toMatchObject({
      teamName: "Ledger",
      departmentId: "dept-finance",
      departmentName: "Finance",
    });
  });

  it("uses the team's latest team and department names in the range", () => {
    const rows = aggregateServices([
      buildRollup({
        date: "2026-10-01",
        teamName: "Old Team Name",
        departmentId: "dept-old",
        departmentName: "Old Dept",
        models: sonnet({ api: 1 }),
      }),
      buildRollup({
        date: "2026-10-03",
        teamName: "New Team Name",
        departmentId: "dept-new",
        departmentName: "New Dept",
        models: sonnet({ api: 1 }),
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

  it("keeps each team's _untagged bucket as its own row", () => {
    const rows = aggregateServices([
      buildRollup({
        date: "2026-10-01",
        models: sonnet({ _untagged: 2, api: 5 }),
      }),
      buildRollup({
        date: "2026-10-01",
        accountId: acct(3),
        ...LEDGER,
        models: sonnet({ _untagged: 4 }),
      }),
    ]);

    const untagged = rows.filter((r) => r.serviceName === "_untagged");
    expect(untagged.map((r) => [r.teamId, r.cost])).toEqual([
      ["team-ledger", 4],
      ["team-payments", 2],
    ]);
  });

  it("sorts by cost descending", () => {
    const rows = aggregateServices([
      buildRollup({
        date: "2026-10-01",
        models: sonnet({ small: 1, big: 9, mid: 5 }),
      }),
    ]);
    expect(rows.map((r) => r.serviceName)).toEqual(["big", "mid", "small"]);
  });

  it("breaks cost ties by serviceName then teamId ascending", () => {
    const rows = aggregateServices([
      buildRollup({
        date: "2026-10-01",
        models: sonnet({ beta: 2, alpha: 2 }),
      }),
      buildRollup({
        date: "2026-10-01",
        accountId: acct(3),
        ...LEDGER,
        models: sonnet({ alpha: 2 }),
      }),
    ]);
    expect(rows.map((r) => [r.serviceName, r.teamId])).toEqual([
      ["alpha", "team-ledger"],
      ["alpha", "team-payments"],
      ["beta", "team-payments"],
    ]);
  });

  it("groups by each rollup's own teamId: an account that changes team mid-range feeds both teams", () => {
    const rows = aggregateServices([
      buildRollup({
        date: "2026-10-01",
        accountId: acct(1),
        models: sonnet({ api: 3 }),
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: acct(1),
        ...LEDGER,
        models: sonnet({ api: 7 }),
      }),
    ]);
    expect(rows.map((r) => [r.teamId, r.cost])).toEqual([
      ["team-ledger", 7],
      ["team-payments", 3],
    ]);
  });

  it("excludes non-model cost and marks every row estimated", () => {
    const rows = aggregateServices([
      buildRollup({
        date: "2026-10-01",
        models: sonnet({ api: 5 }),
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
    expect(aggregateServices([])).toEqual([]);
  });
});
