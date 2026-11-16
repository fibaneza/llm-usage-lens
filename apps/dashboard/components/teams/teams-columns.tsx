import type { TeamRow } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { numericColumn } from "@/components/table/column-helpers";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import type { CsvColumn } from "@/lib/csv";
import { withDateRange } from "@/lib/date-range-search-params";

export function teamsColumns(
  urlRange: Record<string, string | null>,
): ColumnDef<TeamRow>[] {
  return [
    {
      accessorKey: "teamName",
      header: "Team Name",
      enableHiding: false,
      cell: ({ row }) => (
        <Link
          className="text-primary [overflow-wrap:anywhere] whitespace-normal underline-offset-4 hover:underline"
          href={withDateRange(
            `/dashboard/teams/${encodeURIComponent(row.original.teamId)}`,
            { get: (key) => urlRange[key] ?? null },
          )}
        >
          {row.original.teamName}
        </Link>
      ),
    },
    { accessorKey: "departmentName", header: "Department" },
    numericColumn<TeamRow>({
      accessorKey: "cost",
      header: "Cost",
      cell: ({ row }) => <UsdFigure value={row.original.cost} />,
    }),
    numericColumn<TeamRow>({
      id: "tokens",
      header: "Tokens",
      accessorFn: (r) => r.inputTokens + r.outputTokens,
      cell: ({ getValue }) => <CountFigure value={getValue<number>()} />,
    }),
    numericColumn<TeamRow>({
      accessorKey: "invocations",
      header: "Invocations",
      cell: ({ row }) => <CountFigure value={row.original.invocations} />,
    }),
    numericColumn<TeamRow>({
      accessorKey: "serviceCount",
      header: "Services",
      cell: ({ row }) => <CountFigure value={row.original.serviceCount} />,
    }),
    numericColumn<TeamRow>({
      accessorKey: "userCount",
      header: "Users",
      cell: ({ row }) => <CountFigure value={row.original.userCount} />,
    }),
  ];
}

// Keyed by table column id so the export follows the visible columns; figures
// are raw numbers, never the formatted display text.
export const TEAMS_CSV_COLUMNS: Record<string, CsvColumn<TeamRow>> = {
  teamName: { header: "Team Name", value: (row) => row.teamName },
  departmentName: { header: "Department", value: (row) => row.departmentName },
  cost: { header: "Cost", value: (row) => row.cost },
  tokens: {
    header: "Tokens",
    value: (row) => row.inputTokens + row.outputTokens,
  },
  invocations: { header: "Invocations", value: (row) => row.invocations },
  serviceCount: { header: "Services", value: (row) => row.serviceCount },
  userCount: { header: "Users", value: (row) => row.userCount },
};
