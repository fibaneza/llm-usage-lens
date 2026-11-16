"use client";

import { Users } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { ExportButton } from "@/components/table/ExportButton";
import { UsageTable } from "@/components/table/UsageTable";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartments } from "@/hooks/useDepartments";
import { useTeams } from "@/hooks/useTeams";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

import { DepartmentFilter } from "./DepartmentFilter";
import { TEAMS_CSV_COLUMNS, teamsColumns } from "./teams-columns";

type TeamsBodyProps = {
  range: DateRange;
  urlRange: Record<string, string | null>;
  department: string | null;
  onDepartmentChange: (value: string | null) => void;
};

export function TeamsBody({
  range,
  urlRange,
  department,
  onDepartmentChange,
}: TeamsBodyProps) {
  const params: Record<string, string> = {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  };
  if (department) params.departmentId = department;
  const teams = sectionData(useTeams(params));
  const departments = useDepartments({
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  });
  const columns = useMemo(() => teamsColumns(urlRange), [urlRange]);
  // Departments only feed the filter options.
  const options = (departments.data?.departments ?? []).map((d) => ({
    departmentId: d.departmentId,
    departmentName: d.departmentName,
  }));

  if (teams === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }

  // The filter joins the table toolbar's search row and stays mounted above
  // the no-results state so it is the way out of it.
  const filter = (
    <>
      <DepartmentFilter
        value={department}
        options={options}
        onChange={onDepartmentChange}
        disabled={departments.isError}
      />
      {departments.isError ? (
        <p role="status" className="text-muted-foreground text-sm">
          Departments unavailable
        </p>
      ) : null}
    </>
  );

  if (teams.teams.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          {filter}
        </div>
        <EmptyState
          icon={Users}
          title={department ? "No results" : "No teams in this period"}
          description={
            department
              ? "Nothing matches this department. Try another one."
              : "Try a wider date range."
          }
        />
      </div>
    );
  }

  return (
    <UsageTable
      data={teams.teams}
      columns={columns}
      getRowId={(t) => t.teamId}
      initialSort={{ id: "cost", desc: true }}
      searchKey="teamName"
      searchPlaceholder="Search by team"
      caption="Teams"
      toolbarStart={filter}
      emptyState={
        <p className="text-muted-foreground py-6 text-center text-sm">
          No teams match your search.
        </p>
      }
      toolbarActions={({ rows, visibleColumnIds }) => (
        <ExportButton
          filename={`teams-${range.dateFrom}-${range.dateTo}.csv`}
          columns={visibleColumnIds.flatMap(
            (id) => TEAMS_CSV_COLUMNS[id] ?? [],
          )}
          rows={rows}
        />
      )}
    />
  );
}
