"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { ModelFilter } from "@/components/filters/ModelFilter";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";
import { rankingSearchParams } from "@/lib/ranking-search-params";

import { RankingBody } from "./RankingBody";
import { RankingTabs } from "./RankingTabs";

// Ranking page body (Design System -- Ranking Page; implementation-phases
// Phase 4.2): tabs and the model filter live in the URL (nuqs) beside the
// global date range, and the leaderboard sits in its own boundary so a failed
// request keeps the tabs usable (Rule 40.4, 60.12). A failed ranking clears
// when the tab, model or range changes.
export function RankingContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const [{ tab, model }, setParams] = useQueryStates(rankingSearchParams);
  // URL values are untrusted: a missing or malformed range falls back to the
  // last 30 days and a valid one is capped at 90 days (Rule 20.8).
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  return (
    <RankingTabs value={tab} onChange={(next) => void setParams({ tab: next })}>
      <div className="flex flex-wrap items-center gap-2">
        <ModelFilter
          value={model ?? "all"}
          onChange={(next) =>
            void setParams({ model: next === "all" ? null : next })
          }
        />
      </div>
      <SectionBoundary
        title="the ranking"
        resetKeys={[range.dateFrom, range.dateTo, tab, model]}
      >
        <RankingBody range={range} tab={tab} model={model} />
      </SectionBoundary>
    </RankingTabs>
  );
}
