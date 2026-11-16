"use client";

import type { DepartmentDetailResponse } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";

import { LazyCostTrendChart } from "@/components/charts/LazyCharts";
import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { Panel } from "@/components/display/Panel";
import { numericColumn } from "@/components/table/column-helpers";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import { RankCell } from "@/components/table/RankingList";
import { UsageTable } from "@/components/table/UsageTable";
import type { DateRange } from "@/lib/date-range";

type Team = DepartmentDetailResponse["teams"][number];

const TEAM_COLUMNS: ColumnDef<Team>[] = [
  {
    accessorKey: "teamName",
    header: "Team",
    enableHiding: false,
    cell: ({ row }) => (
      <span className="[overflow-wrap:anywhere] whitespace-normal">
        {row.original.teamName}
      </span>
    ),
  },
  numericColumn<Team>({
    accessorKey: "cost",
    header: "Cost",
    cell: ({ row }) => <UsdFigure value={row.original.cost} />,
  }),
  numericColumn<Team>({
    accessorKey: "inputTokens",
    header: "Input Tokens",
    cell: ({ row }) => <CountFigure value={row.original.inputTokens} />,
  }),
  numericColumn<Team>({
    accessorKey: "outputTokens",
    header: "Output Tokens",
    cell: ({ row }) => <CountFigure value={row.original.outputTokens} />,
  }),
  numericColumn<Team>({
    accessorKey: "invocations",
    header: "Invocations",
    cell: ({ row }) => <CountFigure value={row.original.invocations} />,
  }),
];

function Empty({ children }: { children: string }) {
  return <p className="text-muted-foreground py-6 text-sm">{children}</p>;
}

type DepartmentSectionsProps = {
  department: DepartmentDetailResponse;
  range: DateRange;
};

// The three data sections under the header (implementation-phases Phase 4.4),
// each in its own boundary so one failure never breaks the page (Rule 40.4).
// Per-user cost is an allocation, so every user row carries the estimate
// marker (Rule 20.3).
export function DepartmentSections({
  department,
  range,
}: DepartmentSectionsProps) {
  const resetKey = `${range.dateFrom}:${range.dateTo}`;
  const teamNames = Object.fromEntries(
    department.teams.map((t) => [t.teamId, t.teamName]),
  );

  return (
    <>
      <Panel
        title="Teams breakdown"
        boundaryTitle="teams breakdown"
        resetKeys={[resetKey]}
      >
        {department.teams.length === 0 ? (
          <Empty>No teams in this period.</Empty>
        ) : (
          <UsageTable<Team>
            data={department.teams}
            columns={TEAM_COLUMNS}
            getRowId={(row) => row.teamId}
            initialSort={{ id: "cost", desc: true }}
            caption="Teams in this department"
          />
        )}
      </Panel>
      <Panel
        title="Cost by team over time"
        boundaryTitle="cost by team over time"
        resetKeys={[resetKey]}
      >
        <LazyCostTrendChart
          groupBy="team"
          data={department.teamTrend}
          teamNames={teamNames}
        />
      </Panel>
      <Panel title="Top users" boundaryTitle="top users" resetKeys={[resetKey]}>
        {department.topUsers.length === 0 ? (
          <Empty>No users in this period.</Empty>
        ) : (
          <ol className="divide-border flex flex-col divide-y">
            {department.topUsers.map((user, index) => (
              <li
                key={user.userId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
              >
                <RankCell rank={index + 1} />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {user.userId}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <UsdFigure
                    value={user.cost}
                    className="font-mono tabular-nums"
                  />
                  {user.costEstimated ? <CostEstimateIndicator /> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}
