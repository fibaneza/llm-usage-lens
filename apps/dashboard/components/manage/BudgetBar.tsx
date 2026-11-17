import { cn } from "@/lib/utils";

type BudgetBarProps = {
  spend: number;
  budget: number | null | undefined;
};

const WARNING_AT = 80;
const DESTRUCTIVE_AT = 100;

type BudgetState = "neutral" | "warning" | "destructive";

const FILL: Record<BudgetState, string> = {
  neutral: "bg-muted-foreground",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

export function budgetPercent(spend: number, budget: number): number {
  return Math.round((spend / budget) * 100);
}

// Design System - Management pages, Budget as a bar: a thin bar, neutral below
// 80%, warning from 80%, destructive at 100% and over, with the percentage as
// text beside it (colour is never the only signal); "No limit" without a
// budget. Tokens only (Rule 40.2).
export function BudgetBar({ spend, budget }: BudgetBarProps) {
  if (!budget || budget <= 0) {
    return <span className="text-muted-foreground text-cell">No limit</span>;
  }
  const percent = budgetPercent(spend, budget);
  const state: BudgetState =
    percent >= DESTRUCTIVE_AT
      ? "destructive"
      : percent >= WARNING_AT
        ? "warning"
        : "neutral";
  const fill = Math.min(100, Math.max(0, percent));

  return (
    <span className="flex items-center gap-2">
      <span
        role="progressbar"
        aria-label="Budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill}
        data-state={state}
        className="bg-muted h-1.5 w-24 overflow-hidden rounded-full"
      >
        <span
          className={cn("block h-full rounded-full", FILL[state])}
          style={{ width: `${fill}%` }}
        />
      </span>
      <span className="text-cell font-mono tabular-nums">{percent}%</span>
    </span>
  );
}
