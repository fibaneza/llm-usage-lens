import type { DepartmentRow } from "@llm-usage-lens/shared";

type HeaderInput = Pick<
  DepartmentRow,
  "cost" | "inputTokens" | "outputTokens" | "invocations"
>;

type HeaderFigures = {
  totalCost: number;
  totalTokens: number;
  invocations: number;
};

type HeaderDeltas = {
  totalCost: number | null;
  totalTokens: number | null;
  invocations: number | null;
};

export type DepartmentHeaderStats = HeaderFigures & {
  previous: HeaderFigures | null;
  deltaPercent: HeaderDeltas;
};

function figuresOf(row: HeaderInput): HeaderFigures {
  return {
    totalCost: row.cost,
    totalTokens: row.inputTokens + row.outputTokens,
    invocations: row.invocations,
  };
}

// A missing or zero previous value has no meaningful percent change: null,
// never 0 or Infinity (Rule 20).
function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// Department detail header (implementation-phases Phase 4.4): total cost
// (model + non-model, Rule 20.3), tokens and invocations with the change vs
// the previous period.
export function departmentHeaderStats(
  current: HeaderInput,
  previous: HeaderInput | null | undefined,
): DepartmentHeaderStats {
  const now = figuresOf(current);
  const before = previous ? figuresOf(previous) : null;

  return {
    ...now,
    previous: before,
    deltaPercent: {
      totalCost: before ? deltaPercent(now.totalCost, before.totalCost) : null,
      totalTokens: before
        ? deltaPercent(now.totalTokens, before.totalTokens)
        : null,
      invocations: before
        ? deltaPercent(now.invocations, before.invocations)
        : null,
    },
  };
}
