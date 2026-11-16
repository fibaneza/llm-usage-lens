import { formatUsd } from "@/components/charts/chart-data";
import { DeltaBadge } from "@/components/display/DeltaBadge";
import { cn } from "@/lib/utils";

type PeriodMetric = {
  label: string;
  current: number;
  previous: number | null;
  kind: "usd" | "count";
};

type PeriodComparisonProps = {
  days: number;
  metrics: readonly PeriodMetric[];
  // Lets the strip span a parent grid (the KPI row on the detail pages).
  className?: string;
};

const countFormatter = new Intl.NumberFormat("en-US");

function formatValue(value: number, kind: PeriodMetric["kind"]): string {
  return kind === "usd" ? formatUsd(value) : countFormatter.format(value);
}

// Design System -- Component Inventory, `PeriodComparison`: current vs previous
// period side by side. A missing previous period shows a dash and no badge,
// never a fake 0 (Rule 20).
export function PeriodComparison({
  days,
  metrics,
  className,
}: PeriodComparisonProps) {
  return (
    <div
      role="group"
      aria-label="Period comparison"
      className={cn("flex flex-col gap-2", className)}
    >
      <p className="text-muted-foreground text-xs">{`vs previous ${days} ${days === 1 ? "day" : "days"}`}</p>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            role="group"
            aria-label={metric.label}
            className="flex flex-col gap-1"
          >
            <span className="text-muted-foreground text-xs font-medium">
              {metric.label}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs">Current</span>
                <span className="font-mono text-base font-semibold tabular-nums">
                  {formatValue(metric.current, metric.kind)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs">Previous</span>
                <span className="font-mono text-base tabular-nums">
                  {metric.previous === null
                    ? "—"
                    : formatValue(metric.previous, metric.kind)}
                </span>
              </div>
              <DeltaBadge current={metric.current} previous={metric.previous} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
