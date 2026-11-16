import { describe, expect, it } from "vitest";

import { buildRollup } from "@/test/rollup-builder";

import { aggregateDepartmentDetail } from "./departments";
import { aggregateOverview } from "./overview";
import { splitCosts } from "./non-model";
import { rankEntities } from "./ranking";
import { aggregateTeamDetail, aggregateTeams } from "./teams";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: docs/specs/2026-05-15-data-model.md — "In-Memory Aggregation",
// "Non-Model Charges / Dashboard impact (v1)"; Rule 20.3, 20.7, 20.12.
const FIN = {
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
  accountId: acct(3),
};

const rollups = [
  buildRollup({
    date: "2026-10-01",
    models: {
      "claude-sonnet": {
        cost: 10,
        byUser: { "a@x.com": 6, "b@x.com": 4 },
        byService: { "payments-api": 7, _untagged: 3 },
      },
      "claude-haiku": { cost: 2, byUser: { "a@x.com": 2 } },
    },
    nonModel: { guardrails: { cost: 1, recurring: false } },
  }),
  buildRollup({
    date: "2026-10-02",
    accountId: acct(2),
    models: {
      "claude-sonnet": {
        cost: 5,
        byUser: { "a@x.com": 5 },
        byService: { "payments-api": 5 },
      },
    },
  }),
  buildRollup({
    date: "2026-10-02",
    ...FIN,
    models: {
      "claude-opus": {
        cost: 30,
        inputTokens: 5000,
        byUser: { "c@x.com": 30 },
        byService: { "ledger-svc": 30 },
      },
    },
  }),
  // Idle Provisioned-Throughput day: no models, still costs money.
  buildRollup({
    date: "2026-10-03",
    ...FIN,
    models: {},
    nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
  }),
];

describe("splitCosts", () => {
  it("separates model from non-model cost with per-category recurring", () => {
    const r = splitCosts(rollups);
    expect(r.modelCost).toBeCloseTo(47);
    expect(r.nonModelCost).toBeCloseTo(21);
    expect(r.nonModelByCategory).toEqual(
      expect.arrayContaining([
        { category: "guardrails", cost: 1, recurring: false },
        { category: "provisioned-throughput", cost: 20, recurring: true },
      ]),
    );
    expect(r.nonModelByCategory).toHaveLength(2);
  });

  it("does not coerce absent nonModel into zero-cost categories", () => {
    const r = splitCosts([
      buildRollup({
        date: "2026-10-01",
        models: { "claude-sonnet": { cost: 3 } },
      }),
    ]);
    expect(r.nonModelByCategory).toEqual([]);
    expect(r.modelCost).toBe(3);
  });

  it("counts an idle PT day with models: {} as non-model cost", () => {
    const r = splitCosts([rollups[3]!]);
    expect(r.modelCost).toBe(0);
    expect(r.nonModelCost).toBe(20);
  });
});

describe("aggregateOverview", () => {
  it("totals KPIs so total = model + non-model", () => {
    const o = aggregateOverview(rollups);
    expect(o.totalCost).toBeCloseTo(68);
    expect(o.modelCost + o.nonModelCost).toBeCloseTo(o.totalCost);
    expect(o.inputTokens).toBe(8000);
    expect(o.invocations).toBe(8);
  });

  it("builds a UTC daily trend ordered by date, including idle PT days", () => {
    const o = aggregateOverview(rollups);
    expect(o.dailyTrend.map((d) => d.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(o.dailyTrend[1]).toMatchObject({
      cost: 35,
      modelCost: 35,
      nonModelCost: 0,
    });
    expect(o.dailyTrend[2]).toMatchObject({
      cost: 20,
      modelCost: 0,
      nonModelCost: 20,
    });
  });

  it("lists top departments by cost, limited by topN", () => {
    const o = aggregateOverview(rollups, { topN: 1 });
    expect(o.topDepartments).toEqual([
      { departmentId: "dept-finance", departmentName: "Finance", cost: 50 },
    ]);
  });

  // Data Model spec — "Historical Snapshots for Department/Team Names": a
  // renamed id shows the latest name in the requested range.
  it("shows the latest department name when it was renamed inside the range", () => {
    const renamed = (date: string, departmentName: string) =>
      buildRollup({
        date,
        accountId: acct(7),
        departmentId: "dept-renamed",
        departmentName,
        teamId: "team-renamed",
        teamName: "Renamed Team",
        models: { "claude-sonnet": { cost: 4 } },
      });
    const o = aggregateOverview([
      renamed("2026-10-01", "Old Dept"),
      renamed("2026-10-02", "Interim Dept"),
      renamed("2026-10-03", "New Dept"),
    ]);
    expect(o.topDepartments).toEqual([
      { departmentId: "dept-renamed", departmentName: "New Dept", cost: 12 },
    ]);
  });

  it("uses each department's own latest name when several are renamed", () => {
    const day = (
      date: string,
      departmentId: string,
      departmentName: string,
      cost: number,
    ) =>
      buildRollup({
        date,
        accountId: acct(8),
        departmentId,
        departmentName,
        teamId: `team-${departmentId}`,
        teamName: `Team ${departmentId}`,
        models: { "claude-sonnet": { cost } },
      });
    const o = aggregateOverview([
      day("2026-10-01", "dept-a", "A Old", 10),
      day("2026-10-01", "dept-b", "B Old", 3),
      day("2026-10-02", "dept-a", "A New", 10),
      day("2026-10-02", "dept-b", "B New", 3),
    ]);
    expect(o.topDepartments).toEqual([
      { departmentId: "dept-a", departmentName: "A New", cost: 20 },
      { departmentId: "dept-b", departmentName: "B New", cost: 6 },
    ]);
  });

  it("handles no rollups", () => {
    const o = aggregateOverview([]);
    expect(o.totalCost).toBe(0);
    expect(o.dailyTrend).toEqual([]);
    expect(o.topDepartments).toEqual([]);
    expect(o.nonModelByCategory).toEqual([]);
  });
});

describe("rankEntities", () => {
  const base = { order: "desc", limit: 10 } as const;

  it("ranks departments by cost desc with exact (not estimated) cost", () => {
    const rows = rankEntities(rollups, { ...base, tab: "departments" });
    expect(rows.map((r) => [r.id, r.cost])).toEqual([
      ["dept-finance", 50],
      ["dept-engineering", 18],
    ]);
    expect(rows[0]).toMatchObject({ name: "Finance", costEstimated: false });
  });

  it("ranks teams", () => {
    const rows = rankEntities(rollups, { ...base, tab: "teams" });
    expect(rows.map((r) => r.id)).toEqual(["team-ledger", "team-payments"]);
  });

  it("ranks users and services with costEstimated true and no non-model cost", () => {
    const users = rankEntities(rollups, { ...base, tab: "users" });
    expect(users.map((r) => [r.id, r.cost])).toEqual([
      ["c@x.com", 30],
      ["a@x.com", 13],
      ["b@x.com", 4],
    ]);
    expect(users.every((r) => r.costEstimated)).toBe(true);
    const services = rankEntities(rollups, { ...base, tab: "services" });
    expect(services.map((r) => r.id)).toEqual([
      "ledger-svc",
      "payments-api",
      "_untagged",
    ]);
    expect(services.reduce((s, r) => s + r.cost, 0)).toBeCloseTo(45);
  });

  it("sorts by another field and ascending, then applies limit", () => {
    const rows = rankEntities(rollups, {
      tab: "departments",
      sortBy: "inputTokens",
      order: "asc",
      limit: 1,
    });
    expect(rows.map((r) => r.id)).toEqual(["dept-engineering"]);
  });

  it("filters by model: only that model's cost counts", () => {
    const rows = rankEntities(rollups, {
      ...base,
      tab: "departments",
      model: "claude-haiku",
    });
    expect(rows.map((r) => [r.id, r.cost])).toEqual([["dept-engineering", 2]]);
    const users = rankEntities(rollups, {
      ...base,
      tab: "users",
      model: "claude-opus",
    });
    expect(users.map((r) => r.id)).toEqual(["c@x.com"]);
  });
});

describe("aggregateDepartments / aggregateTeams", () => {
  it("lists teams and filters by departmentId", () => {
    expect(aggregateTeams(rollups)).toHaveLength(2);
    const only = aggregateTeams(rollups, { departmentId: "dept-finance" });
    expect(only.map((t) => t.teamId)).toEqual(["team-ledger"]);
    expect(only[0]).toMatchObject({ departmentId: "dept-finance", cost: 50 });
  });
});

describe("aggregateDepartmentDetail / aggregateTeamDetail", () => {
  it("department detail carries split, categories, teams and trend", () => {
    const d = aggregateDepartmentDetail(rollups, "dept-finance");
    expect(d).toMatchObject({
      departmentId: "dept-finance",
      departmentName: "Finance",
      cost: 50,
      modelCost: 30,
      nonModelCost: 20,
    });
    expect(d.nonModelByCategory).toEqual([
      { category: "provisioned-throughput", cost: 20, recurring: true },
    ]);
    expect(d.teams.map((t) => t.teamId)).toEqual(["team-ledger"]);
    expect(d.dailyTrend.map((x) => x.date)).toEqual([
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("team detail lists its accounts", () => {
    const t = aggregateTeamDetail(rollups, "team-payments");
    expect(t).toMatchObject({
      teamId: "team-payments",
      teamName: "Payments",
      cost: 18,
    });
    expect(t.accounts.map((a) => a.accountId).sort()).toEqual([
      acct(1),
      acct(2),
    ]);
  });
});

describe("aggregateOverview per-model breakdown (Rule 20.12)", () => {
  it("byModel lists per-model totals, cost desc, never non-model", () => {
    const o = aggregateOverview(rollups);
    expect(o.byModel).toEqual([
      {
        model: "claude-opus",
        cost: 30,
        inputTokens: 5000,
        outputTokens: 500,
        invocations: 2,
      },
      {
        model: "claude-sonnet",
        cost: 15,
        inputTokens: 2000,
        outputTokens: 1000,
        invocations: 4,
      },
      {
        model: "claude-haiku",
        cost: 2,
        inputTokens: 1000,
        outputTokens: 500,
        invocations: 2,
      },
    ]);
    expect(o.byModel.some((m) => m.model === "other")).toBe(false);
    expect(o.byModel.reduce((sum, m) => sum + m.cost, 0)).toBeCloseTo(
      o.modelCost,
    );
  });

  it("each dailyTrend point carries byModel: Record<ModelKey, number> (partial, model cost only)", () => {
    const o = aggregateOverview(rollups);
    expect(o.dailyTrend.map((d) => d.byModel)).toEqual([
      { "claude-sonnet": 10, "claude-haiku": 2 },
      { "claude-sonnet": 5, "claude-opus": 30 },
      {},
    ]);
  });

  it("mostUsedModel is the model with most invocations, null when none", () => {
    expect(aggregateOverview(rollups).mostUsedModel).toBe("claude-sonnet");
    expect(aggregateOverview([]).mostUsedModel).toBeNull();
    expect(aggregateOverview([rollups[3]!]).mostUsedModel).toBeNull();
  });

  it("activeAccounts counts distinct accountIds with a rollup in range", () => {
    expect(aggregateOverview(rollups).activeAccounts).toBe(3);
    expect(aggregateOverview([]).activeAccounts).toBe(0);
  });

  it("empty input gives empty byModel", () => {
    expect(aggregateOverview([]).byModel).toEqual([]);
  });
});

describe("aggregateDepartmentDetail topUsers / teamTrend", () => {
  it("topUsers merges per-model attribution, estimated, cost desc", () => {
    const d = aggregateDepartmentDetail(rollups, "dept-engineering");
    expect(d.topUsers).toHaveLength(2);
    expect(d.topUsers[0]).toMatchObject({
      userId: "a@x.com",
      cost: 13,
      costEstimated: true,
    });
    expect(d.topUsers[1]).toMatchObject({
      userId: "b@x.com",
      cost: 4,
      costEstimated: true,
    });
  });

  it("topUsers excludes non-model cost and is capped at 10", () => {
    const many = buildRollup({
      date: "2026-10-01",
      models: {
        "claude-sonnet": {
          cost: 78,
          byUser: Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [`u${i}@x.com`, i + 1]),
          ),
        },
      },
      nonModel: { guardrails: { cost: 500, recurring: false } },
    });
    const d = aggregateDepartmentDetail([many], "dept-engineering");
    expect(d.topUsers).toHaveLength(10);
    expect(d.topUsers[0]).toMatchObject({ userId: "u11@x.com", cost: 12 });
    expect(d.topUsers.reduce((s, u) => s + u.cost, 0)).toBeLessThan(78);
  });

  it("teamTrend gives per-day per-team cost, date asc", () => {
    const d = aggregateDepartmentDetail(rollups, "dept-finance");
    expect(d.teamTrend).toEqual([
      { date: "2026-10-02", teams: [{ teamId: "team-ledger", cost: 30 }] },
      { date: "2026-10-03", teams: [{ teamId: "team-ledger", cost: 20 }] },
    ]);
  });
});

describe("aggregateTeamDetail services / users / byModel", () => {
  const t = aggregateTeamDetail(rollups, "team-payments");

  it("services are estimated model-usage attribution only", () => {
    expect(t.services.map((x) => [x.serviceName, x.cost])).toEqual([
      ["payments-api", 12],
      ["_untagged", 3],
    ]);
    expect(t.services.every((x) => x.costEstimated)).toBe(true);
  });

  it("users are estimated model-usage attribution only", () => {
    expect(t.users.map((x) => [x.userId, x.cost])).toEqual([
      ["a@x.com", 13],
      ["b@x.com", 4],
    ]);
    expect(t.users.every((x) => x.costEstimated)).toBe(true);
  });

  it("byModel breaks the team down per model with no non-model entry", () => {
    expect(t.byModel.map((m) => [m.model, m.cost])).toEqual([
      ["claude-sonnet", 15],
      ["claude-haiku", 2],
    ]);
  });
});

describe("aggregateOverview costFinalized (Rule 20.3)", () => {
  const day = (costFinalized: boolean) => ({
    ...buildRollup({
      date: "2026-10-01",
      models: { "claude-sonnet": { cost: 1 } },
    }),
    costFinalized,
  });

  it("is false when any rollup in range is not finalized", () => {
    expect(aggregateOverview([day(true), day(false)]).costFinalized).toBe(
      false,
    );
  });

  it("is true when every rollup is finalized, and true for an empty range", () => {
    expect(aggregateOverview([day(true)]).costFinalized).toBe(true);
    expect(aggregateOverview([]).costFinalized).toBe(true);
  });
});

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas",
// `TeamsResponseSchema`: `serviceCount` = distinct `byService` keys across every
// model entry of the team's rollups in the range, excluding `_untagged`;
// `userCount` = distinct `byUser` keys across every model entry; both 0 with no
// attributed usage. Rule 20.10; implementation-phases Phase 4.5.
describe("aggregateTeams serviceCount / userCount", () => {
  it("counts distinct services and users across models and days, excluding _untagged", () => {
    const rows = aggregateTeams(rollups);
    const payments = rows.find((t) => t.teamId === "team-payments");
    // payments-api on both days (and under _untagged, which is excluded);
    // a@x.com under two models and two days counts once, plus b@x.com.
    expect(payments).toMatchObject({ serviceCount: 1, userCount: 2 });
  });

  it("counts a team's services and users from rollups on different days", () => {
    const rows = aggregateTeams([
      buildRollup({
        date: "2026-10-01",
        models: {
          "claude-sonnet": {
            cost: 1,
            byUser: { "a@x.com": 1 },
            byService: { svc1: 1, _untagged: 0 },
          },
          "claude-opus": {
            cost: 1,
            byUser: { "a@x.com": 1, "b@x.com": 0 },
            byService: { svc2: 1 },
          },
        },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: acct(2),
        models: {
          "claude-haiku": {
            cost: 1,
            byUser: { "c@x.com": 1 },
            byService: { svc3: 1, svc1: 0 },
          },
        },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serviceCount: 3, userCount: 3 });
  });

  it("is 0 for both when a team has only non-model charges", () => {
    const rows = aggregateTeams(rollups);
    const ledgerOnly = aggregateTeams(
      rollups.filter((r) => r.date === "2026-10-03"),
    );
    expect(rows.find((t) => t.teamId === "team-ledger")).toMatchObject({
      serviceCount: 1,
      userCount: 1,
    });
    expect(ledgerOnly[0]).toMatchObject({
      teamId: "team-ledger",
      serviceCount: 0,
      userCount: 0,
    });
  });

  it("is 0 when the only service is _untagged", () => {
    const rows = aggregateTeams([
      buildRollup({
        date: "2026-10-01",
        models: {
          "claude-sonnet": { cost: 1, byService: { _untagged: 1 } },
        },
      }),
    ]);
    expect(rows[0]).toMatchObject({ serviceCount: 0, userCount: 0 });
  });

  it("keeps the departmentId filter and counts only the filtered teams", () => {
    const only = aggregateTeams(rollups, { departmentId: "dept-finance" });
    expect(only.map((t) => t.teamId)).toEqual(["team-ledger"]);
    expect(only[0]).toMatchObject({ serviceCount: 1, userCount: 1 });
  });

  it("carries the counts into the team detail", () => {
    expect(aggregateTeamDetail(rollups, "team-ledger")).toMatchObject({
      serviceCount: 1,
      userCount: 1,
    });
  });
});
