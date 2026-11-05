"use client";

import { Activity, Building2, Coins, Hash } from "lucide-react";
import { useMemo } from "react";

import { formatUsd } from "@/components/charts/chart-data";
import { DeltaBadge } from "@/components/display/DeltaBadge";
import { EmptyState } from "@/components/display/EmptyState";
import { MetricCard } from "@/components/display/MetricCard";
import { PeriodComparison } from "@/components/display/PeriodComparison";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartment } from "@/hooks/useDepartment";
import { departmentHeaderStats } from "@/lib/aggregate/department-header";
import {
  type DateRange,
  inclusiveSpanDays,
  previousRange,
} from "@/lib/date-range";
import { ApiRequestError } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

import { DepartmentSections } from "./DepartmentSections";

const countFormatter = new Intl.NumberFormat("en-US");

function rangeParams(range: DateRange) {
  return { dateFrom: range.dateFrom, dateTo: range.dateTo };
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "NOT_FOUND";
}

type DepartmentDetailBodyProps = {
  id: string;
  range: DateRange;
};

// Loads the department for the range: skeletons while pending, a not-found
// message for an unknown id, the section boundary's alert on any other failure
// (Rule 40.4, 60.12). The previous period only feeds the deltas through a
// second, non-blocking request -- if it is pending or fails the page still
// renders, without a delta.
export function DepartmentDetailBody({ id, range }: DepartmentDetailBodyProps) {
  const currentQuery = useDepartment(id, rangeParams(range));
  const previousQuery = useDepartment(id, rangeParams(previousRange(range)));
  const notFound = isNotFound(currentQuery.error) && !currentQuery.isFetching;
  const department = notFound ? undefined : sectionData(currentQuery);
  const previous = previousQuery.data;
  const stats = useMemo(
    () =>
      department ? departmentHeaderStats(department, previous) : undefined,
    [department, previous],
  );

  if (notFound) {
    return (
      <EmptyState
        icon={Building2}
        title="Department not found"
        description="It may have been removed or the link is wrong."
      />
    );
  }

  if (department === undefined || stats === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const hasUsage =
    stats.totalCost !== 0 || stats.totalTokens !== 0 || stats.invocations !== 0;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-semibold">{department.departmentName}</h2>
      {hasUsage ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricCard
              title="Total cost"
              value={formatUsd(stats.totalCost)}
              icon={Coins}
              description={<p>Bedrock service charges only</p>}
              trend={
                <DeltaBadge
                  current={stats.totalCost}
                  previous={stats.previous?.totalCost ?? null}
                />
              }
            />
            <MetricCard
              title="Tokens"
              value={countFormatter.format(stats.totalTokens)}
              icon={Hash}
              trend={
                <DeltaBadge
                  current={stats.totalTokens}
                  previous={stats.previous?.totalTokens ?? null}
                />
              }
            />
            <MetricCard
              title="Invocations"
              value={countFormatter.format(stats.invocations)}
              icon={Activity}
              trend={
                <DeltaBadge
                  current={stats.invocations}
                  previous={stats.previous?.invocations ?? null}
                />
              }
            />
          </div>
          {/* Labels differ from the MetricCard titles so each group keeps a unique accessible name. */}
          <PeriodComparison
            days={inclusiveSpanDays(range)}
            metrics={[
              {
                label: "Cost",
                current: stats.totalCost,
                previous: stats.previous?.totalCost ?? null,
                kind: "usd",
              },
              {
                label: "Token volume",
                current: stats.totalTokens,
                previous: stats.previous?.totalTokens ?? null,
                kind: "count",
              },
              {
                label: "Invocation count",
                current: stats.invocations,
                previous: stats.previous?.invocations ?? null,
                kind: "count",
              },
            ]}
          />
          <DepartmentSections department={department} range={range} />
        </>
      ) : (
        <EmptyState
          icon={Building2}
          title="No usage in this period"
          description="Try a wider date range."
        />
      )}
    </div>
  );
}
