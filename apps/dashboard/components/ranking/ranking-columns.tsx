import type { ColumnDef } from "@tanstack/react-table";

import { formatUsd } from "@/components/charts/chart-data";
import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { DeltaBadge } from "@/components/display/DeltaBadge";
import { PercentOfTotalBar } from "@/components/table/PercentOfTotalBar";
import { RankCell } from "@/components/table/RankingList";
import type { CsvColumn } from "@/lib/csv";

import { changeVsPrevious, type RankingTableRow } from "./ranking-rows";

const countFormatter = new Intl.NumberFormat("en-US");

const NUMERIC = "font-mono tabular-nums";

// Design System -- Ranking Page: Rank, Name, Cost, Input Tokens, Output
// Tokens, Invocations, % of Total, Trend. Headers stay plain strings so the
// column toggle and the CSV export can reuse them as labels.
export const RANKING_COLUMNS: ColumnDef<RankingTableRow>[] = [
  {
    accessorKey: "rank",
    header: "Rank",
    cell: ({ row }) => <RankCell rank={row.original.rank} />,
  },
  { accessorKey: "name", header: "Name", enableHiding: false },
  {
    accessorKey: "cost",
    header: "Cost",
    cell: ({ row }) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className={NUMERIC}>{formatUsd(row.original.cost)}</span>
        {row.original.costEstimated ? <CostEstimateIndicator /> : null}
      </span>
    ),
  },
  {
    accessorKey: "inputTokens",
    header: "Input Tokens",
    cell: ({ row }) => (
      <span className={NUMERIC}>
        {countFormatter.format(row.original.inputTokens)}
      </span>
    ),
  },
  {
    accessorKey: "outputTokens",
    header: "Output Tokens",
    cell: ({ row }) => (
      <span className={NUMERIC}>
        {countFormatter.format(row.original.outputTokens)}
      </span>
    ),
  },
  {
    accessorKey: "invocations",
    header: "Invocations",
    cell: ({ row }) => (
      <span className={NUMERIC}>
        {countFormatter.format(row.original.invocations)}
      </span>
    ),
  },
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
