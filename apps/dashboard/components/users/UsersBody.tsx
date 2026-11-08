"use client";

import { Users } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { ModelUsageNote } from "@/components/ranking/ModelUsageNote";
import { UsageTable } from "@/components/table/UsageTable";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsers } from "@/hooks/useUsers";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

import { usersColumns } from "./users-columns";

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
    <div className="space-y-4">
      <ModelUsageNote />
      <UsageTable
        data={rows}
        columns={columns}
        getRowId={(r) => `${r.teamId}:${r.userId}`}
        initialSort={{ id: "cost", desc: true }}
        caption="Users"
      />
    </div>
  );
}
