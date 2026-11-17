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
import { CombinedOrganisationSection } from "@/components/litellm/combined/CombinedOrganisationSection";
import { Panel } from "@/components/display/Panel";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { KpiRow } from "./KpiRow";
import { OverviewChartBody } from "./OverviewChartBody";
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
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );
  const [attempt, setAttempt] = useState(0);
  const onRetry = useCallback(() => setAttempt((n) => n + 1), []);
  const boundary = {
    resetKeys: [range.dateFrom, range.dateTo, attempt],
  };
  const panelBoundary = { ...boundary, onReset: onRetry };

  return (
    <div className="flex flex-col gap-6">
      <SectionBoundary title="key metrics" {...boundary} onRetry={onRetry}>
        <KpiRow range={range} />
      </SectionBoundary>

      <CombinedOrganisationSection range={range} />

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Cost trend"
          boundaryTitle="cost trend"
          className="lg:col-span-8"
          {...panelBoundary}
        >
          <OverviewChartBody
            range={range}
            render={(overview) => (
              <LazyCostTrendChart data={overview.dailyTrend} groupBy="model" />
            )}
          />
        </Panel>

        <Panel
          title="Model distribution"
          boundaryTitle="model distribution"
          className="lg:col-span-4"
          {...panelBoundary}
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
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Top 5 departments"
          boundaryTitle="top departments"
          className="lg:col-span-8"
          {...panelBoundary}
        >
          <OverviewChartBody
            range={range}
            render={(overview) => (
              <LazyTopDepartmentsChart
                bars={toTopDepartmentBars(overview.topDepartments)}
              />
            )}
          />
        </Panel>

        <Panel
          title="Sync status"
          boundaryTitle="sync status"
          className="lg:col-span-4"
          {...panelBoundary}
        >
          <SyncStatusSection />
        </Panel>
      </div>
    </div>
  );
}
