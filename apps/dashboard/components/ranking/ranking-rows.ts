import type { RankingRow } from "@llm-usage-lens/shared";

export type RankingTableRow = RankingRow & {
  // 1-based position by cost, highest first.
  rank: number;
  // Fraction (0-1) of the summed cost of every returned row.
  share: number;
  // Same entity's cost in the previous period, matched by id; null when it has
  // no previous row.
  previousCost: number | null;
};

// Joins the current period with the previous one (Design System -- Ranking
// Page, Trend). Rows come back ordered by cost descending so rank follows that
// order; the previous period is optional because it loads independently.
export function buildRankingRows(
  current: readonly RankingRow[],
  previous: readonly RankingRow[] | undefined,
): RankingTableRow[] {
  const total = current.reduce((sum, row) => sum + row.cost, 0);
  const previousCosts = new Map(
    (previous ?? []).map((row) => [row.id, row.cost]),
  );

  return [...current]
    .sort((a, b) => b.cost - a.cost)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      share: total > 0 ? row.cost / total : 0,
      previousCost: previousCosts.get(row.id) ?? null,
    }));
}

// Percentage change vs the previous period, or null when there is no usable
// previous cost -- never a fake 0%, matching DeltaBadge.
export function changeVsPrevious(row: RankingTableRow): number | null {
  if (row.previousCost === null || row.previousCost === 0) return null;
  return ((row.cost - row.previousCost) / row.previousCost) * 100;
}
