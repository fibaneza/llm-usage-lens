import type { ColumnDef } from "@tanstack/react-table";

import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { DeltaBadge } from "@/components/display/DeltaBadge";
import {
  CountFigure,
  UsdFigure,
  useFigureFormat,
} from "@/components/table/figures";
import { numericColumn } from "@/components/table/column-helpers";
import { PercentOfTotalBar } from "@/components/table/PercentOfTotalBar";
import { RankCell } from "@/components/table/RankingList";
import type { CsvColumn } from "@/lib/csv";

import { changeVsPrevious, type RankingTableRow } from "./ranking-rows";

// The Estimated marker shortens to "Est." beside abbreviated figures, where
// width is scarce.
function CostCell({ row }: { row: RankingTableRow }) {
  const compact = useFigureFormat() === "compact";

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <UsdFigure value={row.cost} />
      {row.costEstimated ? <CostEstimateIndicator compact={compact} /> : null}
    </span>
  );
}

// Design System -- Ranking Page: Rank, Name, Cost, Input Tokens, Output
// Tokens, Invocations, % of Total, Trend. Headers stay plain strings so the
// column toggle and the CSV export can reuse them as labels.
export const RANKING_COLUMNS: ColumnDef<RankingTableRow>[] = [
  {
    accessorKey: "rank",
    header: "Rank",
    cell: ({ row }) => <RankCell rank={row.original.rank} />,
  },
  {
    accessorKey: "name",
    header: "Name",
    enableHiding: false,
    // Long names wrap rather than widen the table (Design System --
    // Responsive Tables: no horizontal scroll).
    cell: ({ row }) => (
      <span className="[overflow-wrap:anywhere] whitespace-normal">
        {row.original.name}
      </span>
    ),
  },
  numericColumn<RankingTableRow>({
    accessorKey: "cost",
    header: "Cost",
    cell: ({ row }) => <CostCell row={row.original} />,
  }),
  numericColumn<RankingTableRow>({
    accessorKey: "inputTokens",
    header: "Input Tokens",
    cell: ({ row }) => <CountFigure value={row.original.inputTokens} />,
  }),
  numericColumn<RankingTableRow>({
    accessorKey: "outputTokens",
    header: "Output Tokens",
    cell: ({ row }) => <CountFigure value={row.original.outputTokens} />,
  }),
  numericColumn<RankingTableRow>({
    accessorKey: "invocations",
    header: "Invocations",
    cell: ({ row }) => <CountFigure value={row.original.invocations} />,
  }),
  {
    accessorKey: "share",
    header: "% of Total",
    cell: ({ row }) => <PercentOfTotalBar value={row.original.share} />,
  },
  {
    id: "trend",
    header: "Trend",
    enableSorting: false,
    accessorFn: changeVsPrevious,
    cell: ({ row }) =>
      changeVsPrevious(row.original) === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <DeltaBadge
          current={row.original.cost}
          previous={row.original.previousCost}
        />
      ),
  },
];

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

// CSV columns keyed by table column id, so the export follows whichever columns
// the table shows, in the order it shows them. Cost and token counts are raw
// numbers, never the formatted display text.
export const RANKING_CSV_COLUMNS: Record<string, CsvColumn<RankingTableRow>> = {
  rank: { header: "Rank", value: (row) => row.rank },
  name: { header: "Name", value: (row) => row.name },
  cost: { header: "Cost", value: (row) => row.cost },
  inputTokens: { header: "Input Tokens", value: (row) => row.inputTokens },
  outputTokens: { header: "Output Tokens", value: (row) => row.outputTokens },
  invocations: { header: "Invocations", value: (row) => row.invocations },
  share: {
    header: "% of Total",
    value: (row) => roundToTenth(row.share * 100),
  },
  trend: {
    header: "Trend",
    value: (row) => {
      const change = changeVsPrevious(row);
      return change === null ? "" : roundToTenth(change);
    },
  },
};
