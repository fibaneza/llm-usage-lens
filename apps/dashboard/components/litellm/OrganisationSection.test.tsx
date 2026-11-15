import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { LiteLLMSection } from "./LiteLLMSection";
import { OrganisationSection } from "./OrganisationSection";

// Sources: docs/specs/2026-11-10-litellm.md -- Views by role (L3b:
// Organisation tab = totals across every linked team plus a per-team table of
// spend, budget, members; org-admin/Admin/Auditor), LT8 (LiteLLM-reported
// label), LD20 (UTC day buckets); Design System -- LiteLLM Page (states).
// Module under test: `components/litellm/OrganisationSection.tsx`, a client
// component with no props (suspense query, like the other sections), rendered
// inside <LiteLLMSection title="Organisation" reported>.
// Assumed GET /api/litellm/org data:
//   { totals: { spend }, daily: [{ date, spend }],
//     teams: [{ teamId, teamName, spend, maxBudget: number|null, memberCount }],
//     enabledOperations } (route tests are the contract)
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ORG = {
  totals: { spend: 1234.5 },
  daily: [{ date: "2026-11-14", spend: 100 }],
  enabledOperations: [],
  teams: [
    {
      teamId: "t1",
      teamName: "Payments",
      spend: 321.75,
      maxBudget: 500,
      memberCount: 7,
    },
    {
      teamId: "t2",
      teamName: "Search",
      spend: 12,
      maxBudget: null,
      memberCount: 3,
    },
  ],
};

function stub(response: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      calls.push(new URL(String(input), "http://localhost").pathname);
      return Promise.resolve(response());
    }),
  );
  return calls;
}

function renderSection() {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return renderWithProviders(
    <LiteLLMSection title="Organisation" reported>
      <OrganisationSection />
    </LiteLLMSection>,
  );
}

describe("OrganisationSection (L3b Organisation tab)", () => {
  it("shows org totals in USD labelled LiteLLM-reported (LT8)", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    const region = await screen.findByRole("region", { name: "Organisation" });
    expect(await within(region).findByText("$1,234.50")).toBeInTheDocument();
    expect(
      within(region).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
    expect(within(region).getByText(/UTC days?/i)).toBeInTheDocument();
  });

  it("lists one row per linked team with spend, budget and members (Views by role)", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    const row = await screen.findByRole("row", { name: /Payments/ });
    expect(within(row).getByText("$321.75")).toBeInTheDocument();
    expect(within(row).getByText("$500.00")).toBeInTheDocument();
    expect(within(row).getByText("7")).toBeInTheDocument();
    const noLimit = screen.getByRole("row", { name: /Search/ });
    expect(within(noLimit).getByText(/no limit/i)).toBeInTheDocument();
  });

  it("shows an empty state when no team is linked", async () => {
    stub(() =>
      apiResponse({
        data: {
          totals: { spend: 0 },
          daily: [],
          teams: [],
          enabledOperations: [],
        },
      }),
    );
    renderSection();
    expect(await screen.findByText(/no linked teams/i)).toBeInTheDocument();
  });

  it("shows an inline 'LiteLLM unavailable' on a 503 (Design System -- LiteLLM Page, States)", async () => {
    stub(() => apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"));
    renderSection();
    expect(await screen.findByText(/LiteLLM unavailable/i)).toBeInTheDocument();
  });

  it("requests GET /api/litellm/org only", async () => {
    const calls = stub(() => apiResponse({ data: ORG }));
    renderSection();
    await screen.findByRole("row", { name: /Payments/ });
    expect(new Set(calls)).toEqual(new Set(["/api/litellm/org"]));
  });
});
