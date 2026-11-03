import { Badge } from "@/components/ui/badge";

// Design System -- Component Inventory, `CostEstimateIndicator`: a subtle badge
// where a cost is an estimate (per-user and per-service cost, Rule 20.3).
export function CostEstimateIndicator() {
  return (
    <Badge
      variant="outline"
      title="Estimated cost: proportional allocation, not exact billing"
      className="text-muted-foreground font-normal"
    >
      Estimated
    </Badge>
  );
}
