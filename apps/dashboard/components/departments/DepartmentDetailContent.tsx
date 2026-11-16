"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { DepartmentDetailBody } from "./DepartmentDetailBody";

// Department detail page body (Design System -- Page Architecture; Phase 4.4).
// The range comes from the URL, validated and capped at 90 days (Rule 20.8).
export function DepartmentDetailContent({ id }: { id: string }) {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  return (
    <SectionBoundary
      title="the department"
      resetKeys={[id, range.dateFrom, range.dateTo]}
    >
      <DepartmentDetailBody
        id={id}
        range={range}
        urlRange={{ dateFrom, dateTo }}
      />
    </SectionBoundary>
  );
}
