"use client";

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { useMemo } from "react";
import type { z } from "zod";

import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";
import { ApiRequestError, fetchApi } from "@/lib/query/fetch-api";

// The global date range from the URL (Design System -- Management pages,
// Date Filtering; Rules 20.1, 20.8), as the key suffix and the query string.
export function useUrlRange() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );
  return {
    keyParts: [range.dateFrom, range.dateTo] as const,
    query: `dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`,
  };
}

export type LiteLLMResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" };

// The audit log is Enterprise-only: a 403 OPERATION_UNAVAILABLE is the named
// edition state (LiteLLM spec -- Audit, D-LF2), distinct from an outage.
export type LiteLLMEditionResult<T> =
  | LiteLLMResult<T>
  | { status: "needs-enterprise" };

// An outage (503 LITELLM_UNAVAILABLE) is a handled, section-level state
// (Design System -- LiteLLM Page, States); every other error bubbles to the
// section's ErrorBoundary (Rule 60.17).
function litellmQuery<S extends z.ZodType>(
  key: readonly string[],
  path: string,
  schema: S,
  editionState = false,
) {
  return {
    queryKey: ["litellm", ...key],
    queryFn: async (): Promise<LiteLLMEditionResult<z.output<S>>> => {
      try {
        return { status: "ok", data: await fetchApi(path, schema) };
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          error.code === "LITELLM_UNAVAILABLE"
        ) {
          return { status: "unavailable" };
        }
        if (
          editionState &&
          error instanceof ApiRequestError &&
          error.code === "OPERATION_UNAVAILABLE"
        ) {
          return { status: "needs-enterprise" };
        }
        throw error;
      }
    },
  };
}

export function useLiteLLMQuery<S extends z.ZodType>(
  key: readonly string[],
  path: string,
  schema: S,
): LiteLLMResult<z.output<S>> {
  return useSuspenseQuery(litellmQuery(key, path, schema))
    .data as LiteLLMResult<z.output<S>>;
}

// Opt-in: only the audit section maps OPERATION_UNAVAILABLE to a state.
export function useLiteLLMEditionQuery<S extends z.ZodType>(
  key: readonly string[],
  path: string,
  schema: S,
): LiteLLMEditionResult<z.output<S>> {
  return useSuspenseQuery(litellmQuery(key, path, schema, true)).data;
}

// Same cache entry, without suspending: for callers that must render around a
// pending or failed request instead of throwing into a boundary.
export function useLiteLLMQueryState<S extends z.ZodType>(
  key: readonly string[],
  path: string,
  schema: S,
) {
  return useQuery({
    ...litellmQuery(key, path, schema),
    select: (result) => result as LiteLLMResult<z.output<S>>,
  });
}
