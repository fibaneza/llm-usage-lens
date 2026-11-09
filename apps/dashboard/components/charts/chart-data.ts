import {
  MODEL_KEYS,
  MODEL_META,
  type DailyTrendPoint,
  type DepartmentDetailResponse,
  type ModelBreakdown,
  type ModelKey,
  type OverviewResponse,
} from "@llm-usage-lens/shared";

// Non-model charges (Guardrails, Provisioned Throughput, ...) are their own
// series/segment, never merged into `other` and never a model token
// (Data Model spec -- Dashboard impact (v1); Rule 20.12, 40.2).
const NON_MODEL_KEY = "nonModel";
const NON_MODEL_LABEL = "Non-model charges";
const NON_MODEL_COLOR_VAR = "--color-cost-non-model";
const MAX_TOP_DEPARTMENTS = 5;

// Teams get their own palette so a model's colour never means a team
// (Design System -- Chart Colors; Rule 40.2).
const TEAM_PALETTE_SIZE = 8;

// A series key is a model key, `nonModel`, or a teamId.
export type ChartSeries = {
  key: string;
  label: string;
  colorVar: string;
};

export type CostTrendRow = {
  date: string;
  [seriesKey: string]: string | number | undefined;
};

export type TeamTrend = DepartmentDetailResponse["teamTrend"];

export type ModelBreakdownSlice = ChartSeries & { cost: number };

export type TopDepartmentBar = OverviewResponse["topDepartments"][number];

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

const NON_MODEL_SERIES: ChartSeries = {
  key: NON_MODEL_KEY,
  label: NON_MODEL_LABEL,
  colorVar: NON_MODEL_COLOR_VAR,
};

function modelSeries(key: ModelKey): ChartSeries {
  return {
    key,
    label: MODEL_META[key].displayName,
    colorVar: MODEL_META[key].chartToken,
  };
}

export function toCostTrendSeries(
  dailyTrend: readonly DailyTrendPoint[],
  groupBy: "model",
): { rows: CostTrendRow[]; series: ChartSeries[] } {
  void groupBy;

  const rows = dailyTrend.map((point): CostTrendRow => {
    const row: CostTrendRow = { date: point.date };
    for (const key of MODEL_KEYS) {
      const cost = point.byModel[key];
      // A model absent on a day stays absent (Rule 20.12 -- never coerced to 0).
      if (cost !== undefined) row[key] = cost;
    }
    row[NON_MODEL_KEY] = point.nonModelCost;
    return row;
  });

  const presentModels = MODEL_KEYS.filter((key) =>
    dailyTrend.some((point) => point.byModel[key] !== undefined),
  );

  return {
    rows,
    series: [...presentModels.map(modelSeries), NON_MODEL_SERIES],
  };
}

export function toTeamTrendSeries(
  teamTrend: Readonly<TeamTrend>,
  teamNames?: Readonly<Record<string, string>>,
): { rows: CostTrendRow[]; series: ChartSeries[] } {
  const series: ChartSeries[] = [];
  const seen = new Set<string>();

  const rows = teamTrend.map((day): CostTrendRow => {
    const row: CostTrendRow = { date: day.date };
    for (const { teamId, cost } of day.teams) {
      // A team absent on a day stays absent; one present at 0 keeps its 0.
      row[teamId] = cost;
      if (!seen.has(teamId)) {
        seen.add(teamId);
        series.push({
          key: teamId,
          label: teamNames?.[teamId] ?? teamId,
          colorVar: `--color-team-${(series.length % TEAM_PALETTE_SIZE) + 1}`,
        });
      }
    }
    return row;
  });

  return { rows, series };
}

export function toModelBreakdownSlices(
  byModel: readonly ModelBreakdown[],
  nonModelCost: number,
): ModelBreakdownSlice[] {
  const slices: ModelBreakdownSlice[] = byModel
    .filter((entry) => entry.cost > 0)
    .map((entry) => ({ ...modelSeries(entry.model), cost: entry.cost }));

  if (nonModelCost > 0) {
    slices.push({ ...NON_MODEL_SERIES, cost: nonModelCost });
  }

  return slices;
}

export function toTopDepartmentBars(
  topDepartments: readonly TopDepartmentBar[],
): TopDepartmentBar[] {
  return [...topDepartments]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, MAX_TOP_DEPARTMENTS);
}
