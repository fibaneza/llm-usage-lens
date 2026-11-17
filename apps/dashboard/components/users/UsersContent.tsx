"use client";

import Link from "next/link";
import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { PageHeader } from "@/components/layout/PageHeader";
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { UsersBody } from "./UsersBody";

// Users page body (implementation-phases Phase 4.8): one table in its own
// boundary, cleared when the range changes (Rule 40.4, 60.12).
export function UsersContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Cost and usage for each person who calls Bedrock." />
      <p className="text-cell text-muted-foreground max-w-[72ch]">
        Combined Bedrock and LiteLLM usage for one person is under{" "}
        <Link
          href="/dashboard/manage/users"
          className="text-link underline underline-offset-4"
        >
          Management → Users
        </Link>
        .
      </p>
      <SectionBoundary
        title="the users"
        resetKeys={[range.dateFrom, range.dateTo]}
      >
        <UsersBody range={range} urlRange={{ dateFrom, dateTo }} />
      </SectionBoundary>
    </div>
  );
}
