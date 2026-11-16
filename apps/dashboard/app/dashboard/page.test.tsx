import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  NEVER,
  NEVER_SYNCED,
  overviewFixture,
  stubApi,
} from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

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

// The page takes no query after B1-3 (?view=overview is removed), so it may
// declare no props; the cast keeps the call compiling either way.
const page = OverviewPage as unknown as (props?: {
  searchParams: Promise<Record<string, string>>;
}) => Promise<ReactElement>;

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
    renderWithProviders(await page({ searchParams: Promise.resolve({}) }), {
      searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" },
    });

    await waitFor(() =>
      expect(screen.getAllByText(/\$1,234\.56/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });

  // Slice B1, B1-12 / Design System - Layout, Page frame: the page starts with
  // a PageHeader one-line description in the shell (present before any data
  // resolves); the h1 stays in the top bar, so the page renders none. B1-10:
  // the 4R.5 "Showing your teams only." paragraph is gone.
  it("starts with a PageHeader description and renders no page-level h1 or scope notice", async () => {
    vi.stubGlobal("fetch", vi.fn(NEVER));
    const view = renderWithProviders(await page(), {
      searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" },
    });

    const description = view.container.querySelector("p");
    expect(description?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText(/showing your teams only/i)).toBeNull();
  });
});
