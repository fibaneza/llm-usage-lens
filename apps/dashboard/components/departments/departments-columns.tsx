import { MODEL_META, type DepartmentRow } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { DeltaBadge } from "@/components/display/DeltaBadge";
import { numericColumn } from "@/components/table/column-helpers";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import type { CsvColumn } from "@/lib/csv";
import { withDateRange } from "@/lib/date-range-search-params";

export type DepartmentTableRow = DepartmentRow & {
  // Same department's cost in the previous period, matched by id; null when it
  // has none.
  previousCost: number | null;
};

function tokensOf(row: DepartmentRow): number {
  return row.inputTokens + row.outputTokens;
}

// A null `topModel` is a neutral "No model usage", never a fake model
// (Rule 20.5, 20.12).
function topModelLabel(row: DepartmentRow): string {
  return row.topModel === null
    ? "No model usage"
    : MODEL_META[row.topModel].displayName;
}

// Design System -- Navigation (Sidebar) table, Departments row: name, cost,
// change, tokens, teams, top model. Headers stay plain strings so the column
// toggle and the CSV export can reuse them as labels.
export function departmentsColumns(
  urlRange: Record<string, string | null>,
): ColumnDef<DepartmentTableRow>[] {
  return [
    {
      accessorKey: "departmentName",
      header: "Department",
      enableHiding: false,
      cell: ({ row }) => (
        <Link
          className="text-primary [overflow-wrap:anywhere] whitespace-normal underline-offset-4 hover:underline"
          href={withDateRange(
            `/dashboard/departments/${encodeURIComponent(row.original.departmentId)}`,
            { get: (key) => urlRange[key] ?? null },
          )}
        >
          {row.original.departmentName}
        </Link>
      ),
    },
    numericColumn<DepartmentTableRow>({
      accessorKey: "cost",
      header: "Cost",
      cell: ({ row }) => <UsdFigure value={row.original.cost} />,
    }),
    {
      id: "change",
      header: "Change",
      enableSorting: false,
      cell: ({ row }) => (
        <DeltaBadge
          current={row.original.cost}
          previous={row.original.previousCost}
        />
      ),
    },
    numericColumn<DepartmentTableRow>({
      id: "tokens",
      header: "Tokens",
      accessorFn: tokensOf,
      cell: ({ getValue }) => <CountFigure value={getValue<number>()} />,
    }),
    numericColumn<DepartmentTableRow>({
      accessorKey: "teamCount",
      header: "Teams",
      cell: ({ row }) => String(row.original.teamCount),
    }),
    {
      id: "topModel",
      header: "Top model",
      accessorFn: topModelLabel,
    },
  ];
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

// Keyed by table column id so the export follows the visible columns. Cost and
// token counts are raw numbers, never the formatted display text.
export const DEPARTMENTS_CSV_COLUMNS: Record<
  string,
  CsvColumn<DepartmentTableRow>
> = {
  departmentName: { header: "Department", value: (row) => row.departmentName },
  cost: { header: "Cost", value: (row) => row.cost },
  change: {
    header: "Change",
    value: (row) =>
      row.previousCost === null || row.previousCost === 0
        ? ""
        : roundToTenth(
            ((row.cost - row.previousCost) / row.previousCost) * 100,
          ),
  },
  tokens: { header: "Tokens", value: tokensOf },
  teamCount: { header: "Teams", value: (row) => row.teamCount },
  topModel: { header: "Top model", value: topModelLabel },
};
