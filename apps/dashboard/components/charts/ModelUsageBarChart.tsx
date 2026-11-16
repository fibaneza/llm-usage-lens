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

import { MODEL_META, type ModelKey } from "@llm-usage-lens/shared";

import { ModelBadge } from "@/components/display/ModelBadge";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

import { ChartEmptyState } from "./ChartEmptyState";
import { formatUsd, type ModelBreakdownSlice } from "./chart-data";

type ModelUsageBarChartProps = {
  slices: readonly ModelBreakdownSlice[];
};

function isModelKey(key: string): key is ModelKey {
  return Object.hasOwn(MODEL_META, key);
}

const axisTick = { fill: "var(--color-muted-foreground)", fontSize: 12 };

export function ModelUsageBarChart({ slices }: ModelUsageBarChartProps) {
  const reducedMotion = usePrefersReducedMotion();

  if (slices.length === 0) return <ChartEmptyState />;

  // Each bar carries its model token as its own fill.
  const bars = slices.map((slice) => ({
    ...slice,
    fill: `var(${slice.colorVar})`,
  }));

  return (
    <div>
      <div
        role="img"
        aria-label="Model usage by cost, bar chart"
        className="h-72 w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bars}
            accessibilityLayer={false}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              stroke="var(--color-border)"
            />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={formatUsd}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={72}
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
              radius={4}
              maxBarSize={24}
              isAnimationActive={!reducedMotion}
              animationDuration={250}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul aria-label="Model legend" className="mt-3 flex flex-wrap gap-2">
        {slices.map((slice) => (
          <li key={slice.key}>
            {isModelKey(slice.key) ? (
              <ModelBadge model={slice.key} />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: `var(${slice.colorVar})` }}
                  className="size-2.5 shrink-0 rounded-full"
                />
                {slice.label}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="sr-only">
        <table>
          <caption>Model usage by cost, USD</caption>
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
