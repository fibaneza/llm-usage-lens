"use client";

import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

import { ChartEmptyState } from "./ChartEmptyState";
import { ChartLegend } from "./ChartLegend";
import { formatUsd, type ModelBreakdownSlice } from "./chart-data";

type ModelBreakdownChartProps = {
  slices: readonly ModelBreakdownSlice[];
};

export function ModelBreakdownChart({ slices }: ModelBreakdownChartProps) {
  const reducedMotion = usePrefersReducedMotion();

  if (slices.length === 0) return <ChartEmptyState />;

  // Recharts 3 deprecates `Cell`; each segment carries its own token fill.
  const segments = slices.map((slice) => ({
    ...slice,
    fill: `var(${slice.colorVar})`,
  }));

  return (
    <div>
      <div
        role="img"
        aria-label="Model distribution by cost, donut chart"
        className="h-72 w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer={false}>
            <Pie
              data={segments}
              dataKey="cost"
              nameKey="label"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={2}
              stroke="var(--color-card)"
              isAnimationActive={!reducedMotion}
              animationDuration={250}
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
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={slices.map((slice) => ({
          key: slice.key,
          label: slice.label,
          colorVar: slice.colorVar,
        }))}
      />
      <div className="sr-only">
        <table>
          <caption>Model distribution by cost, USD</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((slice) => (
              <tr key={slice.key}>
                <th scope="row">{slice.label}</th>
                <td>{formatUsd(slice.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
