import { formatUsd } from "@/components/charts/chart-data";
import { DeltaBadge } from "@/components/display/DeltaBadge";

type PeriodMetric = {
  label: string;
  current: number;
  previous: number | null;
  kind: "usd" | "count";
};

type PeriodComparisonProps = {
  days: number;
  metrics: readonly PeriodMetric[];
};

const countFormatter = new Intl.NumberFormat("en-US");

function formatValue(value: number, kind: PeriodMetric["kind"]): string {
  return kind === "usd" ? formatUsd(value) : countFormatter.format(value);
}

// Design System -- Component Inventory, `PeriodComparison`: current vs previous
// period side by side. A missing previous period shows a dash and no badge,
// never a fake 0 (Rule 20).
export function PeriodComparison({ days, metrics }: PeriodComparisonProps) {
  return (
    <div
      role="group"
      aria-label="Period comparison"
      className="flex flex-col gap-3"
    >
      <p className="text-muted-foreground text-sm">{`vs previous ${days} ${days === 1 ? "day" : "days"}`}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            role="group"
            aria-label={metric.label}
            className="flex flex-col gap-1"
          >
            <span className="text-muted-foreground text-sm font-medium">
              {metric.label}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs">Current</span>
                <span className="font-mono text-lg font-semibold tabular-nums">
                  {formatValue(metric.current, metric.kind)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs">Previous</span>
                <span className="font-mono text-lg tabular-nums">
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
