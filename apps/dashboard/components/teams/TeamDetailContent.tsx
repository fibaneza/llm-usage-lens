"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { TeamDetailBody } from "./TeamDetailBody";

// Team detail page body (Design System -- Team Detail Page; Phase 4.6). The
// range comes from the URL, validated and capped at 90 days (Rule 20.8).
export function TeamDetailContent({ id }: { id: string }) {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  return (
    <SectionBoundary
      title="the team"
      resetKeys={[id, range.dateFrom, range.dateTo]}
    >
      <TeamDetailBody id={id} range={range} urlRange={{ dateFrom, dateTo }} />
    </SectionBoundary>
  );
}
