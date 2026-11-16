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
import { formatUsd, type TopDepartmentBar } from "./chart-data";

type TopDepartmentsChartProps = {
  bars: readonly TopDepartmentBar[];
};

const axisTick = { fill: "var(--color-muted-foreground)", fontSize: 12 };

export function TopDepartmentsChart({ bars }: TopDepartmentsChartProps) {
  const reducedMotion = usePrefersReducedMotion();

  if (bars.length === 0) return <ChartEmptyState />;

  return (
    <div>
      <div
        role="img"
        aria-label="Top 5 departments by cost, bar chart"
        className="h-72 w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={[...bars]}
            layout="vertical"
            accessibilityLayer={false}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              horizontal={false}
              strokeDasharray="3 3"
              stroke="var(--color-border)"
            />
            <XAxis
              type="number"
              tickFormatter={formatUsd}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="departmentName"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={128}
            />
            <Tooltip
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
              radius={4}
              maxBarSize={24}
              isAnimationActive={!reducedMotion}
              animationDuration={250}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>Top 5 departments by cost, USD</caption>
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.departmentId}>
                <th scope="row">{bar.departmentName}</th>
                <td>{formatUsd(bar.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
