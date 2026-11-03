import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactElement, ReactNode } from "react";

// Test-only: the providers every dashboard client component needs (TanStack
// Query as in app/layout.tsx, nuqs for the URL date range). A fresh client per
// render keeps caches from leaking across cases (Rule 60.24); retries are off
// so a failing request surfaces immediately instead of after backoff.
export function renderWithProviders(
  ui: ReactElement,
  { searchParams = {} }: { searchParams?: Record<string, string> } = {},
): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Nuqs = withNuqsTestingAdapter({ searchParams, hasMemory: true });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <Nuqs>{children}</Nuqs>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}
