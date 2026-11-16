"use client";

import { Building2 } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { ExportButton } from "@/components/table/ExportButton";
import { UsageTable } from "@/components/table/UsageTable";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartments } from "@/hooks/useDepartments";
import { type DateRange, previousRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

import {
  DEPARTMENTS_CSV_COLUMNS,
  departmentsColumns,
  type DepartmentTableRow,
} from "./departments-columns";

type DepartmentsBodyProps = {
  range: DateRange;
  // The URL's own date values, carried into each row link (issue #75).
  urlRange: Record<string, string | null>;
};

function rangeParams(range: DateRange) {
  return { dateFrom: range.dateFrom, dateTo: range.dateTo };
}

// Loads the departments for the range: a skeleton while pending, the section
// boundary's alert if it fails (Rule 40.4, 60.12). The previous period only
// feeds the Change column through a second, non-blocking request -- if it is
// pending or fails the table still renders, without a delta.
export function DepartmentsBody({ range, urlRange }: DepartmentsBodyProps) {
  const departments = sectionData(useDepartments(rangeParams(range)));
  const previous = useDepartments(rangeParams(previousRange(range)));
  const columns = useMemo(() => departmentsColumns(urlRange), [urlRange]);
  const data = useMemo<DepartmentTableRow[]>(() => {
    const previousCosts = new Map(
      (previous.data?.departments ?? []).map((d) => [d.departmentId, d.cost]),
    );
    return (departments?.departments ?? []).map((department) => ({
      ...department,
      previousCost: previousCosts.get(department.departmentId) ?? null,
    }));
  }, [departments, previous.data]);

  if (departments === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full max-w-xs" />
        <Skeleton className="h-80 w-full" />
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
    <UsageTable<DepartmentTableRow>
      data={data}
      columns={columns}
      getRowId={(row) => row.departmentId}
      initialSort={{ id: "cost", desc: true }}
      searchKey="departmentName"
      searchPlaceholder="Search by department"
      caption="Departments"
      emptyState={
        <p className="text-muted-foreground py-6 text-center text-sm">
          No departments match your search.
        </p>
      }
      toolbarActions={({ rows, visibleColumnIds }) => (
        <ExportButton
          filename={`departments-${range.dateFrom}-${range.dateTo}.csv`}
          columns={visibleColumnIds.flatMap(
            (id) => DEPARTMENTS_CSV_COLUMNS[id] ?? [],
          )}
          rows={rows}
        />
      )}
    />
  );
}
