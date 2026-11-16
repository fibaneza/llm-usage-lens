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

// Phase 4R.5 (ruling 2026-11-16): the page now resolves the caller's scope
// before rendering. This file tests rendering only, so the caller is a global
// reader; the redirect matrix per role lives in page.integration.test.ts.
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { oid: "u", roles: ["internal-admin"] } })),
}));
vi.mock("@/lib/api/scoped-rollups", () => ({
  scopeFor: vi.fn(async () => ({ global: true })),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

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
    renderWithProviders(
      await OverviewPage({ searchParams: Promise.resolve({}) }),
      {
        searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" },
      },
    );

    await waitFor(() =>
      expect(screen.getAllByText(/\$1,234\.56/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});
