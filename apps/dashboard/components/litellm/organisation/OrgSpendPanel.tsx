"use client";

import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useMemo } from "react";
import type { z } from "zod";

import { formatUsd } from "@/components/charts/chart-data";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { LazySpendTimelineChart } from "@/components/charts/LazyCharts";
import { Panel } from "@/components/display/Panel";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LiteLLMOrgDailyRowSchema } from "@llm-usage-lens/shared";

import { formatCount, weeklyBuckets } from "./format";
import { OptionGroup } from "./OptionGroup";
import { bucketed, daysOf, valuesOf } from "./timeline";

type LiteLLMOrgDailyRow = z.infer<typeof LiteLLMOrgDailyRowSchema>;

type DailyByTeam = {
  litellmTeamId: string;
  alias: string | null;
  daily: readonly LiteLLMOrgDailyRow[];
};

type OrgSpendPanelProps = {
  daily: readonly LiteLLMOrgDailyRow[];
  dailyByTeam?: readonly DailyByTeam[] | undefined;
  dateFrom: string;
  dateTo: string;
};

const METRICS = ["spend", "tokens", "requests"] as const;
const BUCKETS = ["daily", "weekly"] as const;
const BREAKDOWNS = ["total", "team"] as const;
const VIEWS = ["chart", "table"] as const;

const PARAMS = {
  metric: parseAsStringLiteral(METRICS).withDefault("spend"),
  by: parseAsStringLiteral(BREAKDOWNS).withDefault("total"),
  view: parseAsStringLiteral(VIEWS).withDefault("chart"),
  bucket: parseAsStringLiteral(BUCKETS).withDefault("daily"),
};

type Metric = (typeof METRICS)[number];

const METRIC_LABEL: Record<Metric, string> = {
  spend: "Spend",
  tokens: "Tokens",
  requests: "Requests",
};

const TOP_TEAMS = 7;
const NUMERIC = "text-right font-mono tabular-nums";

type Series = {
  key: string;
  label: string;
  colorVar: string;
  values: Record<string, number>;
};

const sumOf = (values: Record<string, number>) =>
  Object.values(values).reduce((a, b) => a + b, 0);

function teamSeries(teams: readonly DailyByTeam[], metric: Metric): Series[] {
  const ranked = teams
    .map((team) => ({
      key: team.litellmTeamId,
      label: team.alias ?? team.litellmTeamId,
      values: valuesOf(team.daily, metric),
    }))
    .sort((a, b) => sumOf(b.values) - sumOf(a.values));
  const series: Series[] = ranked.slice(0, TOP_TEAMS).map((team, i) => ({
    ...team,
    colorVar: `--color-team-${i + 1}`,
  }));
  const rest = ranked.slice(TOP_TEAMS);
  if (rest.length > 0) {
    const values: Record<string, number> = {};
    for (const team of rest) {
      for (const [date, value] of Object.entries(team.values)) {
        values[date] = (values[date] ?? 0) + value;
      }
    }
    series.push({
      key: "other-teams",
      label: "Other teams",
      colorVar: "--color-team-8",
      values,
    });
  }
  return series;
}

// Design System -- LiteLLM Organisation spend chart (unit OC1, T-OC4): the
// answer arrives as props; the three switches live in the URL.
export function OrgSpendPanel({
  daily,
  dailyByTeam,
  dateFrom,
  dateTo,
}: OrgSpendPanelProps) {
  const [params, setParams] = useQueryStates(PARAMS);

  const hasRequests = daily.some((r) => r.requests !== undefined);
  const hasTokens = daily.some((r) => r.tokens !== undefined);
  const hasTeams = (dailyByTeam?.length ?? 0) > 0;

  const unavailableMetrics = useMemo(() => {
    const set = new Set<Metric>();
    if (!hasRequests) set.add("requests");
    if (!hasTokens) set.add("tokens");
    return set;
  }, [hasRequests, hasTokens]);
  const unavailableBreakdowns = useMemo(
    () => new Set<(typeof BREAKDOWNS)[number]>(hasTeams ? [] : ["team"]),
    [hasTeams],
  );
  const noViews = useMemo(() => new Set<(typeof VIEWS)[number]>(), []);
  const noBuckets = useMemo(() => new Set<(typeof BUCKETS)[number]>(), []);

  const metric = unavailableMetrics.has(params.metric)
    ? "spend"
    : params.metric;
  const by = unavailableBreakdowns.has(params.by) ? "total" : params.by;
  const { view } = params;

  const weekly = params.bucket === "weekly";
  const dayList = useMemo(() => daysOf(dateFrom, dateTo), [dateFrom, dateTo]);
  const buckets = useMemo(() => weeklyBuckets(dayList), [dayList]);
  const days = useMemo(
    () => (weekly ? buckets.map((b) => b.key) : dayList),
    [weekly, buckets, dayList],
  );
  const labels = useMemo(
    () =>
      new Map(
        buckets.map((b) => [
          b.key,
          b.part ? `${b.label} (part week)` : b.label,
        ]),
      ),
    [buckets],
  );
  const series = useMemo<Series[]>(() => {
    const daySeries =
      by === "team"
        ? teamSeries(dailyByTeam ?? [], metric)
        : [
            {
              key: "total",
              label: METRIC_LABEL[metric],
              colorVar: "--color-primary",
              values: valuesOf(daily, metric),
            },
          ];
    return weekly
      ? daySeries.map((s) => ({ ...s, values: bucketed(s.values, buckets) }))
      : daySeries;
  }, [by, dailyByTeam, daily, metric, weekly, buckets]);

  const format = metric === "spend" ? formatUsd : formatCount;
  const total = series.reduce((sum, s) => sum + sumOf(s.values), 0);
  const label = `${METRIC_LABEL[metric]}${by === "team" ? " by team" : ""}, ${dateFrom} to ${dateTo} UTC, total ${format(total)}`;
  const subtitle = `${weekly ? "Weekly" : "Daily"} ${METRIC_LABEL[metric].toLowerCase()}${by === "team" ? ` by team, ${TOP_TEAMS} largest stacked` : ""}`;
  const tableDays = days.filter((day) =>
    series.some((s) => s.values[day] !== undefined),
  );

  return (
    <Panel
      title="Spend over time"
      boundaryTitle="spend over time"
      description="LiteLLM-reported, per UTC day."
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{subtitle}</p>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <OptionGroup
            label="Metric"
            options={METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m] }))}
            value={metric}
            disabled={unavailableMetrics}
            onChange={(next) => void setParams({ metric: next })}
          />
          <OptionGroup
            label="Breakdown"
            options={[
              { value: "total", label: "Total" },
              { value: "team", label: "By team" },
            ]}
            value={by}
            disabled={unavailableBreakdowns}
            onChange={(next) => void setParams({ by: next })}
          />
          <OptionGroup
            label="View"
            options={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
            value={view}
            disabled={noViews}
            onChange={(next) => void setParams({ view: next })}
          />
          <OptionGroup
            label="Bucket size"
            options={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ]}
            value={params.bucket}
            disabled={noBuckets}
            onChange={(next) =>
              void setParams({ bucket: next === "daily" ? null : next })
            }
          />
        </div>
        {view === "chart" ? (
          <div>
            <LazySpendTimelineChart
              days={days}
              series={series}
              format={format}
              label={label}
              labelFor={weekly ? (key) => labels.get(key) ?? key : undefined}
            />
            {by === "team" ? <ChartLegend items={series} /> : null}
          </div>
        ) : (
          <Table>
            <TableCaption className="mt-0 mb-2 text-left">
              {`${METRIC_LABEL[metric]} per ${weekly ? "week" : "day"}`}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{weekly ? "Week (UTC)" : "Date (UTC)"}</TableHead>
                {series.map((s) => (
                  <TableHead key={s.key} className="text-right">
                    {s.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableDays.map((day) => (
                <TableRow key={day}>
                  <TableCell className="font-mono tabular-nums">
                    {weekly ? (labels.get(day) ?? day) : day}
                  </TableCell>
                  {series.map((s) => (
                    <TableCell key={s.key} className={NUMERIC}>
                      {s.values[day] === undefined
                        ? "—"
                        : format(s.values[day])}
                    </TableCell>
                  ))}
                  <TableCell className={NUMERIC}>
                    {format(
                      series.reduce((sum, s) => sum + (s.values[day] ?? 0), 0),
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Panel>
  );
}
