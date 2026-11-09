import type { TeamRow } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { CountFigure, UsdFigure } from "@/components/table/figures";
import { withDateRange } from "@/lib/date-range-search-params";

const NUMERIC = "font-mono tabular-nums";

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
    {
      accessorKey: "cost",
      header: "Cost",
      cell: ({ row }) => (
        <UsdFigure value={row.original.cost} className={NUMERIC} />
      ),
    },
    {
      id: "tokens",
      header: "Tokens",
      accessorFn: (r) => r.inputTokens + r.outputTokens,
      cell: ({ getValue }) => (
        <CountFigure value={getValue<number>()} className={NUMERIC} />
      ),
    },
    {
      accessorKey: "invocations",
      header: "Invocations",
      cell: ({ row }) => (
        <CountFigure value={row.original.invocations} className={NUMERIC} />
      ),
    },
    {
      accessorKey: "serviceCount",
      header: "Services",
      cell: ({ row }) => (
        <CountFigure value={row.original.serviceCount} className={NUMERIC} />
      ),
    },
    {
      accessorKey: "userCount",
      header: "Users",
      cell: ({ row }) => (
        <CountFigure value={row.original.userCount} className={NUMERIC} />
      ),
    },
  ];
}
