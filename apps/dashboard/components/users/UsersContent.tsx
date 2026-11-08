"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { UsersBody } from "./UsersBody";

// Users page body (implementation-phases Phase 4.8): one table in its own
// boundary, cleared when the range changes (Rule 40.4, 60.12).
export function UsersContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  return (
    <SectionBoundary
      title="the users"
      resetKeys={[range.dateFrom, range.dateTo]}
    >
      <UsersBody range={range} urlRange={{ dateFrom, dateTo }} />
    </SectionBoundary>
  );
}
