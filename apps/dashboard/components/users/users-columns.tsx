import type { UserListRow } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { UserAvatar } from "@/components/display/UserAvatar";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import { PercentOfTotalBar } from "@/components/table/PercentOfTotalBar";
import { withDateRange } from "@/lib/date-range-search-params";

const NUMERIC = "font-mono tabular-nums";

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
    {
      accessorKey: "cost",
      header: "Cost",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          <UsdFigure value={row.original.cost} className={NUMERIC} />
          <CostEstimateIndicator compact />
        </span>
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
      id: "share",
      header: "% of Total",
      accessorFn: shareOf,
      cell: ({ row }) => <PercentOfTotalBar value={shareOf(row.original)} />,
    },
  ];
}
