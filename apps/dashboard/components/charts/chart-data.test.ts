import {
  MODEL_KEYS,
  MODEL_META,
  type DailyTrendPoint,
  type DepartmentDetailResponse,
  type ModelBreakdown,
} from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

import {
  toCostTrendSeries,
  toModelBreakdownSlices,
  toTeamTrendSeries,
  toTopDepartmentBars,
} from "./chart-data";

// Phase 4.1 + Data Model spec -- Dashboard impact (v1): non-model cost is its
// own series/segment, never merged into `other` and never a model token; it
// uses `--color-cost-non-model` (Rule 40.2, 20.12). A model absent on a day is
// absent, not 0 (Rule 20.12 -- "never coerced to 0 when absent").

const NON_MODEL_TOKEN = "--color-cost-non-model";
const NON_MODEL_LABEL = "Non-model charges";

function day(
  date: string,
  byModel: DailyTrendPoint["byModel"],
  nonModelCost: number,
): DailyTrendPoint {
  const modelCost = Object.values(byModel).reduce((sum, c) => sum + c, 0);
  return {
    date,
    cost: modelCost + nonModelCost,
    modelCost,
    nonModelCost,
    byModel,
  };
}

function breakdown(
  model: ModelBreakdown["model"],
  cost: number,
): ModelBreakdown {
  return { model, cost, inputTokens: 10, outputTokens: 5, invocations: 1 };
}

describe("toCostTrendSeries", () => {
  const trend: DailyTrendPoint[] = [
    day("2026-10-01", { "claude-sonnet": 4, "claude-opus": 6 }, 5),
    // Idle day: only a recurring non-model charge, no invocations.
    day("2026-10-02", {}, 3),
    day("2026-10-03", { "claude-haiku": 2 }, 0),
  ];

  it("returns one row per day in dailyTrend, in order, keyed by date", () => {
    const { rows } = toCostTrendSeries(trend, "model");

    expect(rows.map((r) => r.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("puts each model's cost under its canonical key plus nonModel", () => {
    const { rows } = toCostTrendSeries(trend, "model");

    expect(rows[0]).toStrictEqual({
      date: "2026-10-01",
      "claude-opus": 6,
      "claude-sonnet": 4,
      nonModel: 5,
    });
  });

  it("leaves a model that is absent on a day absent, never 0", () => {
    const { rows } = toCostTrendSeries(trend, "model");

    expect(rows[1]).toStrictEqual({ date: "2026-10-02", nonModel: 3 });
    expect(rows[1]).not.toHaveProperty("claude-opus");
    expect(rows[2]).not.toHaveProperty("claude-sonnet");
    expect(rows[2]).not.toHaveProperty("other");
  });

  it("always carries nonModel as a real value, including 0", () => {
    const { rows } = toCostTrendSeries(trend, "model");

    expect(rows[2]).toStrictEqual({
      date: "2026-10-03",
      "claude-haiku": 2,
      nonModel: 0,
    });
  });

  it("keeps non-model cost out of the other model key", () => {
    const { rows } = toCostTrendSeries(
      [day("2026-10-01", { other: 7 }, 9)],
      "model",
    );

    expect(rows[0]).toStrictEqual({
      date: "2026-10-01",
      other: 7,
      nonModel: 9,
    });
  });

  it("lists the models present in any day in MODEL_KEYS order, then nonModel last", () => {
    const { series } = toCostTrendSeries(trend, "model");

    expect(series.map((s) => s.key)).toEqual([
      "claude-opus",
      "claude-sonnet",
      "claude-haiku",
      "nonModel",
    ]);
    // Input order was sonnet-before-opus; the series order follows MODEL_KEYS.
    const modelKeys = series.map((s) => s.key).filter((k) => k !== "nonModel");
    expect(modelKeys).toEqual(MODEL_KEYS.filter((k) => modelKeys.includes(k)));
  });

  it("omits a model that appears on no day from the series list", () => {
    const { series } = toCostTrendSeries(trend, "model");

    expect(series.map((s) => s.key)).not.toContain("other");
  });

  it("labels and colours model series from MODEL_META", () => {
    const { series } = toCostTrendSeries(trend, "model");

    for (const key of [
      "claude-opus",
      "claude-sonnet",
      "claude-haiku",
    ] as const) {
      expect(series.find((s) => s.key === key)).toMatchObject({
        label: MODEL_META[key].displayName,
        colorVar: MODEL_META[key].chartToken,
      });
    }
  });

  it("gives the nonModel series its own label and the non-model token, not a model token", () => {
    const { series } = toCostTrendSeries(trend, "model");

    const nonModel = series.find((s) => s.key === "nonModel");
    expect(nonModel).toMatchObject({
      label: NON_MODEL_LABEL,
      colorVar: NON_MODEL_TOKEN,
    });
    const modelTokens = Object.values(MODEL_META).map((m) => m.chartToken);
    expect(modelTokens).not.toContain(nonModel?.colorVar);
  });

  it("keeps the nonModel series even when no day has any model usage", () => {
    const { rows, series } = toCostTrendSeries(
      [day("2026-10-01", {}, 3), day("2026-10-02", {}, 3)],
      "model",
    );

    expect(series.map((s) => s.key)).toEqual(["nonModel"]);
    expect(rows).toHaveLength(2);
  });

  it("returns no rows for an empty trend and still ends the series with nonModel", () => {
    const { rows, series } = toCostTrendSeries([], "model");

    expect(rows).toEqual([]);
    expect(series.at(-1)?.key).toBe("nonModel");
  });

  it("does not mutate its input", () => {
    const input = structuredClone(trend);
    toCostTrendSeries(input, "model");

    expect(input).toEqual(trend);
  });
});

describe("toModelBreakdownSlices", () => {
  it("returns one slice per model with cost, label and token from MODEL_META", () => {
    const slices = toModelBreakdownSlices(
      [breakdown("claude-opus", 12.5), breakdown("claude-sonnet", 4)],
      0,
    );

    expect(slices).toHaveLength(2);
    expect(slices.find((s) => s.key === "claude-opus")).toEqual({
      key: "claude-opus",
      label: MODEL_META["claude-opus"].displayName,
      cost: 12.5,
      colorVar: MODEL_META["claude-opus"].chartToken,
    });
    expect(slices.find((s) => s.key === "claude-sonnet")).toEqual({
      key: "claude-sonnet",
      label: MODEL_META["claude-sonnet"].displayName,
      cost: 4,
      colorVar: MODEL_META["claude-sonnet"].chartToken,
    });
  });

  it("excludes models with zero cost", () => {
    const slices = toModelBreakdownSlices(
      [breakdown("claude-opus", 0), breakdown("claude-haiku", 2)],
      0,
    );

    expect(slices.map((s) => s.key)).toEqual(["claude-haiku"]);
  });

  it("adds a non-model slice with its own label and token when non-model cost is positive", () => {
    const slices = toModelBreakdownSlices([breakdown("claude-opus", 10)], 3.5);

    expect(slices.find((s) => s.key === "nonModel")).toEqual({
      key: "nonModel",
      label: NON_MODEL_LABEL,
      cost: 3.5,
      colorVar: NON_MODEL_TOKEN,
    });
  });

  it("omits the non-model slice when non-model cost is 0", () => {
    const slices = toModelBreakdownSlices([breakdown("claude-opus", 10)], 0);

    expect(slices.map((s) => s.key)).not.toContain("nonModel");
  });

  it("never merges non-model cost into the other model slice", () => {
    const slices = toModelBreakdownSlices([breakdown("other", 3)], 7);

    expect(slices.find((s) => s.key === "other")).toMatchObject({ cost: 3 });
    expect(slices.find((s) => s.key === "nonModel")).toMatchObject({
      cost: 7,
      colorVar: NON_MODEL_TOKEN,
    });
    expect(slices.find((s) => s.key === "other")?.colorVar).not.toBe(
      NON_MODEL_TOKEN,
    );
  });

  it("still shows non-model cost when there is no model usage at all", () => {
    const slices = toModelBreakdownSlices([], 4.25);

    expect(slices).toEqual([
      {
        key: "nonModel",
        label: NON_MODEL_LABEL,
        cost: 4.25,
        colorVar: NON_MODEL_TOKEN,
      },
    ]);
  });

  it("returns no slices when there is nothing to show", () => {
    expect(toModelBreakdownSlices([], 0)).toEqual([]);
  });
});

describe("toTopDepartmentBars", () => {
  const dept = (id: string, cost: number) => ({
    departmentId: id,
    departmentName: `Dept ${id}`,
    cost,
  });

  it("keeps at most five departments", () => {
    const bars = toTopDepartmentBars([
      dept("a", 1),
      dept("b", 2),
      dept("c", 3),
      dept("d", 4),
      dept("e", 5),
      dept("f", 6),
      dept("g", 7),
    ]);

    expect(bars).toHaveLength(5);
  });

  it("sorts by cost descending and keeps the five most expensive", () => {
    const bars = toTopDepartmentBars([
      dept("a", 10),
      dept("b", 70),
      dept("c", 30),
      dept("d", 60),
      dept("e", 20),
      dept("f", 50),
      dept("g", 40),
    ]);

    expect(bars.map((b) => b.departmentId)).toEqual(["b", "d", "f", "g", "c"]);
    expect(bars.map((b) => b.cost)).toEqual([70, 60, 50, 40, 30]);
  });

  it("returns every department when there are fewer than five", () => {
    const bars = toTopDepartmentBars([dept("a", 1), dept("b", 3)]);

    expect(bars).toEqual([dept("b", 3), dept("a", 1)]);
  });

  it("returns an empty list for no departments", () => {
    expect(toTopDepartmentBars([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [dept("a", 1), dept("b", 3), dept("c", 2)];
    const snapshot = structuredClone(input);
    toTopDepartmentBars(input);

    expect(input).toEqual(snapshot);
  });
});

// Phase 4.1: `CostTrendChart` takes `groupBy: 'model' | 'team'` for reuse on the
// department detail page (Design System -- Component Inventory). The team input
// is `DepartmentDetailResponse.teamTrend` (Data Model -- API Routes). Teams get
// the dedicated team series palette `--color-team-1` .. `--color-team-8`,
// cycled by first-seen order -- never a model token (a model's colour means
// that model on every chart) and never the non-model token (Rule 40.2). Team
// trend carries no non-model split, so team mode has no nonModel series.
describe("toTeamTrendSeries", () => {
  const TEAM_TOKEN = /^--color-team-[1-8]$/;

  const teamTrend: DepartmentDetailResponse["teamTrend"] = [
    {
      date: "2026-10-01",
      teams: [
        { teamId: "team-b", cost: 12.34 },
        { teamId: "team-a", cost: 4.5 },
      ],
    },
    // team-b is idle this day; team-c appears for the first time.
    {
      date: "2026-10-02",
      teams: [
        { teamId: "team-a", cost: 6 },
        { teamId: "team-c", cost: 0 },
      ],
    },
    { date: "2026-10-03", teams: [] },
  ];

  it("returns one row per day in input order, keyed by date", () => {
    const { rows } = toTeamTrendSeries(teamTrend);

    expect(rows.map((r) => r.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("puts each team's cost under its teamId", () => {
    const { rows } = toTeamTrendSeries(teamTrend);

    expect(rows[0]).toStrictEqual({
      date: "2026-10-01",
      "team-b": 12.34,
      "team-a": 4.5,
    });
  });

  it("leaves a team that is absent on a day absent, never 0", () => {
    const { rows } = toTeamTrendSeries(teamTrend);

    expect(rows[1]).not.toHaveProperty("team-b");
    expect(rows[0]).not.toHaveProperty("team-c");
    expect(rows[2]).toStrictEqual({ date: "2026-10-03" });
  });

  it("keeps a team that is present with a cost of 0 as a real 0", () => {
    const { rows } = toTeamTrendSeries(teamTrend);

    expect(rows[1]).toStrictEqual({
      date: "2026-10-02",
      "team-a": 6,
      "team-c": 0,
    });
  });

  it("lists one series per teamId in first-seen order", () => {
    const { series } = toTeamTrendSeries(teamTrend);

    expect(series.map((s) => s.key)).toEqual(["team-b", "team-a", "team-c"]);
  });

  it("labels series with the team name when given, else the teamId", () => {
    const { series } = toTeamTrendSeries(teamTrend, {
      "team-b": "Platform",
      "team-a": "Research",
    });

    expect(series.map((s) => s.label)).toEqual([
      "Platform",
      "Research",
      "team-c",
    ]);
  });

  it("labels every series with its teamId when no names are given", () => {
    const { series } = toTeamTrendSeries(teamTrend);

    expect(series.map((s) => s.label)).toEqual(["team-b", "team-a", "team-c"]);
  });

  it("colours series with the team palette tokens by first-seen position", () => {
    const { series } = toTeamTrendSeries(teamTrend);

    expect(series.map((s) => s.colorVar)).toEqual([
      "--color-team-1",
      "--color-team-2",
      "--color-team-3",
    ]);
  });

  it("uses only CSS custom property names, never a hex colour or a model token", () => {
    const { series } = toTeamTrendSeries(teamTrend);

    const reserved = [
      ...Object.values(MODEL_META).map((m) => m.chartToken),
      "--color-cost-non-model",
    ];
    for (const s of series) {
      expect(s.colorVar).toMatch(TEAM_TOKEN);
      expect(reserved).not.toContain(s.colorVar);
    }
  });

  it("cycles the eight-colour palette for more than eight teams", () => {
    const many: DepartmentDetailResponse["teamTrend"] = [
      {
        date: "2026-10-01",
        teams: Array.from({ length: 10 }, (_, i) => ({
          teamId: `t${i + 1}`,
          cost: i + 1,
        })),
      },
    ];

    const { series } = toTeamTrendSeries(many);

    expect(series).toHaveLength(10);
    expect(series.map((s) => s.colorVar)).toEqual([
      "--color-team-1",
      "--color-team-2",
      "--color-team-3",
      "--color-team-4",
      "--color-team-5",
      "--color-team-6",
      "--color-team-7",
      "--color-team-8",
      "--color-team-1",
      "--color-team-2",
    ]);
  });

  it("has no nonModel series, since team trend carries no non-model split", () => {
    const { series, rows } = toTeamTrendSeries(teamTrend);

    expect(series.map((s) => s.key)).not.toContain("nonModel");
    for (const row of rows) expect(row).not.toHaveProperty("nonModel");
  });

  it("returns no rows and no series for an empty trend", () => {
    expect(toTeamTrendSeries([])).toEqual({ rows: [], series: [] });
  });

  it("does not mutate its input", () => {
    const input = structuredClone(teamTrend);
    toTeamTrendSeries(input, { "team-a": "Research" });

    expect(input).toEqual(teamTrend);
  });
});
