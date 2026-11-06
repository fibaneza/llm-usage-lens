"use client";

import type { TeamDetailResponse } from "@bedrock-usage/shared";
import type { ColumnDef } from "@tanstack/react-table";
import { useId, type ReactNode } from "react";

import { LazyModelUsageBarChart } from "@/components/charts/LazyCharts";
import { toModelBreakdownSlices } from "@/components/charts/chart-data";
import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { UserAvatar } from "@/components/display/UserAvatar";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import { UsageTable } from "@/components/table/UsageTable";
import type { DateRange } from "@/lib/date-range";
import { serviceLabel } from "@/lib/service-label";

type ServiceRow = TeamDetailResponse["services"][number];
type UserRow = TeamDetailResponse["users"][number];
type Attribution = ServiceRow | UserRow;

const NUMERIC = "font-mono tabular-nums";

function metricColumns<T extends Attribution>(): ColumnDef<T>[] {
  return [
    {
      accessorKey: "cost",
      header: "Cost",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          <UsdFigure value={row.original.cost} className={NUMERIC} />
          {row.original.costEstimated ? (
            <CostEstimateIndicator compact />
          ) : null}
        </span>
      ),
    },
    {
      accessorKey: "inputTokens",
      header: "Input Tokens",
      cell: ({ row }) => (
        <CountFigure value={row.original.inputTokens} className={NUMERIC} />
      ),
    },
    {
      accessorKey: "outputTokens",
      header: "Output Tokens",
      cell: ({ row }) => (
        <CountFigure value={row.original.outputTokens} className={NUMERIC} />
      ),
    },
    {
      accessorKey: "invocations",
      header: "Invocations",
      cell: ({ row }) => (
        <CountFigure value={row.original.invocations} className={NUMERIC} />
      ),
    },
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

type SectionProps = {
  title: string;
  resetKey: unknown;
  children: ReactNode;
};

function Section({ title, resetKey, children }: SectionProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      <SectionBoundary title={title.toLowerCase()} resetKeys={[resetKey]}>
        {children}
      </SectionBoundary>
    </section>
  );
}

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
      <Section title="Services breakdown" resetKey={resetKey}>
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
      </Section>
      <Section title="Users breakdown" resetKey={resetKey}>
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
      </Section>
      <Section title="Model usage" resetKey={resetKey}>
        <LazyModelUsageBarChart
          slices={toModelBreakdownSlices(team.byModel, 0)}
        />
      </Section>
    </>
  );
}
