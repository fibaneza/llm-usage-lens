"use client";

import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useMemo } from "react";

import { formatUsd } from "@/components/charts/chart-data";
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

import { formatCount, weeklyBuckets } from "./organisation/format";
import { OptionGroup } from "./organisation/OptionGroup";
import { bucketed, daysOf, valuesOf } from "./organisation/timeline";

type TimelineRow = {
  date: string;
  spend: number;
  requests?: number | undefined;
  tokens?: number | undefined;
};

type SpendTimelinePanelProps = {
  rows: readonly TimelineRow[];
  dateFrom: string;
  dateTo: string;
  description?: string;
};

const METRICS = ["spend", "tokens", "requests"] as const;
const BUCKETS = ["daily", "weekly"] as const;
const VIEWS = ["chart", "table"] as const;

const PARAMS = {
  metric: parseAsStringLiteral(METRICS).withDefault("spend"),
  view: parseAsStringLiteral(VIEWS).withDefault("chart"),
  bucket: parseAsStringLiteral(BUCKETS).withDefault("daily"),
};

type Metric = (typeof METRICS)[number];

const METRIC_LABEL: Record<Metric, string> = {
  spend: "Spend",
  tokens: "Tokens",
  requests: "Requests",
};

const NUMERIC = "text-right font-mono tabular-nums";

// Design System - SpendTimelinePanel (unit LP3, T-LP15): the one-series
// timeline of the LiteLLM user and team pages; the switches live in the URL.
export function SpendTimelinePanel({
  rows,
  dateFrom,
  dateTo,
  description,
}: SpendTimelinePanelProps) {
  const [params, setParams] = useQueryStates(PARAMS);

  const hasRequests = rows.some((r) => r.requests !== undefined);
  const hasTokens = rows.some((r) => r.tokens !== undefined);
  const unavailableMetrics = useMemo(() => {
    const set = new Set<Metric>();
    if (!hasRequests) set.add("requests");
    if (!hasTokens) set.add("tokens");
    return set;
  }, [hasRequests, hasTokens]);
  const noViews = useMemo(() => new Set<(typeof VIEWS)[number]>(), []);
  const noBuckets = useMemo(() => new Set<(typeof BUCKETS)[number]>(), []);

  const metric = unavailableMetrics.has(params.metric)
    ? "spend"
    : params.metric;
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
  const values = useMemo(() => {
    const byDay = valuesOf(rows, metric);
    return weekly ? bucketed(byDay, buckets) : byDay;
  }, [rows, metric, weekly, buckets]);
  const series = useMemo(
    () => [
      {
        key: "total",
        label: METRIC_LABEL[metric],
        colorVar: "--color-primary",
        values,
      },
    ],
    [metric, values],
  );

  const format = metric === "spend" ? formatUsd : formatCount;
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  const label = `${METRIC_LABEL[metric]}, ${dateFrom} to ${dateTo} UTC, total ${format(total)}`;
  const subtitle = `${weekly ? "Weekly" : "Daily"} ${METRIC_LABEL[metric].toLowerCase()}`;
  const tableDays = days.filter((day) => values[day] !== undefined);

  return (
    <Panel
      title="Spend over time"
      boundaryTitle="spend over time"
      {...(description ? { description } : {})}
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
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No daily spend reported.
          </p>
        ) : view === "chart" ? (
          <LazySpendTimelineChart
            days={days}
            series={series}
            format={format}
            label={label}
            labelFor={weekly ? (key) => labels.get(key) ?? key : undefined}
          />
        ) : (
          <Table>
            <TableCaption className="mt-0 mb-2 text-left">
              {`${METRIC_LABEL[metric]} per ${weekly ? "week" : "day"}`}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{weekly ? "Week (UTC)" : "Date (UTC)"}</TableHead>
                <TableHead className="text-right">
                  {METRIC_LABEL[metric]}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableDays.map((day) => (
                <TableRow key={day}>
                  <TableCell className="font-mono tabular-nums">
                    {weekly ? (labels.get(day) ?? day) : day}
                  </TableCell>
                  <TableCell className={NUMERIC}>
                    {format(values[day] ?? 0)}
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
