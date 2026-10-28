"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import { ApiRequestError } from "@/lib/query/fetch-api";

const STALE_TIME_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

// A 4xx is deterministic (auth, bad input, missing) — retrying cannot fix it.
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiRequestError && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: STALE_TIME_MS, retry: shouldRetry },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
