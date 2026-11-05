import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  departmentRowFixture,
  departmentsBody,
  stubApi,
  teamRowFixture,
  teamsBody,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import TeamsPage from "./page";

// Source: Rule 60.7 (pages stay Server Components), Rule 60.12;
// implementation-phases Phase 4.5 ("replace the placeholder").
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamsPage (/dashboard/teams)", () => {
  it("stays a Server Component shell", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("renders the teams table instead of the placeholder", async () => {
    stubApi({
      teams: () =>
        apiResponse(
          teamsBody([
            teamRowFixture({ teamId: "team-pay", teamName: "Payments" }),
          ]),
        ),
      departments: () =>
        apiResponse(
          departmentsBody([
            departmentRowFixture({
              departmentId: "dept-eng",
              departmentName: "Engineering",
            }),
          ]),
        ),
    });
    renderWithProviders(await Promise.resolve(TeamsPage()), {
      searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" },
    });

    expect(
      await screen.findByRole("link", { name: "Payments" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/dashboard/teams/team-pay"),
    );
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});
