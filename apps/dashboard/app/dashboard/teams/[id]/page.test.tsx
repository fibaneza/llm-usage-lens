import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  stubApi,
  teamDetailBody,
  teamDetailFixture,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import TeamDetailPage from "./page";

// B1-2: every Usage page gates on the caller's stored scope (the not-found
// matrix per caller is in usage-routes.integration.test.ts); this file tests
// rendering, so the caller is a global reader.
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { oid: "u", roles: ["internal-admin"] } })),
}));
vi.mock("@/lib/api/scoped-rollups", () => ({
  scopeFor: vi.fn(async () => ({ global: true })),
}));

// Source: Rule 60.7 (page stays a Server Component), Rule 60.13 (`params` is
// a Promise and is awaited), Rule 60.12 (client content under Suspense);
// implementation-phases Phase 4.6 (replace the placeholder).
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamDetailPage (/dashboard/teams/[id])", () => {
  it("stays a Server Component shell", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("awaits params and renders the detail for that id, not the placeholder", async () => {
    const stub = stubApi({
      teamDetail: () =>
        apiResponse(
          teamDetailBody(
            teamDetailFixture({ teamId: "team-ds", teamName: "Data Platform" }),
          ),
        ),
    });
    renderWithProviders(
      await TeamDetailPage({ params: Promise.resolve({ id: "team-ds" }) }),
      { searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" } },
    );

    expect(
      await screen.findByRole("heading", { name: "Data Platform" }),
    ).toBeInTheDocument();
    expect(stub.teamDetailRequests()[0]?.pathname).toBe("/api/teams/team-ds");
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});
