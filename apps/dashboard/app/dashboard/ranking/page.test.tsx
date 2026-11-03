import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  rankingBody,
  rankingRowFixture,
  stubApi,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import RankingPage from "./page";

// Source: Rule 60.7 (pages and layouts stay Server Components; the client
// boundary sits as deep as possible); implementation-phases Phase 4.2.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RankingPage (/dashboard/ranking)", () => {
  it("stays a Server Component shell", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("renders the ranking table instead of the placeholder", async () => {
    stubApi({
      ranking: () =>
        apiResponse(
          rankingBody("departments", [
            rankingRowFixture({
              id: "dept-eng",
              name: "Engineering",
              cost: 600,
            }),
          ]),
        ),
    });
    renderWithProviders(await Promise.resolve(RankingPage()), {
      searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" },
    });

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});
