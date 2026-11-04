"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { DepartmentsBody } from "./DepartmentsBody";

// Departments page body (Design System -- Page Architecture; implementation-
// phases Phase 4.3): the cards grid sits in its own boundary, which clears a
// failed request when the global date range changes (Rule 40.4, 60.12).
export function DepartmentsContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  // URL values are untrusted: a missing or malformed range falls back to the
  // last 30 days and a valid one is capped at 90 days (Rule 20.8).
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  return (
    <SectionBoundary
      title="the departments"
      resetKeys={[range.dateFrom, range.dateTo]}
    >
      <DepartmentsBody range={range} urlRange={{ dateFrom, dateTo }} />
    </SectionBoundary>
  );
}
