"use client";

import { Users } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { ModelUsageNote } from "@/components/ranking/ModelUsageNote";
import { ExportButton } from "@/components/table/ExportButton";
import { UsageTable } from "@/components/table/UsageTable";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsers } from "@/hooks/useUsers";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

import { usersColumns, usersCsvColumns } from "./users-columns";

type UsersBodyProps = {
  range: DateRange;
  urlRange: Record<string, string | null>;
};

export function UsersBody({ range, urlRange }: UsersBodyProps) {
  const users = sectionData(
    useUsers({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
  );
  const rows = users?.users;
  const totalCost = useMemo(
    () => (rows ?? []).reduce((sum, r) => sum + r.cost, 0),
    [rows],
  );
  const columns = useMemo(
    () => usersColumns(urlRange, totalCost),
    [urlRange, totalCost],
  );
  const csvColumns = useMemo(() => usersCsvColumns(totalCost), [totalCost]);

  if (rows === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No users in this period"
        description="Try a wider date range."
      />
    );
  }

  return (
    <>
      <ModelUsageNote />
      <UsageTable
        data={rows}
        columns={columns}
        getRowId={(r) => `${r.teamId}:${r.userId}`}
        initialSort={{ id: "cost", desc: true }}
        searchKey="userId"
        searchPlaceholder="Search by user"
        caption="Users"
        emptyState={
          <p className="text-muted-foreground py-6 text-center text-sm">
            No users match your search.
          </p>
        }
        toolbarActions={({ rows: visibleRows, visibleColumnIds }) => (
          <ExportButton
            filename={`users-${range.dateFrom}-${range.dateTo}.csv`}
            columns={visibleColumnIds.flatMap((id) => csvColumns[id] ?? [])}
            rows={visibleRows}
          />
        )}
      />
    </>
  );
}
