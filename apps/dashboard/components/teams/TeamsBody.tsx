"use client";

import { Users } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { UsageTable } from "@/components/table/UsageTable";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartments } from "@/hooks/useDepartments";
import { useTeams } from "@/hooks/useTeams";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

import { DepartmentFilter } from "./DepartmentFilter";
import { teamsColumns } from "./teams-columns";

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
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
      </div>
      {teams.teams.length === 0 ? (
        <EmptyState
          icon={Users}
          title={department ? "No results" : "No teams in this period"}
          description={
            department
              ? "Nothing matches this department. Try another one."
              : "Try a wider date range."
          }
        />
      ) : (
        <UsageTable
          data={teams.teams}
          columns={columns}
          getRowId={(t) => t.teamId}
          initialSort={{ id: "cost", desc: true }}
          caption="Teams"
        />
      )}
    </div>
  );
}
