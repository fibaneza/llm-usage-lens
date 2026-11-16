import type { UserListRow } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { UserAvatar } from "@/components/display/UserAvatar";
import { numericColumn } from "@/components/table/column-helpers";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import { PercentOfTotalBar } from "@/components/table/PercentOfTotalBar";
import type { CsvColumn } from "@/lib/csv";
import { withDateRange } from "@/lib/date-range-search-params";

export function usersColumns(
  urlRange: Record<string, string | null>,
  totalCost: number,
): ColumnDef<UserListRow>[] {
  const shareOf = (r: UserListRow) => (totalCost > 0 ? r.cost / totalCost : 0);
  return [
    {
      accessorKey: "userId",
      header: "User",
      enableHiding: false,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <UserAvatar userId={row.original.userId} />
          <span className="[overflow-wrap:anywhere] whitespace-normal">
            {row.original.userId}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "teamName",
      header: "Team",
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
    numericColumn<UserListRow>({
      accessorKey: "cost",
      header: "Cost",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          <UsdFigure value={row.original.cost} />
          <CostEstimateIndicator compact />
        </span>
      ),
    }),
    numericColumn<UserListRow>({
      id: "tokens",
      header: "Tokens",
      accessorFn: (r) => r.inputTokens + r.outputTokens,
      cell: ({ getValue }) => <CountFigure value={getValue<number>()} />,
    }),
    numericColumn<UserListRow>({
      accessorKey: "invocations",
      header: "Invocations",
      cell: ({ row }) => <CountFigure value={row.original.invocations} />,
    }),
    {
      id: "share",
      header: "% of Total",
      accessorFn: shareOf,
      cell: ({ row }) => <PercentOfTotalBar value={shareOf(row.original)} />,
    },
  ];
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

// Keyed by table column id so the export follows the visible columns; figures
// are raw numbers, never the formatted display text.
export function usersCsvColumns(
  totalCost: number,
): Record<string, CsvColumn<UserListRow>> {
  return {
    userId: { header: "User", value: (row) => row.userId },
    teamName: { header: "Team", value: (row) => row.teamName },
    departmentName: {
      header: "Department",
      value: (row) => row.departmentName,
    },
    cost: { header: "Cost", value: (row) => row.cost },
    tokens: {
      header: "Tokens",
      value: (row) => row.inputTokens + row.outputTokens,
    },
    invocations: { header: "Invocations", value: (row) => row.invocations },
    share: {
      header: "% of Total",
      value: (row) =>
        totalCost > 0 ? roundToTenth((row.cost / totalCost) * 100) : 0,
    },
  };
}
