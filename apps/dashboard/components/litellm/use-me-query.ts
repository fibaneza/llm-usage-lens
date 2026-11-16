"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { LiteLLMMeResponseSchema } from "@llm-usage-lens/shared";

import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { useLiteLLMQuery, useLiteLLMQueryState } from "./use-litellm-query";

// One `me` request for the whole page: the URL date range feeds the path and
// the cache key, so My usage, the Team area and the tab gate share an entry.
function useMeRequest() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );
  return {
    key: ["me", range.dateFrom, range.dateTo] as const,
    path: `/api/litellm/me?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`,
  };
}

export function useMeQuery() {
  const { key, path } = useMeRequest();
  return useLiteLLMQueryState(key, path, LiteLLMMeResponseSchema);
}

export function useMeSuspenseQuery() {
  const { key, path } = useMeRequest();
  return useLiteLLMQuery(key, path, LiteLLMMeResponseSchema);
}
