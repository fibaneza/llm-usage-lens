"use client";

import { RANKING_TABS, type RankingTab } from "@llm-usage-lens/shared";
import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { ModelFilter } from "@/components/filters/ModelFilter";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";
import { rankingSearchParams } from "@/lib/ranking-search-params";

import { ModelUsageNote } from "./ModelUsageNote";
import { RankingBody } from "./RankingBody";

const TAB_ITEMS = RANKING_TABS.map((tab) => ({
  value: tab,
  label: {
    departments: "Departments",
    teams: "Teams",
    services: "Services",
    users: "Users",
  }[tab],
}));

// Ranking page body (Design System -- Ranking Page; implementation-phases
// Phase 4.2): tabs and the model filter live in the URL (nuqs) beside the
// global date range, and the leaderboard sits in its own boundary so a failed
// request keeps the tabs usable (Rule 40.4, 60.12). A failed ranking clears
// when the tab, model or range changes. The user and service views exclude
// non-model charges and say so (Data Model spec -- Non-model cost is
// account-level only); the note sits outside the boundary so it also shows
// while the table is loading, empty or failed.
export function RankingContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const [{ tab, model }, setParams] = useQueryStates(rankingSearchParams);
  // URL values are untrusted: a missing or malformed range falls back to the
  // last 30 days and a valid one is capped at 90 days (Rule 20.8).
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );

  const modelFilter = (
    <ModelFilter
      value={model ?? "all"}
      onChange={(next) =>
        void setParams({ model: next === "all" ? null : next })
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Who spends the most, by department, team, service or user." />
      <PageTabs<RankingTab>
        label="Ranking by"
        panelId="ranking-tabpanel"
        value={tab}
        onValueChange={(next) => void setParams({ tab: next })}
        items={TAB_ITEMS}
      >
        <div className="flex min-w-0 flex-col gap-3">
          {tab === "users" || tab === "services" ? <ModelUsageNote /> : null}
          <SectionBoundary
            title="the ranking"
            resetKeys={[range.dateFrom, range.dateTo, tab, model]}
            errorControls={modelFilter}
          >
            <RankingBody
              range={range}
              tab={tab}
              model={model}
              modelFilter={modelFilter}
            />
          </SectionBoundary>
        </div>
      </PageTabs>
    </div>
  );
}
