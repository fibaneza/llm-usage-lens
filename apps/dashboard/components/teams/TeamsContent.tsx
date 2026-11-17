"use client";

import { parseAsString, useQueryState, useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { PageHeader } from "@/components/layout/PageHeader";
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { TeamsBody } from "./TeamsBody";

// Teams page body (implementation-phases Phase 4.5): the table sits in its own
// boundary, which clears a failed request when the range or filter changes
// (Rule 40.4, 60.12).
export function TeamsContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const [department, setDepartment] = useQueryState(
    "department",
    parseAsString,
  );
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Cost, tokens and activity for each team, filterable by department." />
      <SectionBoundary
        title="the teams"
        resetKeys={[range.dateFrom, range.dateTo, department]}
      >
        <TeamsBody
          range={range}
          urlRange={{ dateFrom, dateTo }}
          department={department}
          onDepartmentChange={(next) => void setDepartment(next)}
        />
      </SectionBoundary>
    </div>
  );
}
