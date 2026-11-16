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
} from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import TeamsPage from "./page";

// B1-2: every Usage page gates on the caller's stored scope (the not-found
// matrix per caller is in usage-routes.integration.test.ts); this file tests
// rendering, so the caller is a global reader.
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { oid: "u", roles: ["internal-admin"] } })),
}));
vi.mock("@/lib/api/scoped-rollups", () => ({
  scopeFor: vi.fn(async () => ({ global: true })),
}));

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
