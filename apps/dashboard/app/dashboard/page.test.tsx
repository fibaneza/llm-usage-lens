import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  NEVER_SYNCED,
  overviewFixture,
  stubApi,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import OverviewPage from "./page";

// Source: Rule 60.7 (pages and layouts stay Server Components; the client
// boundary sits as deep as possible); implementation-phases Phase 4.1.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OverviewPage (/dashboard)", () => {
  it("stays a Server Component shell", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("renders the overview sections instead of the placeholder", async () => {
    stubApi({
      overview: () => apiResponse({ data: overviewFixture() }),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(await Promise.resolve(OverviewPage()), {
      searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" },
    });

    await waitFor(() =>
      expect(screen.getAllByText(/\$1,234\.56/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});
