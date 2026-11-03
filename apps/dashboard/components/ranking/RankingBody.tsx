"use client";

import type { ModelKey, RankingTab } from "@bedrock-usage/shared";

import { EmptyState } from "@/components/display/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
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
export function RankingBody({ range, tab, model }: RankingBodyProps) {
  const previous = previousRange(range);
  const ranking = sectionData(useRanking(rankingParams(range, tab, model)));
  const previousRanking = useRanking(rankingParams(previous, tab, model));

  if (ranking === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (ranking.rows.length === 0) {
    return (
      <EmptyState
        title="No usage in this period"
        description="Try a wider date range or a different model."
      />
    );
  }

  return (
    <RankingTable
      current={ranking.rows}
      previous={previousRanking.data?.rows}
      filename={`ranking-${tab}-${range.dateFrom}-${range.dateTo}.csv`}
    />
  );
}
