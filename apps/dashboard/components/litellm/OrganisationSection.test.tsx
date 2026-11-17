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
// Amended 2026-11-17 (docs/specs/2026-11-17-app-teams.md - Organisation view):
// two tables replace the per-linked-team table. Assumed GET /api/litellm/org data:
//   { totals: { spend }, daily: [{ date, spend }], enabledOperations,
//     litellmTeams: [{ litellmTeamId, alias, spend, maxBudget: number|null,
//                      memberCount, linkedAppTeam: { teamId, teamName } | null }],
//     appTeams: [{ teamId, teamName, spendSource, spend: number|null,
//                  reason?: "open-team", coverage? }] } (route tests are the contract)
// UI contract: tables named "LiteLLM teams" (alias, spend, budget, members,
// linked app team or "unlinked") and "App teams" (name, spend source "LiteLLM
// team" / "Sum of members", spend, coverage "<n> members: <m> matched, <u> not
// in LiteLLM, <p> pending"); the App teams label "Per app team. Rows overlap
// with each other and do not add up to the total."; the headline total is
// totals.spend; an open-team row has no spend and a link to
// /dashboard/manage/team?team=<teamId>; both lists empty -> "No teams".
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ORG = {
  totals: { spend: 1234.5 },
  daily: [{ date: "2026-11-14", spend: 100 }],
  enabledOperations: [],
  litellmTeams: [
    {
      litellmTeamId: "ll-1",
      alias: "Payments LLM",
      spend: 321.75,
      maxBudget: 500,
      memberCount: 7,
      linkedAppTeam: { teamId: "t1", teamName: "Payments" },
    },
    {
      litellmTeamId: "ll-2",
      alias: "Shared platform",
      spend: 12,
      maxBudget: null,
      memberCount: 3,
      linkedAppTeam: null,
    },
  ],
  appTeams: [
    {
      teamId: "t1",
      teamName: "Payments",
      spendSource: "litellm-team",
      spend: 321.75,
    },
    {
      teamId: "t2",
      teamName: "Risk",
      spendSource: "member-sum",
      spend: 4,
      coverage: { members: 3, matched: 2, unmatched: 1, pending: 1 },
    },
    {
      teamId: "t3",
      teamName: "Ops",
      spendSource: "member-sum",
      spend: null,
      reason: "open-team",
    },
  ],
};
const APP_TEAMS_LABEL =
  "Per app team. Rows overlap with each other and do not add up to the total.";

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

  it("the 'LiteLLM teams' table lists every proxy team with alias, spend, budget, members and the linked app team or 'unlinked' (Organisation view)", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    const table = await screen.findByRole("table", { name: "LiteLLM teams" });
    const linked = within(table).getByRole("row", { name: /Payments LLM/ });
    expect(within(linked).getByText("$321.75")).toBeInTheDocument();
    expect(within(linked).getByText("$500.00")).toBeInTheDocument();
    expect(within(linked).getByText("7")).toBeInTheDocument();
    expect(within(linked).getByText("Payments")).toBeInTheDocument();
    const shared = within(table).getByRole("row", {
      name: /Shared platform/,
    });
    expect(within(shared).getByText(/no limit/i)).toBeInTheDocument();
    expect(within(shared).getByText(/unlinked/i)).toBeInTheDocument();
  });

  it("the 'App teams' table lists every app team with its spend source, spend and coverage, under the 'rows overlap' label (Organisation view; ATT5)", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    const table = await screen.findByRole("table", { name: "App teams" });
    expect(screen.getByText(APP_TEAMS_LABEL)).toBeInTheDocument();
    const payments = within(table).getByRole("row", { name: /Payments/ });
    expect(within(payments).getByText("LiteLLM team")).toBeInTheDocument();
    expect(within(payments).getByText("$321.75")).toBeInTheDocument();
    const risk = within(table).getByRole("row", { name: /Risk/ });
    expect(within(risk).getByText("Sum of members")).toBeInTheDocument();
    expect(within(risk).getByText("$4.00")).toBeInTheDocument();
    expect(risk.textContent).toMatch(/2 matched/);
    expect(risk.textContent).toMatch(/1 not in LiteLLM/);
    expect(risk.textContent).toMatch(/1 pending/);
  });

  it("the headline total is the LiteLLM teams' total from the response, never a sum of the app team rows (AT5)", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    const region = await screen.findByRole("region", { name: "Organisation" });
    expect(await within(region).findByText("$1,234.50")).toBeInTheDocument();
    // 321.75 + 4 would be 325.75 if the app rows were added up.
    expect(within(region).queryByText("$325.75")).toBeNull();
  });

  it("an open-team row has no spend and links to that team's Team page (AT6)", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    const table = await screen.findByRole("table", { name: "App teams" });
    const ops = within(table).getByRole("row", { name: /Ops/ });
    expect(ops.textContent).not.toContain("$");
    const link = within(ops).getByRole("link");
    expect(link.getAttribute("href")).toMatch(
      /^\/dashboard\/manage\/team\?(.*&)?team=t3(&|$)/,
    );
  });

  it("shows an empty state when there is no team at all", async () => {
    stub(() =>
      apiResponse({
        data: {
          totals: { spend: 0 },
          daily: [],
          litellmTeams: [],
          appTeams: [],
          enabledOperations: [],
        },
      }),
    );
    renderSection();
    expect(await screen.findByText(/no teams/i)).toBeInTheDocument();
  });

  it("shows an inline 'LiteLLM unavailable' on a 503 (Design System -- LiteLLM Page, States)", async () => {
    stub(() => apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"));
    renderSection();
    expect(await screen.findByText(/LiteLLM unavailable/i)).toBeInTheDocument();
  });

  it("requests GET /api/litellm/org only", async () => {
    const calls = stub(() => apiResponse({ data: ORG }));
    renderSection();
    await screen.findByRole("table", { name: "LiteLLM teams" });
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
