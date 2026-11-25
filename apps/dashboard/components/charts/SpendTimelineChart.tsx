"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

import { ChartEmptyState } from "./ChartEmptyState";

type SpendTimelineSeries = {
  key: string;
  label: string;
  // CSS custom property of the series token, e.g. `--color-team-1`.
  colorVar: string;
  values: Record<string, number>;
};

type SpendTimelineChartProps = {
  // Every UTC day of the range, in order (Rule 20.1): one slot each.
  days: string[];
  series: SpendTimelineSeries[];
  format: (value: number) => string;
  // Names the chart for assistive technology.
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

type BarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
};

// A plain <rect> per bar, so each reported day is one element in the DOM.
function BarRect({ x, y, width, height, fill }: BarShapeProps) {
  if (x === undefined || y === undefined || !width || !height) return null;
  return <rect x={x} y={y} width={width} height={height} fill={fill} />;
}

type Row = { date: string } & Record<string, number | string | undefined>;

function SpendTooltip({
  active,
  label: day,
  series,
  format,
}: Pick<TooltipContentProps, "active" | "label"> &
  Pick<SpendTimelineChartProps, "series" | "format">) {
  if (!active || typeof day !== "string") return null;
  const present = series.filter((s) => s.values[day] !== undefined);
  if (present.length === 0) return null;
  const total = present.reduce((sum, s) => sum + (s.values[day] ?? 0), 0);
  return (
    <div
      className="text-cell rounded-card border p-2"
      style={{
        backgroundColor: "var(--color-popover)",
        color: "var(--color-popover-foreground)",
        borderColor: "var(--color-border)",
      }}
    >
      <p className="font-medium">{formatDate(day)}</p>
      <ul className="mt-1 space-y-0.5">
        {present.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(${s.colorVar})` }}
            />
            <span>{s.label}</span>
            <span className="ml-auto pl-3 font-mono tabular-nums">
              {format(s.values[day] ?? 0)}
            </span>
          </li>
        ))}
      </ul>
      {series.length > 1 ? (
        <p className="mt-1 flex justify-between border-t pt-1 font-medium">
          <span>Total</span>
          <span className="font-mono tabular-nums">{format(total)}</span>
        </p>
      ) : null}
    </div>
  );
}

// Design System -- Component Inventory, `SpendTimelineChart`: one bar slot per
// day, a bar only where a value was reported, several series stacked.
export function SpendTimelineChart({
  days,
  series,
  format,
  label,
}: SpendTimelineChartProps) {
  const reducedMotion = usePrefersReducedMotion();
  const hasValue = series.some((s) => Object.keys(s.values).length > 0);
  if (!hasValue) return <ChartEmptyState />;

  const data: Row[] = days.map((date) => {
    const row: Row = { date };
    for (const s of series) {
      const value = s.values[date];
      if (value !== undefined) row[s.key] = value;
    }
    return row;
  });
  const stacked = series.length > 1;

  return (
    <div role="img" aria-label={label} className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
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
            tickFormatter={format}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            content={(props) => (
              <SpendTooltip
                active={props.active}
                label={props.label}
                series={series}
                format={format}
              />
            )}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? "timeline" : undefined}
              fill={`var(${s.colorVar})`}
              shape={BarRect}
              isAnimationActive={!reducedMotion}
              animationDuration={250}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
