import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MetricCardProps = {
  title: string;
  value: string;
  icon: LucideIcon;
  trend?: ReactNode;
  description?: ReactNode;
};

// Design System -- Component Inventory, `MetricCard`: KPI card with value,
// trend indicator and icon on the shadcn Card; the value uses the numeric
// face (Rule 40.7).
export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
}: MetricCardProps) {
  const titleId = useId();

  return (
    <Card role="group" aria-labelledby={titleId} className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
        <CardTitle
          id={titleId}
          className="text-muted-foreground text-sm font-medium"
        >
          {title}
        </CardTitle>
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {value}
          </span>
          {trend}
        </div>
        {description ? (
          <div className="text-muted-foreground text-xs">{description}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
