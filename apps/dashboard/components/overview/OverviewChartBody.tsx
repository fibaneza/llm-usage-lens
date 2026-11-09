"use client";

import type { OverviewResponse } from "@llm-usage-lens/shared";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useOverview } from "@/hooks/useOverview";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

type OverviewChartBodyProps = {
  range: DateRange;
  render: (overview: OverviewResponse) => ReactNode;
};

// Loads the range's overview rollup for one chart section: a skeleton while it
// is pending, the section's own boundary alert if it fails (Rule 40.4, 60.12).
// The sections share one query key, so a single request serves all of them.
export function OverviewChartBody({ range, render }: OverviewChartBodyProps) {
  const overview = sectionData(
    useOverview({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
  );

  if (overview === undefined) return <Skeleton className="h-72 w-full" />;

  return <>{render(overview)}</>;
}
