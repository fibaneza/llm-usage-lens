"use client";

import type { RankingRow } from "@llm-usage-lens/shared";
import { type ReactNode, useMemo } from "react";

import { ExportButton } from "@/components/table/ExportButton";
import { UsageTable } from "@/components/table/UsageTable";

import { RANKING_COLUMNS, RANKING_CSV_COLUMNS } from "./ranking-columns";
import { buildRankingRows, type RankingTableRow } from "./ranking-rows";

type RankingTableProps = {
  current: readonly RankingRow[];
  previous: readonly RankingRow[] | undefined;
  filename: string;
  modelFilter: ReactNode;
  // Replaces the table: the skeleton while the first result is pending, the
  // empty state for an empty period.
  bodyOverride: ReactNode;
  // A selection change is in flight; the export would write stale rows.
  pending: boolean;
};

// The ranking leaderboard (Design System -- Ranking Page) is the shared
// `UsageTable`; the CSV export sits in its toolbar slot so it reads the table's
// filtered and sorted rows and visible columns. % of Total stays relative to
// all returned rows.
export function RankingTable({
  current,
  previous,
  filename,
  modelFilter,
  bodyOverride,
  pending,
}: RankingTableProps) {
  const data = useMemo(
    () => buildRankingRows(current, previous),
    [current, previous],
  );

  return (
    <UsageTable<RankingTableRow>
      data={data}
      columns={RANKING_COLUMNS}
      getRowId={(row) => row.id}
      initialSort={{ id: "cost", desc: true }}
      searchKey="name"
      searchPlaceholder="Search by name"
      caption="Cost ranking"
      emptyState={
        <p className="text-muted-foreground py-6 text-center text-sm">
          No names match your search.
        </p>
      }
      bodyOverride={bodyOverride}
      toolbarStart={modelFilter}
      toolbarActions={({ rows, visibleColumnIds }) => (
        <ExportButton
          filename={filename}
          columns={visibleColumnIds.flatMap(
            (id) => RANKING_CSV_COLUMNS[id] ?? [],
          )}
          rows={rows}
          disabled={pending || rows.length === 0}
        />
      )}
    />
  );
}
