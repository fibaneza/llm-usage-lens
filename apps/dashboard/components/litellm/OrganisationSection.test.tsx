import { act, screen, within } from "@testing-library/react";
import { useQueryStates } from "nuqs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// /dashboard/team-usage?team=<teamId> (M2 Verify: the open-team row opens Team
// usage for that team; AT6); both lists empty -> "No teams".
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Amended 2026-11-25 (Design System - LiteLLM teams tab, round 3, unit LP1,
// T-LP2/T-LP5; App Teams spec - Organisation view): the App teams table and its
// "Rows overlap" sentence are gone; GET /api/litellm/org still returns
// appTeams[] (the fixture keeps it). A linked app team's name in the LiteLLM
// teams table links to its team page; each LiteLLM team's name links to its page.
const ORG = {
  configured: true,
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

// Unit OC1 (Design System -- LiteLLM Organisation spend chart, T-OC6): the
// tab opens with four tiles, then the panel "Spend over time", then the
// LiteLLM teams table; the daily table stands only as the panel's Table view.
// The lazy chart is a probe here (the chart has its own test, Rule 60.24a).
vi.mock("@/components/charts/LazyCharts", () => ({
  LazySpendTimelineChart: (props: { label: string }) => (
    <div role="img" aria-label={props.label} />
  ),
}));

const ORG_OC1 = {
  ...ORG,
  totals: { spend: 1234.5, requests: 2469, tokens: 5_000_000 },
  daily: [
    { date: "2026-11-14", spend: 100, requests: 200, tokens: 400_000 },
    { date: "2026-11-15", spend: 50, requests: 100, tokens: 300_000 },
  ],
  dailyByTeam: [
    {
      litellmTeamId: "ll-1",
      alias: "Payments LLM",
      daily: [
        { date: "2026-11-14", spend: 100, requests: 200, tokens: 400_000 },
      ],
    },
  ],
};

describe("OrganisationSection -- OC1 chart tab (T-OC6)", () => {
  it("T-OC6: no daily table by default; the tiles, the panel and the teams table come in that order", async () => {
    stub(() => apiResponse({ data: ORG_OC1 }));
    renderSection();
    const teams = await screen.findByRole("table", { name: "LiteLLM teams" });
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByText("Daily spend by UTC day")).toBeNull();

    const tile = screen.getByRole("group", { name: "Total spend" });
    expect(tile).toHaveTextContent("$1,234.50");
    expect(
      screen.getByRole("group", { name: "Average cost per request" }),
    ).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Spend over time" });
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(tile.compareDocumentPosition(heading) & following).toBeTruthy();
    expect(heading.compareDocumentPosition(teams) & following).toBeTruthy();
  });

  it("T-OC6: 'LiteLLM not configured' and 'No teams' show no tiles and no panel", async () => {
    stub(() =>
      apiResponse({
        data: {
          ...ORG_OC1,
          configured: false,
          litellmTeams: [],
          dailyByTeam: [],
        },
      }),
    );
    const first = renderSection();
    await screen.findByText(/LiteLLM not configured/i);
    expect(screen.queryByRole("group", { name: "Total spend" })).toBeNull();
    expect(screen.queryByText("Spend over time")).toBeNull();
    first.unmount();

    stub(() => apiResponse({ data: { ...ORG_OC1, litellmTeams: [] } }));
    renderSection();
    await screen.findByText(/no teams/i);
    expect(screen.queryByText("Spend over time")).toBeNull();
  });

  it("T-OC6: 'LiteLLM unavailable' shows no tiles and no panel", async () => {
    stub(() => apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"));
    renderSection();
    await screen.findByText(/LiteLLM unavailable/i);
    expect(screen.queryByText("Spend over time")).toBeNull();
    expect(screen.queryByRole("group", { name: "Total spend" })).toBeNull();
  });
});

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

  it("T-LP2: no App teams table or card list and no 'Rows overlap' sentence, though appTeams[] is in the answer (Design System - LiteLLM team page, T-LP2)", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    await screen.findByRole("table", { name: "LiteLLM teams" });
    expect(screen.queryByRole("table", { name: "App teams" })).toBeNull();
    expect(screen.queryByRole("list", { name: "App teams" })).toBeNull();
    expect(screen.queryByText(/rows overlap/i)).toBeNull();
    expect(screen.queryByText(/per app team/i)).toBeNull();
    // App-only teams (no LiteLLM team) have no row anywhere on the tab.
    expect(screen.queryByText("Risk")).toBeNull();
    expect(screen.queryByText("Ops")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /open the team page/i }),
    ).toBeNull();
  });

  it("the headline total is the LiteLLM teams' total from the response, never a sum of the app team rows (AT5)", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    const region = await screen.findByRole("region", { name: "Organisation" });
    expect(await within(region).findByText("$1,234.50")).toBeInTheDocument();
    // 321.75 + 4 would be 325.75 if the app rows were added up.
    expect(within(region).queryByText("$325.75")).toBeNull();
  });

  // T-LP2: "a linked app team's name links to its team page" (App Teams spec -
  // Organisation view, amended 2026-11-25). An unlinked team names no team page.
  it("T-LP2: the LiteLLM teams table links a linked app team's name to /dashboard/manage/team/<teamId>; an unlinked row has no such link", async () => {
    stub(() => apiResponse({ data: ORG }));
    renderSection();
    const table = await screen.findByRole("table", { name: "LiteLLM teams" });
    const linked = within(table).getByRole("row", { name: /Payments LLM/ });
    expect(
      within(linked).getByRole("link", { name: "Payments" }),
    ).toHaveAttribute("href", "/dashboard/manage/team/t1");
    const shared = within(table).getByRole("row", { name: /Shared platform/ });
    expect(within(shared).getByText(/unlinked/i)).toBeInTheDocument();
    expect(
      within(shared)
        .queryAllByRole("link")
        .map((l) => l.getAttribute("href")),
    ).not.toContain(expect.stringContaining("/dashboard/manage/team/"));
  });

  // T-LP5: the team names link to the LiteLLM team page.
  it("T-LP5: each LiteLLM team's name links to /dashboard/manage/litellm/teams/<encoded id>", async () => {
    stub(() =>
      apiResponse({
        data: {
          ...ORG,
          litellmTeams: [
            ...ORG.litellmTeams,
            {
              litellmTeamId: "ll/odd id",
              alias: "Odd team",
              spend: 1,
              maxBudget: null,
              memberCount: 1,
              linkedAppTeam: null,
            },
          ],
        },
      }),
    );
    renderSection();
    const table = await screen.findByRole("table", { name: "LiteLLM teams" });
    expect(
      within(table).getByRole("link", { name: "Payments LLM" }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/teams/ll-1");
    expect(
      within(table).getByRole("link", { name: "Shared platform" }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/teams/ll-2");
    expect(
      within(table).getByRole("link", { name: "Odd team" }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/teams/ll%2Fodd%20id");
  });

  describe("in the card layout (below md)", () => {
    const originalWidth = window.innerWidth;
    beforeEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 375,
      });
    });
    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    });

    it("T-LP2/T-LP5: each LiteLLM team card links its name to the team's page and its app team to the Team page", async () => {
      stub(() => apiResponse({ data: ORG }));
      renderSection();
      const cards = await screen.findByRole("list", { name: "LiteLLM teams" });
      const items = within(cards).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(
        within(items[0]!).getByRole("link", { name: "Payments LLM" }),
      ).toHaveAttribute("href", "/dashboard/manage/litellm/teams/ll-1");
      expect(
        within(items[0]!).getByRole("link", { name: "Payments" }),
      ).toHaveAttribute("href", "/dashboard/manage/team/t1");
      expect(screen.queryByRole("list", { name: "App teams" })).toBeNull();
    });

    // L5b review warning, LD37 in the card layout (docs/specs/2026-11-10-
    // litellm.md LD37; Design System - LiteLLM Page, States).
    it("LD37: configured:false shows 'LiteLLM not configured' and no card list at all (the App teams cards are gone, T-LP2)", async () => {
      stub(() =>
        apiResponse({
          data: {
            configured: false,
            totals: { spend: 0 },
            daily: [],
            litellmTeams: [],
            appTeams: [
              {
                teamId: "t1",
                teamName: "Payments",
                spendSource: "litellm-team",
                spend: null,
              },
            ],
            enabledOperations: [],
          },
        }),
      );
      renderSection();
      expect(
        await screen.findByText(/LiteLLM not configured/i),
      ).toBeInTheDocument();
      expect(screen.queryByRole("list")).toBeNull();
    });
  });

  it("shows an empty state when there is no team at all", async () => {
    stub(() =>
      apiResponse({
        data: {
          configured: true,
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

  it("T-LP2: configured, no LiteLLM team but app teams in the answer still shows 'No teams' (the app teams are not shown)", async () => {
    stub(() =>
      apiResponse({
        data: { ...ORG, litellmTeams: [], totals: { spend: 0 }, daily: [] },
      }),
    );
    renderSection();
    expect(await screen.findByText(/no teams/i)).toBeInTheDocument();
    expect(screen.queryByText("Risk")).toBeNull();
  });

  // LD37 (docs/specs/2026-11-10-litellm.md); Design System - LiteLLM Page,
  // States: `configured: false` shows "LiteLLM not configured" in place of the
  // LiteLLM teams table and still lists the app teams with "Not available".
  describe("LiteLLM not configured (LD37; Design System - LiteLLM Page, States)", () => {
    const UNCONFIGURED = {
      configured: false,
      totals: { spend: 0 },
      daily: [],
      litellmTeams: [],
      appTeams: [
        {
          teamId: "t1",
          teamName: "Payments",
          spendSource: "litellm-team",
          spend: null,
        },
        {
          teamId: "t2",
          teamName: "Risk",
          spendSource: "member-sum",
          spend: null,
        },
      ],
      enabledOperations: [],
    };

    it("shows 'LiteLLM not configured' instead of the LiteLLM teams table, with no error and no 'No teams'", async () => {
      stub(() => apiResponse({ data: UNCONFIGURED }));
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      renderWithProviders(
        <LiteLLMSection title="Organisation" reported>
          <OrganisationSection />
        </LiteLLMSection>,
      );
      expect(
        await screen.findByText(/LiteLLM not configured/i),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table", { name: "LiteLLM teams" })).toBeNull();
      expect(screen.queryByText(/no teams/i)).toBeNull();
      expect(screen.queryByText(/LiteLLM unavailable/i)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(errors).not.toHaveBeenCalled();
    });

    it("T-LP2: no App teams table, no 'Not available' cell and no figure: the App teams table is gone", async () => {
      stub(() => apiResponse({ data: UNCONFIGURED }));
      renderSection();
      await screen.findByText(/LiteLLM not configured/i);
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByText(/not available/i)).toBeNull();
      expect(screen.queryByText("Risk")).toBeNull();
    });
  });

  it("shows an inline 'LiteLLM unavailable' on a 503 (Design System -- LiteLLM Page, States)", async () => {
    stub(() => apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"));
    renderSection();
    expect(await screen.findByText(/LiteLLM unavailable/i)).toBeInTheDocument();
  });

  // T-LP2: the per-app-team "Budget resets" column (M4, MG-D10) lived in the
  // removed App teams table, so its read (GET /api/budget-resets) goes with it.
  it("T-LP2: requests GET /api/litellm/org only; no Budget resets column and no GET /api/budget-resets", async () => {
    const calls = stub(() => apiResponse({ data: ORG }));
    renderSection();
    const table = await screen.findByRole("table", { name: "LiteLLM teams" });
    expect(new Set(calls)).toEqual(new Set(["/api/litellm/org"]));
    expect(
      within(table).queryByRole("columnheader", { name: "Budget resets" }),
    ).toBeNull();
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
