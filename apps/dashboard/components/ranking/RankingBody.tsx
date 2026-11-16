"use client";

import type { ModelKey, RankingTab } from "@llm-usage-lens/shared";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { TableSkeleton } from "@/components/display/TableSkeleton";
import { useRanking } from "@/hooks/useRanking";
import { type DateRange, previousRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

import { RankingTable } from "./RankingTable";

// The API caps a page at 100 rows; sorting, search and paging are client-side.
const RANKING_LIMIT = "100";

type RankingBodyProps = {
  range: DateRange;
  tab: RankingTab;
  model: ModelKey | null;
  // The Model select; it sits in the table toolbar and stays mounted above
  // the skeleton and the empty state so it is the way out of either.
  modelFilter: ReactNode;
};

function rankingParams(
  range: DateRange,
  tab: RankingTab,
  model: ModelKey | null,
) {
  return {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    tab,
    limit: RANKING_LIMIT,
    ...(model === null ? {} : { model }),
  };
}

// Loads the tab's ranking for the range: a skeleton while pending, the section
// boundary's alert if it fails (Rule 40.4, 60.12). The previous period feeds
// only the Trend column through a second, non-blocking request -- if it is
// pending or fails the table still renders, with "—" in Trend.
export function RankingBody({
  range,
  tab,
  model,
  modelFilter,
}: RankingBodyProps) {
  const previous = previousRange(range);
  const rankingQuery = useRanking(rankingParams(range, tab, model));
  const ranking = sectionData(rankingQuery);
  const previousQuery = useRanking(rankingParams(previous, tab, model));

  const rows = ranking?.rows ?? [];
  const pending = ranking === undefined || rankingQuery.isPlaceholderData;
  let bodyOverride: ReactNode = null;
  if (ranking === undefined) {
    bodyOverride = <TableSkeleton />;
  } else if (rows.length === 0) {
    bodyOverride = (
      <EmptyState
        title="No usage in this period"
        description="Try a wider date range or a different model."
      />
    );
  }

  // One tree for every state, so the toolbar and the Model filter in it stay
  // mounted (and focused) across skeleton, rows and empty. Old rows stay only
  // inside the busy region; the previous period never feeds Trend while its
  // own request for the new selection is pending.
  return (
    <div aria-busy={pending ? "true" : undefined}>
      <RankingTable
        current={rows}
        previous={
          previousQuery.isPlaceholderData ? undefined : previousQuery.data?.rows
        }
        modelFilter={modelFilter}
        bodyOverride={bodyOverride}
        pending={pending}
        filename={`ranking-${tab}-${range.dateFrom}-${range.dateTo}.csv`}
      />
    </div>
  );
}
