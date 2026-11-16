"use client";

import type { TeamDetailResponse } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";

import { LazyModelUsageBarChart } from "@/components/charts/LazyCharts";
import { toModelBreakdownSlices } from "@/components/charts/chart-data";
import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { Panel } from "@/components/display/Panel";
import { UserAvatar } from "@/components/display/UserAvatar";
import { numericColumn } from "@/components/table/column-helpers";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import { UsageTable } from "@/components/table/UsageTable";
import type { DateRange } from "@/lib/date-range";
import { serviceLabel } from "@/lib/service-label";

type ServiceRow = TeamDetailResponse["services"][number];
type UserRow = TeamDetailResponse["users"][number];
type Attribution = ServiceRow | UserRow;

function metricColumns<T extends Attribution>(): ColumnDef<T>[] {
  return [
    numericColumn<T>({
      accessorKey: "cost",
      header: "Cost",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          <UsdFigure value={row.original.cost} />
          {row.original.costEstimated ? (
            <CostEstimateIndicator compact />
          ) : null}
        </span>
      ),
    }),
    numericColumn<T>({
      accessorKey: "inputTokens",
      header: "Input Tokens",
      cell: ({ row }) => <CountFigure value={row.original.inputTokens} />,
    }),
    numericColumn<T>({
      accessorKey: "outputTokens",
      header: "Output Tokens",
      cell: ({ row }) => <CountFigure value={row.original.outputTokens} />,
    }),
    numericColumn<T>({
      accessorKey: "invocations",
      header: "Invocations",
      cell: ({ row }) => <CountFigure value={row.original.invocations} />,
    }),
  ];
}

const SERVICE_COLUMNS: ColumnDef<ServiceRow>[] = [
  {
    id: "serviceName",
    header: "Service",
    enableHiding: false,
    accessorFn: (row) => serviceLabel(row.serviceName),
    cell: ({ getValue }) => (
      <span className="[overflow-wrap:anywhere] whitespace-normal">
        {getValue<string>()}
      </span>
    ),
  },
  ...metricColumns<ServiceRow>(),
];

const USER_COLUMNS: ColumnDef<UserRow>[] = [
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
  ...metricColumns<UserRow>(),
];

function Empty({ children }: { children: string }) {
  return <p className="text-muted-foreground py-6 text-sm">{children}</p>;
}

type TeamSectionsProps = {
  team: TeamDetailResponse;
  range: DateRange;
};

// The three data sections under the header (implementation-phases Phase 4.6),
// each in its own boundary so one failure never breaks the page (Rule 40.4).
// Per-service and per-user cost are allocations, so rows carry the estimate
// marker (Rule 20.3).
export function TeamSections({ team, range }: TeamSectionsProps) {
  const resetKey = `${range.dateFrom}:${range.dateTo}`;

  return (
    <>
      <Panel
        title="Services breakdown"
        boundaryTitle="services breakdown"
        resetKeys={[resetKey]}
      >
        {team.services.length === 0 ? (
          <Empty>No services in this period.</Empty>
        ) : (
          <UsageTable<ServiceRow>
            data={team.services}
            columns={SERVICE_COLUMNS}
            getRowId={(row) => row.serviceName}
            initialSort={{ id: "cost", desc: true }}
            caption="Services used by this team"
          />
        )}
      </Panel>
      <Panel
        title="Users breakdown"
        boundaryTitle="users breakdown"
        resetKeys={[resetKey]}
      >
        {team.users.length === 0 ? (
          <Empty>No users in this period.</Empty>
        ) : (
          <UsageTable<UserRow>
            data={team.users}
            columns={USER_COLUMNS}
            getRowId={(row) => row.userId}
            initialSort={{ id: "cost", desc: true }}
            caption="Users in this team"
          />
        )}
      </Panel>
      <Panel
        title="Model usage"
        boundaryTitle="model usage"
        resetKeys={[resetKey]}
      >
        <LazyModelUsageBarChart
          slices={toModelBreakdownSlices(team.byModel, 0)}
        />
      </Panel>
    </>
  );
}
