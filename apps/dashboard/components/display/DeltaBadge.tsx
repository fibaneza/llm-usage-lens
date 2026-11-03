import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

type DeltaBadgeProps = {
  current: number;
  previous: number | null;
};

// Design System -- Component Inventory, `DeltaBadge`: a positive delta is
// green (success token), a negative delta is red (destructive token). The
// colour sits on the arrow only (non-text contrast, 3:1): `--color-success`
// measures 3.77:1 on the card, below the 4.5:1 the percentage text needs
// (Design System -- UX Standards). With no usable previous period nothing is
// rendered -- never a fake 0% (Rule 20).
export function DeltaBadge({ current, previous }: DeltaBadgeProps) {
  if (previous === null || previous === 0) return null;

  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  const magnitude = Math.abs(percent).toFixed(1);

  if (percent === 0) {
    return (
      <span
        role="img"
        aria-label="No change vs previous period"
        className="text-muted-foreground inline-flex items-center gap-0.5 text-xs font-medium"
      >
        <Minus className="size-3" aria-hidden />
        <span className="font-mono">{`${magnitude}%`}</span>
      </span>
    );
  }

  const isUp = percent > 0;
  const Arrow = isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      role="img"
      aria-label={`${isUp ? "Up" : "Down"} ${magnitude}% vs previous period`}
      className="text-foreground inline-flex items-center gap-0.5 text-xs font-medium"
    >
      <Arrow
        className={cn("size-3", isUp ? "text-success" : "text-destructive")}
        aria-hidden
      />
      <span className="font-mono">{`${isUp ? "+" : "-"}${magnitude}%`}</span>
    </span>
  );
}
