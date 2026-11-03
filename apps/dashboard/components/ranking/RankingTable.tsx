"use client";

import type { RankingRow } from "@bedrock-usage/shared";
import { useMemo } from "react";

import { ExportButton } from "@/components/table/ExportButton";
import { UsageTable } from "@/components/table/UsageTable";

import { RANKING_COLUMNS, RANKING_CSV_COLUMNS } from "./ranking-columns";
import { buildRankingRows, type RankingTableRow } from "./ranking-rows";

type RankingTableProps = {
  current: readonly RankingRow[];
  previous: readonly RankingRow[] | undefined;
  filename: string;
};

// The ranking leaderboard (Design System -- Ranking Page) is the shared
// `UsageTable`; the CSV export sits in its toolbar slot so it reads the table's
// filtered and sorted rows and visible columns. % of Total stays relative to
// all returned rows.
export function RankingTable({
  current,
  previous,
  filename,
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
      toolbarActions={({ rows, visibleColumnIds }) => (
        <ExportButton
          filename={filename}
          columns={visibleColumnIds.flatMap(
            (id) => RANKING_CSV_COLUMNS[id] ?? [],
          )}
          rows={rows}
        />
      )}
    />
  );
}
