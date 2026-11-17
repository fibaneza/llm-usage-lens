import { act, screen, within } from "@testing-library/react";
import { useQueryStates } from "nuqs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";
import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

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
  vi.useRealTimers();
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

  // Design System -- Management pages ("the global date range applies to every
  // Management page"), Date Filtering; Rule 20.1 (UTC days), 20.8 (90-day cap):
  // the org request carries the URL range, which DateRangeQuerySchema requires.
  describe("global date range (Design System -- Management pages)", () => {
    function urls() {
      const seen: URL[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          seen.push(new URL(String(input), "http://localhost"));
          return Promise.resolve(
            apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"),
          );
        }),
      );
      return seen;
    }

    it("sends the URL dateFrom and dateTo", async () => {
      const seen = urls();
      vi.spyOn(console, "error").mockImplementation(() => {});
      renderWithProviders(
        <LiteLLMSection title="Organisation" reported>
          <OrganisationSection />
        </LiteLLMSection>,
        { searchParams: { dateFrom: "2026-10-01", dateTo: "2026-10-31" } },
      );
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(seen[0]?.searchParams.get("dateFrom")).toBe("2026-10-01");
      expect(seen[0]?.searchParams.get("dateTo")).toBe("2026-10-31");
    });

    it("sends the default range when the URL has none", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
      const expected = resolveUrlRange(null, null);
      const seen = urls();
      renderSection();
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(seen[0]?.searchParams.get("dateFrom")).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
      expect(seen[0]?.searchParams.get("dateFrom")).toBe(expected.dateFrom);
      expect(seen[0]?.searchParams.get("dateTo")).toBe(expected.dateTo);
    });

    it("refetches with the new range when the URL range changes", async () => {
      const seen = urls();
      vi.spyOn(console, "error").mockImplementation(() => {});
      function Change() {
        const [, set] = useQueryStates(dateRangeSearchParams);
        return (
          <button
            onClick={() =>
              void set({ dateFrom: "2026-09-01", dateTo: "2026-09-10" })
            }
          >
            change range
          </button>
        );
      }
      renderWithProviders(
        <>
          <Change />
          <LiteLLMSection title="Organisation" reported>
            <OrganisationSection />
          </LiteLLMSection>
        </>,
        { searchParams: { dateFrom: "2026-10-01", dateTo: "2026-10-31" } },
      );
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      await act(async () => {
        screen.getByRole("button", { name: "change range" }).click();
      });
      await vi.waitFor(() =>
        expect(seen.at(-1)?.searchParams.get("dateFrom")).toBe("2026-09-01"),
      );
      expect(seen.at(-1)?.searchParams.get("dateTo")).toBe("2026-09-10");
    });
  });
});
