import { Badge } from "@/components/ui/badge";

type CostEstimateIndicatorProps = {
  compact?: boolean;
};

const EXPLANATION =
  "Estimated cost: proportional allocation, not exact billing";

// Design System -- Component Inventory, `CostEstimateIndicator`: a subtle badge
// where a cost is an estimate (per-user and per-service cost, Rule 20.3). The
// compact form shows "Est." for tight table cells; the full word stays in the
// accessible name and the title.
export function CostEstimateIndicator({
  compact = false,
}: CostEstimateIndicatorProps) {
  return (
    <Badge
      variant="outline"
      title={EXPLANATION}
      className={
        compact
          ? "text-muted-foreground px-1.5 py-0 font-normal"
          : "text-muted-foreground font-normal"
      }
    >
      {compact ? (
        <>
          <span aria-hidden>Est.</span>
          <span className="sr-only">Estimated</span>
        </>
      ) : (
        "Estimated"
      )}
    </Badge>
  );
}
