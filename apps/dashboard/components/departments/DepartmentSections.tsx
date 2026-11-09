"use client";

import type { DepartmentDetailResponse } from "@llm-usage-lens/shared";
import type { ColumnDef } from "@tanstack/react-table";
import { useId, type ReactNode } from "react";

import { LazyCostTrendChart } from "@/components/charts/LazyCharts";
import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { CountFigure, UsdFigure } from "@/components/table/figures";
import { RankCell } from "@/components/table/RankingList";
import { UsageTable } from "@/components/table/UsageTable";
import type { DateRange } from "@/lib/date-range";

type Team = DepartmentDetailResponse["teams"][number];

const NUMERIC = "font-mono tabular-nums";

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
  {
    accessorKey: "cost",
    header: "Cost",
    cell: ({ row }) => (
      <UsdFigure value={row.original.cost} className={NUMERIC} />
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
      <Section title="Teams breakdown" resetKey={resetKey}>
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
      </Section>
      <Section title="Cost by team over time" resetKey={resetKey}>
        <LazyCostTrendChart
          groupBy="team"
          data={department.teamTrend}
          teamNames={teamNames}
        />
      </Section>
      <Section title="Top users" resetKey={resetKey}>
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
                  <UsdFigure value={user.cost} className={NUMERIC} />
                  {user.costEstimated ? <CostEstimateIndicator /> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
