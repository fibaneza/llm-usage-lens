"use client";

import { BudgetResetCountsSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-litellm.md -- MG-D9, MG-D10. The route scopes
// the rows; the client only shows what comes back. A failed read hides the
// count (it is supplementary), it never breaks the page.
export function useBudgetResetCounts(range: {
  dateFrom: string;
  dateTo: string;
}) {
  return useQuery({
    queryKey: ["budget-resets", range.dateFrom, range.dateTo],
    queryFn: () =>
      fetchApi(
        `/api/budget-resets?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`,
        BudgetResetCountsSchema,
      ),
    retry: false,
  });
}
