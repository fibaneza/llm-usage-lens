"use client";

import { useQueryStates } from "nuqs";
import { useCallback, useMemo, useState } from "react";

import {
  toModelBreakdownSlices,
  toTopDepartmentBars,
} from "@/components/charts/chart-data";
import {
  LazyCostTrendChart,
  LazyModelBreakdownChart,
  LazyTopDepartmentsChart,
} from "@/components/charts/LazyCharts";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { KpiRow } from "./KpiRow";
import { OverviewChartBody } from "./OverviewChartBody";
import { OverviewSectionCard } from "./OverviewSectionCard";
import { SyncStatusSection } from "./SyncStatusSection";

// Overview page body (Design System — Overview Page; implementation-phases
// Phase 4.1): five sections, each in its own boundary so one failing request
// never takes the page down (Rule 40.4, 60.12). Every section reads the URL
// date range (nuqs), so changing the picker refetches them all. A failed
// section clears when the range changes, and one Retry resets every boundary so
// the sections sharing the /api/overview query recover together.
export function OverviewContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  // URL values are untrusted: a missing or malformed range falls back to the
  // last 30 days and a valid one is capped at 90 days (Rule 20.8).
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );
  const [attempt, setAttempt] = useState(0);
  const onRetry = useCallback(() => setAttempt((n) => n + 1), []);
  const boundary = {
    resetKeys: [range.dateFrom, range.dateTo, attempt],
    onRetry,
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionBoundary title="key metrics" {...boundary}>
        <KpiRow range={range} />
      </SectionBoundary>

      <div className="grid gap-6 lg:grid-cols-3">
        <OverviewSectionCard
          title="Cost trend"
          boundaryTitle="cost trend"
          className="lg:col-span-2"
          {...boundary}
        >
          <OverviewChartBody
            range={range}
            render={(overview) => (
              <LazyCostTrendChart data={overview.dailyTrend} groupBy="model" />
            )}
          />
        </OverviewSectionCard>

        <OverviewSectionCard
          title="Model distribution"
          boundaryTitle="model distribution"
          {...boundary}
        >
          <OverviewChartBody
            range={range}
            render={(overview) => (
              <LazyModelBreakdownChart
                slices={toModelBreakdownSlices(
                  overview.byModel,
                  overview.nonModelCost,
                )}
              />
            )}
          />
        </OverviewSectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <OverviewSectionCard
          title="Top 5 departments"
          boundaryTitle="top departments"
          className="lg:col-span-2"
          {...boundary}
        >
          <OverviewChartBody
            range={range}
            render={(overview) => (
              <LazyTopDepartmentsChart
                bars={toTopDepartmentBars(overview.topDepartments)}
              />
            )}
          />
        </OverviewSectionCard>

        <OverviewSectionCard
          title="Sync status"
          boundaryTitle="sync status"
          {...boundary}
        >
          <SyncStatusSection />
        </OverviewSectionCard>
      </div>
    </div>
  );
}
