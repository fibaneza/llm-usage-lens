"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import type { z } from "zod";

import type { DateRange } from "@/lib/date-range";
import { fetchApi } from "@/lib/query/fetch-api";

export type CombinedRange = Pick<DateRange, "dateFrom" | "dateTo">;

export function combinedPath(path: string, range: CombinedRange): string {
  return `/api/litellm/combined/${path}?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`;
}

// Errors (including 503 LITELLM_UNAVAILABLE) throw into the section's
// boundary: LiteLLM spec -- Combined usage (L6), States.
export function useCombinedQuery<S extends z.ZodType>(
  path: string,
  schema: S,
  { missingIsNull = false }: { missingIsNull?: boolean } = {},
): z.output<S> | null {
  return useSuspenseQuery({
    queryKey: ["litellm", "combined", path],
    queryFn: async (): Promise<z.output<S> | null> => {
      try {
        return await fetchApi(path, schema);
      } catch (error) {
        if (
          missingIsNull &&
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ) {
          return null;
        }
        throw error;
      }
    },
  }).data;
}
