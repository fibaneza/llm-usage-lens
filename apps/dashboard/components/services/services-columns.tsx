import type { ServiceListRow } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import { PercentOfTotalBar } from "@/components/table/PercentOfTotalBar";
import { withDateRange } from "@/lib/date-range-search-params";
import { serviceLabel } from "@/lib/service-label";

const NUMERIC = "font-mono tabular-nums";

export function servicesColumns(
  urlRange: Record<string, string | null>,
  totalCost: number,
): ColumnDef<ServiceListRow>[] {
  const shareOf = (r: ServiceListRow) =>
    totalCost > 0 ? r.cost / totalCost : 0;
  return [
    {
      id: "serviceName",
      header: "Service Name",
      enableHiding: false,
      accessorFn: (r) => serviceLabel(r.serviceName),
      cell: ({ getValue }) => (
        <span className="[overflow-wrap:anywhere] whitespace-normal">
          {getValue<string>()}
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
