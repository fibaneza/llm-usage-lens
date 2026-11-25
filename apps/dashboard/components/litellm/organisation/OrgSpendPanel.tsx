"use client";

import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useId, useMemo } from "react";
import type { z } from "zod";

import { formatUsd } from "@/components/charts/chart-data";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { LazySpendTimelineChart } from "@/components/charts/LazyCharts";
import { Panel } from "@/components/display/Panel";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { LiteLLMOrgDailyRowSchema } from "@llm-usage-lens/shared";

import { formatCount } from "./format";

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

const METRICS = ["spend", "requests", "tokens"] as const;
const BREAKDOWNS = ["total", "team"] as const;
const VIEWS = ["chart", "table"] as const;

const PARAMS = {
  metric: parseAsStringLiteral(METRICS).withDefault("spend"),
  by: parseAsStringLiteral(BREAKDOWNS).withDefault("total"),
  view: parseAsStringLiteral(VIEWS).withDefault("chart"),
};

type Metric = (typeof METRICS)[number];

const METRIC_LABEL: Record<Metric, string> = {
  spend: "Spend",
  requests: "Requests",
  tokens: "Tokens",
};

const TOP_TEAMS = 7;
const NOT_REPORTED = "Not reported by LiteLLM";
const NUMERIC = "text-right font-mono tabular-nums";

type Series = {
  key: string;
  label: string;
  colorVar: string;
  values: Record<string, number>;
};

// Every UTC day from dateFrom to dateTo inclusive (LD20; Rule 20.1).
function daysOf(dateFrom: string, dateTo: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${dateTo}T00:00:00Z`);
  for (let t = Date.parse(`${dateFrom}T00:00:00Z`); t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function valuesOf(
  rows: readonly LiteLLMOrgDailyRow[],
  metric: Metric,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const row of rows) {
    const value = row[metric];
    if (value !== undefined) values[row.date] = value;
  }
  return values;
}

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

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled: ReadonlySet<T>;
}) {
  const labelId = useId();
  const reasonId = useId();
  const anyDisabled = disabled.size > 0;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={labelId} className="text-muted-foreground text-xs font-medium">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              type="button"
              aria-pressed={selected}
              aria-describedby={
                disabled.has(option.value) ? reasonId : undefined
              }
              disabled={disabled.has(option.value)}
              variant={selected ? "secondary" : "outline"}
              size="sm"
              className={cn(selected && "border-border border font-semibold")}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      {anyDisabled ? (
        <span id={reasonId} className="text-muted-foreground text-xs">
          {NOT_REPORTED}
        </span>
      ) : null}
    </div>
  );
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

  const metric = unavailableMetrics.has(params.metric)
    ? "spend"
    : params.metric;
  const by = unavailableBreakdowns.has(params.by) ? "total" : params.by;
  const { view } = params;

  const days = useMemo(() => daysOf(dateFrom, dateTo), [dateFrom, dateTo]);
  const series = useMemo<Series[]>(
    () =>
      by === "team"
        ? teamSeries(dailyByTeam ?? [], metric)
        : [
            {
              key: "total",
              label: METRIC_LABEL[metric],
              colorVar: "--color-primary",
              values: valuesOf(daily, metric),
            },
          ],
    [by, dailyByTeam, daily, metric],
  );

  const format = metric === "spend" ? formatUsd : formatCount;
  const total = series.reduce((sum, s) => sum + sumOf(s.values), 0);
  const label = `${METRIC_LABEL[metric]}${by === "team" ? " by team" : ""}, ${dateFrom} to ${dateTo} UTC, total ${format(total)}`;
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
        </div>
        {view === "chart" ? (
          <div>
            <LazySpendTimelineChart
              days={days}
              series={series}
              format={format}
              label={label}
            />
            {by === "team" ? <ChartLegend items={series} /> : null}
          </div>
        ) : (
          <Table>
            <TableCaption className="mt-0 mb-2 text-left">
              {`${METRIC_LABEL[metric]} per day`}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Date (UTC)</TableHead>
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
                    {day}
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
