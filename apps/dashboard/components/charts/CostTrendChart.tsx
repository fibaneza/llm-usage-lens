"use client";

import type {
  DailyTrendPoint,
  DepartmentDetailResponse,
} from "@bedrock-usage/shared";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartEmptyState } from "./ChartEmptyState";
import { formatUsd, toCostTrendSeries, toTeamTrendSeries } from "./chart-data";

type CostTrendChartProps =
  | { groupBy: "model"; data: readonly DailyTrendPoint[] }
  | {
      groupBy: "team";
      data: DepartmentDetailResponse["teamTrend"];
      teamNames?: Readonly<Record<string, string>>;
    };

const MISSING_VALUE = "—";

// `date` keys are UTC calendar days (Rule 20.1), so ticks format in UTC too.
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`));
}

const axisTick = { fill: "var(--color-muted-foreground)", fontSize: 12 };

export function CostTrendChart(props: CostTrendChartProps) {
  const { rows, series } =
    props.groupBy === "team"
      ? toTeamTrendSeries(props.data, props.teamNames)
      : toCostTrendSeries(props.data, props.groupBy);
  const groupLabel = props.groupBy;

  if (rows.length === 0) return <ChartEmptyState />;

  return (
    <div>
      <div
        role="img"
        aria-label={`Cost trend by ${groupLabel}, stacked area chart`}
        className="h-72 w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={rows}
            accessibilityLayer={false}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              stroke="var(--color-border)"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={formatUsd}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              labelFormatter={(label) => formatDate(String(label))}
              formatter={(value) => formatUsd(Number(value))}
              contentStyle={{
                backgroundColor: "var(--color-popover)",
                color: "var(--color-popover-foreground)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md, 6px)",
              }}
            />
            <Legend />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stackId="cost"
                stroke={`var(${s.colorVar})`}
                fill={`var(${s.colorVar})`}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>{`Cost trend by ${groupLabel}, USD per UTC day`}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <th scope="row">{row.date}</th>
                {series.map((s) => {
                  const cost = row[s.key];
                  return (
                    <td key={s.key}>
                      {typeof cost === "number"
                        ? formatUsd(cost)
                        : MISSING_VALUE}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
