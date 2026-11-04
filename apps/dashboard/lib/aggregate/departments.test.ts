import {
  DepartmentDetailResponseSchema,
  DepartmentsResponseSchema,
} from "@bedrock-usage/shared";
import { describe, expect, it } from "vitest";

import { buildRollup } from "@/test/rollup-builder";

import { aggregateDepartmentDetail, aggregateDepartments } from "./departments";
import { aggregateOverview } from "./overview";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas"
// (department rows carry `teamCount`: distinct teams with rollups for the
// department in the range; `topModel`: the model with the most invocations in
// the range or `null` when none -- the Overview Most Used Model rule),
// "Historical Snapshots" (a team that moved departments counts under each
// department its rollups name); implementation-phases Phase 4.3; Rule 20.4.
const ENG = {
  departmentId: "dept-engineering",
  departmentName: "Engineering",
};
const FIN = {
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
  accountId: acct(3),
};

function row(rows: ReturnType<typeof aggregateDepartments>, id: string) {
  const found = rows.find((r) => r.departmentId === id);
  if (!found) throw new Error(`no department row for ${id}`);
  return found;
}

describe("aggregateDepartments -- teamCount", () => {
  it("counts the distinct teams that have rollups for each department", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: { "claude-sonnet": { cost: 5 } },
      }),
      buildRollup({
        date: "2026-10-01",
        accountId: acct(2),
        teamId: "team-platform",
        teamName: "Platform",
        models: { "claude-sonnet": { cost: 5 } },
      }),
      buildRollup({
        date: "2026-10-02",
        ...FIN,
        models: { "claude-opus": { cost: 30 } },
      }),
    ]);

    expect(row(rows, "dept-engineering").teamCount).toBe(2);
    expect(row(rows, "dept-finance").teamCount).toBe(1);
  });

  it("counts a team once however many days and accounts it spans", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: { "claude-sonnet": { cost: 1 } },
      }),
      buildRollup({
        date: "2026-10-02",
        models: { "claude-sonnet": { cost: 1 } },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: acct(2),
        models: { "claude-sonnet": { cost: 1 } },
      }),
      buildRollup({
        date: "2026-10-03",
        accountId: acct(4),
        models: { "claude-sonnet": { cost: 1 } },
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.teamCount).toBe(1);
  });

  it("counts a team under each department its rollups name when it moved (Historical Snapshots)", () => {
    const roaming = {
      accountId: acct(5),
      teamId: "team-roaming",
      teamName: "Roaming",
    };
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        ...roaming,
        ...ENG,
        models: { "claude-sonnet": { cost: 4 } },
      }),
      buildRollup({
        date: "2026-10-02",
        ...roaming,
        departmentId: "dept-finance",
        departmentName: "Finance",
        models: { "claude-sonnet": { cost: 4 } },
      }),
    ]);

    expect(row(rows, "dept-engineering").teamCount).toBe(1);
    expect(row(rows, "dept-finance").teamCount).toBe(1);
  });

  it("counts teams whose rollups carry only non-model charges", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-03",
        ...FIN,
        models: {},
        nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
      }),
    ]);

    expect(rows[0]?.teamCount).toBe(1);
  });

  it("is an integer count, never a fractional or negative number", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: { "claude-sonnet": { cost: 1 } },
      }),
      buildRollup({
        date: "2026-10-01",
        teamId: "team-b",
        teamName: "B",
        accountId: acct(2),
        models: { "claude-sonnet": { cost: 1 } },
      }),
    ]);

    expect(Number.isInteger(rows[0]?.teamCount)).toBe(true);
    expect(rows[0]?.teamCount).toBeGreaterThanOrEqual(0);
  });
});

describe("aggregateDepartments -- topModel", () => {
  it("is the model with the most invocations, not the one with the most cost", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: {
          "claude-opus": { cost: 100, invocations: 2 },
          "claude-haiku": { cost: 1, invocations: 40 },
        },
      }),
    ]);

    expect(rows[0]?.topModel).toBe("claude-haiku");
  });

  it("sums a model's invocations across days and accounts", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: {
          "claude-opus": { cost: 10, invocations: 5 },
          "claude-sonnet": { cost: 1, invocations: 4 },
        },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: acct(2),
        models: { "claude-sonnet": { cost: 1, invocations: 4 } },
      }),
    ]);

    expect(rows[0]?.topModel).toBe("claude-sonnet");
  });

  it("is computed per department from that department's rollups only", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: { "claude-haiku": { cost: 1, invocations: 3 } },
      }),
      buildRollup({
        date: "2026-10-01",
        ...FIN,
        models: { "claude-opus": { cost: 1, invocations: 99 } },
      }),
    ]);

    expect(row(rows, "dept-engineering").topModel).toBe("claude-haiku");
    expect(row(rows, "dept-finance").topModel).toBe("claude-opus");
  });

  it("is null when the department's rollups carry only non-model charges", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-03",
        ...FIN,
        models: {},
        nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
      }),
    ]);

    expect(rows[0]).toMatchObject({ departmentId: "dept-finance" });
    expect(rows[0]?.topModel).toBeNull();
  });

  it("is null when every model has zero invocations", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: {
          "claude-sonnet": { cost: 3, invocations: 0 },
          "claude-haiku": { cost: 1, invocations: 0 },
        },
      }),
    ]);

    expect(rows[0]?.topModel).toBeNull();
  });

  it("ignores a model with zero invocations next to one with some", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: {
          "claude-opus": { cost: 50, invocations: 0 },
          "claude-haiku": { cost: 1, invocations: 1 },
        },
      }),
    ]);

    expect(rows[0]?.topModel).toBe("claude-haiku");
  });

  // Tie rule: same as Overview mostUsedModel -- strictly greater wins, so the
  // first model in modelBreakdown order (cost descending) keeps the tie.
  it("breaks an invocation tie in favour of the higher-cost model", () => {
    const opusFirst = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: {
          "claude-sonnet": { cost: 10, invocations: 7 },
          "claude-opus": { cost: 30, invocations: 7 },
        },
      }),
    ]);
    const sonnetFirst = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: {
          "claude-sonnet": { cost: 30, invocations: 7 },
          "claude-opus": { cost: 10, invocations: 7 },
        },
      }),
    ]);

    expect(opusFirst[0]?.topModel).toBe("claude-opus");
    expect(sonnetFirst[0]?.topModel).toBe("claude-sonnet");
  });

  it("agrees with Overview's mostUsedModel over the same rollups, ties and null included", () => {
    const scenarios = [
      [
        buildRollup({
          date: "2026-10-01",
          models: {
            "claude-opus": { cost: 30, invocations: 5 },
            "claude-sonnet": { cost: 10, invocations: 5 },
          },
        }),
      ],
      [
        buildRollup({
          date: "2026-10-01",
          models: {
            "claude-haiku": { cost: 2, invocations: 9 },
            other: { cost: 8, invocations: 9 },
            "claude-sonnet": { cost: 5, invocations: 1 },
          },
        }),
        buildRollup({
          date: "2026-10-02",
          models: { "claude-haiku": { cost: 1, invocations: 2 } },
        }),
      ],
      [
        buildRollup({
          date: "2026-10-01",
          models: {},
          nonModel: { guardrails: { cost: 2, recurring: false } },
        }),
      ],
      [
        buildRollup({
          date: "2026-10-01",
          models: { "claude-sonnet": { cost: 3, invocations: 0 } },
        }),
      ],
    ];

    for (const rollups of scenarios) {
      expect(aggregateDepartments(rollups)[0]?.topModel).toBe(
        aggregateOverview(rollups).mostUsedModel,
      );
    }
  });

  it("can be the 'other' bucket like any canonical model key", () => {
    const rows = aggregateDepartments([
      buildRollup({
        date: "2026-10-01",
        models: {
          other: { cost: 1, invocations: 12 },
          "claude-sonnet": { cost: 9, invocations: 3 },
        },
      }),
    ]);

    expect(rows[0]?.topModel).toBe("other");
  });
});

describe("aggregateDepartments -- unchanged behaviour and schema fit", () => {
  const rollups = [
    buildRollup({
      date: "2026-10-01",
      models: { "claude-sonnet": { cost: 10, invocations: 3 } },
      nonModel: { guardrails: { cost: 1, recurring: false } },
    }),
    buildRollup({
      date: "2026-10-02",
      ...FIN,
      models: { "claude-opus": { cost: 30, invocations: 2 } },
    }),
    buildRollup({
      date: "2026-10-03",
      ...FIN,
      models: {},
      nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
    }),
  ];

  it("still orders rows by cost descending with the model/non-model split", () => {
    const rows = aggregateDepartments(rollups);

    expect(rows.map((r) => r.departmentId)).toEqual([
      "dept-finance",
      "dept-engineering",
    ]);
    expect(rows[0]).toMatchObject({
      cost: 50,
      modelCost: 30,
      nonModelCost: 20,
    });
  });

  it("produces rows that satisfy DepartmentsResponseSchema", () => {
    const parsed = DepartmentsResponseSchema.parse({
      departments: aggregateDepartments(rollups),
    });

    expect(parsed.departments.map((d) => d.teamCount)).toEqual([1, 1]);
    expect(parsed.departments.map((d) => d.topModel)).toEqual([
      "claude-opus",
      "claude-sonnet",
    ]);
  });

  it("returns no rows for no rollups", () => {
    expect(aggregateDepartments([])).toEqual([]);
  });
});

describe("aggregateDepartmentDetail -- teamCount and topModel", () => {
  const rollups = [
    buildRollup({
      date: "2026-10-01",
      models: {
        "claude-opus": { cost: 40, invocations: 1 },
        "claude-sonnet": { cost: 5, invocations: 6 },
      },
    }),
    buildRollup({
      date: "2026-10-02",
      accountId: acct(2),
      teamId: "team-platform",
      teamName: "Platform",
      models: { "claude-sonnet": { cost: 5, invocations: 2 } },
    }),
    buildRollup({
      date: "2026-10-02",
      ...FIN,
      models: { "claude-opus": { cost: 30, invocations: 50 } },
    }),
  ];

  it("carries the department's own team count and top model", () => {
    const detail = aggregateDepartmentDetail(rollups, "dept-engineering");

    expect(detail.teamCount).toBe(2);
    expect(detail.topModel).toBe("claude-sonnet");
  });

  it("does not let another department's rollups change the figures", () => {
    const detail = aggregateDepartmentDetail(rollups, "dept-finance");

    expect(detail.teamCount).toBe(1);
    expect(detail.topModel).toBe("claude-opus");
  });

  it("matches the list row for the same department", () => {
    const list = aggregateDepartments(rollups);
    for (const id of ["dept-engineering", "dept-finance"]) {
      const detail = aggregateDepartmentDetail(rollups, id);
      expect(row(list, id).teamCount).toBeGreaterThan(0);
      expect(detail.teamCount).toBe(row(list, id).teamCount);
      expect(detail.topModel).toBe(row(list, id).topModel);
    }
  });

  it("teamCount equals the number of teams the detail lists", () => {
    const detail = aggregateDepartmentDetail(rollups, "dept-engineering");

    expect(detail.teamCount).toBe(detail.teams.length);
  });

  it("is zero teams and a null top model for a department with no rollups in range", () => {
    const detail = aggregateDepartmentDetail(
      rollups,
      "dept-ghost",
      "Ghost Dept",
    );

    expect(detail.departmentName).toBe("Ghost Dept");
    expect(detail.teamCount).toBe(0);
    expect(detail.topModel).toBeNull();
  });

  it("has a null top model when the department's rollups are non-model only", () => {
    const detail = aggregateDepartmentDetail(
      [
        buildRollup({
          date: "2026-10-03",
          ...FIN,
          models: {},
          nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
        }),
      ],
      "dept-finance",
    );

    expect(detail.teamCount).toBe(1);
    expect(detail.topModel).toBeNull();
  });

  it("produces a detail that satisfies DepartmentDetailResponseSchema", () => {
    const parsed = DepartmentDetailResponseSchema.parse(
      aggregateDepartmentDetail(rollups, "dept-engineering"),
    );

    expect(parsed).toMatchObject({ teamCount: 2, topModel: "claude-sonnet" });
  });
});
