"use client";

import { Layers } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { ModelUsageNote } from "@/components/ranking/ModelUsageNote";
import { UsageTable } from "@/components/table/UsageTable";
import { Skeleton } from "@/components/ui/skeleton";
import { useServices } from "@/hooks/useServices";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";
import { UNTAGGED_SERVICE } from "@/lib/service-label";

import { servicesColumns } from "./services-columns";

type ServicesBodyProps = {
  range: DateRange;
  urlRange: Record<string, string | null>;
};

export function ServicesBody({ range, urlRange }: ServicesBodyProps) {
  const services = sectionData(
    useServices({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
  );
  const rows = services?.services;
  const totalCost = useMemo(
    () => (rows ?? []).reduce((sum, r) => sum + r.cost, 0),
    [rows],
  );
  const columns = useMemo(
    () => servicesColumns(urlRange, totalCost),
    [urlRange, totalCost],
  );

  if (rows === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No services in this period"
        description="Try a wider date range."
      />
    );
  }

  const allUntagged = rows.every((r) => r.serviceName === UNTAGGED_SERVICE);

  return (
    <div className="space-y-4">
      <ModelUsageNote />
      {allUntagged ? (
        <p role="status" className="text-muted-foreground text-sm">
          No usage carries a service tag in this period.
        </p>
      ) : null}
      <UsageTable
        data={rows}
        columns={columns}
        getRowId={(r) => `${r.teamId}:${r.serviceName}`}
        initialSort={{ id: "cost", desc: true }}
        caption="Services"
      />
    </div>
  );
}
