"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

import { ChartEmptyState } from "./ChartEmptyState";
import { formatUsd } from "./chart-data";

type DailyCostBarChartProps = {
  // One point per UTC day (Rule 20.1).
  data: readonly { date: string; cost: number }[];
  // Names the chart for assistive technology, e.g. "Your spend by day".
  label: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const formatDate = (date: string) =>
  dateFormatter.format(new Date(`${date}T00:00:00Z`));

const axisTick = { fill: "var(--color-muted-foreground)", fontSize: 12 };

// A single-series daily cost chart (My usage, Design System - Management
// pages). The series is not a model, so it takes the primary token rather than
// a model colour (Rule 40.2).
export function DailyCostBarChart({ data, label }: DailyCostBarChartProps) {
  const reducedMotion = usePrefersReducedMotion();
  if (data.length === 0) return <ChartEmptyState />;

  return (
    <div>
      <div
        role="img"
        aria-label={`${label}, bar chart`}
        className="h-72 w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={[...data]}
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
              labelFormatter={(value) => formatDate(String(value))}
              formatter={(value) => formatUsd(Number(value))}
              contentStyle={{
                backgroundColor: "var(--color-popover)",
                color: "var(--color-popover-foreground)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-card)",
              }}
            />
            <Bar
              dataKey="cost"
              name="Cost"
              fill="var(--color-primary)"
              isAnimationActive={!reducedMotion}
              animationDuration={250}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>{`${label}, USD per UTC day`}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.date}>
                <th scope="row">{point.date}</th>
                <td>{point.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
