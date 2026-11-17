"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { PageHeader } from "@/components/layout/PageHeader";
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { ServicesBody } from "./ServicesBody";

// Services page body (implementation-phases Phase 4.7): one table in its own
// boundary, cleared when the range changes (Rule 40.4, 60.12).
export function ServicesContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Cost and usage by service tag, per team." />
      <SectionBoundary
        title="the services"
        resetKeys={[range.dateFrom, range.dateTo]}
      >
        <ServicesBody range={range} urlRange={{ dateFrom, dateTo }} />
      </SectionBoundary>
    </div>
  );
}
