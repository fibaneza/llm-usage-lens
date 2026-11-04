"use client";

import { Building2 } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartments } from "@/hooks/useDepartments";
import { type DateRange, previousRange } from "@/lib/date-range";
import { withDateRange } from "@/lib/date-range-search-params";
import { sectionData } from "@/lib/query/section-data";

import { DepartmentCard } from "./DepartmentCard";

// Rule 40.6: 1 column below md, 2 at md, 3 from lg.
const GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3";
const SKELETON_KEYS = ["a", "b", "c", "d", "e", "f"] as const;

type DepartmentsBodyProps = {
  range: DateRange;
  // The URL's own date values, carried into each card link (issue #75).
  urlRange: Record<string, string | null>;
};

function rangeParams(range: DateRange) {
  return { dateFrom: range.dateFrom, dateTo: range.dateTo };
}

// Loads the departments for the range: a skeleton grid while pending, the
// section boundary's alert if it fails (Rule 40.4, 60.12). The previous period
// only feeds each card's DeltaBadge through a second, non-blocking request --
// if it is pending or fails the cards still render, without a delta.
export function DepartmentsBody({ range, urlRange }: DepartmentsBodyProps) {
  const departments = sectionData(useDepartments(rangeParams(range)));
  const previous = useDepartments(rangeParams(previousRange(range)));
  const previousCosts = useMemo(
    () =>
      new Map(
        (previous.data?.departments ?? []).map((d) => [d.departmentId, d.cost]),
      ),
    [previous.data],
  );

  if (departments === undefined) {
    return (
      <div className={GRID}>
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (departments.departments.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No departments in this period"
        description="Try a wider date range."
      />
    );
  }

  return (
    <div className={GRID}>
      {departments.departments.map((department) => (
        <DepartmentCard
          key={department.departmentId}
          department={department}
          href={withDateRange(
            `/dashboard/departments/${encodeURIComponent(department.departmentId)}`,
            { get: (key) => urlRange[key] ?? null },
          )}
          previousCost={previousCosts.get(department.departmentId) ?? null}
        />
      ))}
    </div>
  );
}
