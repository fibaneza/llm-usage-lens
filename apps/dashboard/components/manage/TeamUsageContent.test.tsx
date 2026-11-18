import { screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamUsageContent } from "./TeamUsageContent";

// Sources: Design System - Management pages, Team usage (D7, 2026-11-17: a
// page description, the ScopeLine for a lead, a team picker (nuqs `team`)
// shown only when the caller can open more than one team, one "Team spend"
// Panel with the LiteLLM-reported label and "Daily figures are UTC days.");
// Access Control - MI-D7 (the picker lists only the teams the page was given;
// the page decides the list and the member-sum flag); App Teams spec - AT6
// (include=memberSum only when the page says includeMemberSum, i.e. a global
// reader); LiteLLM spec - LT8 (LiteLLM-reported label), LD20 (UTC days);
// Rules 40.4, 60.12, 60.24a. The panel's own figures are tested in
// TeamSpendPanel.test.tsx; the gate, the list and the flag are tested in
// app/dashboard/team-usage/page.test.tsx.
const TEAMS = [
  { teamId: "t1", teamName: "Payments", linked: true },
  { teamId: "t2", teamName: "Risk", linked: false },
  { teamId: "t3", teamName: "Ops", linked: true },
];

const linked = (alias: string, spend: number) => ({
  connected: true,
  spendSource: "litellm-team",
  team: {
    alias,
    spend,
    maxBudget: 500,
    softBudget: null,
    budgetDuration: null,
    models: [],
    rpmLimit: null,
    tpmLimit: null,
  },
  daily: [],
  enabledOperations: [],
});

const unlinked = {
  connected: false,
  spendSource: "member-sum",
  daily: [],
  memberSum: {
    total: 4,
    daily: [],
    coverage: { members: 1, matched: 1, unmatched: 0, pending: 0 },
    members: [{ oid: "oid-u1", name: "Una One", matched: true, spend: 4 }],
  },
};

const DETAIL: Record<string, unknown> = {
  "/api/litellm/teams/t1": linked("Payments", 111.11),
  "/api/litellm/teams/t2": unlinked,
  "/api/litellm/teams/t3": linked("Ops", 33.33),
};

// Stubbed same-origin fetch (Rule 60.24: no network); records every URL.
function stub() {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url);
      const data = DETAIL[url.pathname];
      if (!data) throw new Error(`unexpected GET ${url.pathname}`);
      return apiResponse({ data });
    }),
  );
  return {
    urls,
    paths: () => new Set(urls.map((u) => u.pathname)),
  };
}

function renderContent(
  props: Partial<React.ComponentProps<typeof TeamUsageContent>> = {},
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  return renderWithProviders(
    <TeamUsageContent
      teams={TEAMS}
      includeMemberSum={false}
      scopeLabel={null}
      {...props}
    />,
    options,
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TeamUsageContent page frame (Management pages - Team usage)", () => {
  it("opens with the one-line description and the 'Team spend' region with the LiteLLM-reported label and the UTC-day note (LT8, LD20)", async () => {
    stub();
    renderContent();

    expect(
      screen.getByText("LiteLLM-reported spend for your teams"),
    ).toBeInTheDocument();
    const spend = await screen.findByRole("region", { name: "Team spend" });
    expect(
      within(spend).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
    expect(
      within(spend).getByText("Daily figures are UTC days."),
    ).toBeInTheDocument();
    expect(await within(spend).findByText("$111.11")).toBeInTheDocument();
  });

  it("states the scope for a lead: 'Showing teams you lead: <names>'", () => {
    stub();
    renderContent({ scopeLabel: "Showing teams you lead" });

    expect(
      screen.getByText("Showing teams you lead: Payments, Risk, Ops"),
    ).toBeInTheDocument();
  });

  it("states no scope for a global reader (scopeLabel null)", () => {
    stub();
    renderContent({ scopeLabel: null });

    expect(screen.queryByText(/Showing /)).toBeNull();
  });

  it("with no teams shows 'You have no teams to show.' and makes no read", () => {
    const api = stub();
    renderContent({ teams: [] });

    expect(screen.getByText("You have no teams to show.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Team spend" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Team" })).toBeNull();
    expect(api.urls).toEqual([]);
  });
});

describe("TeamUsageContent team picker (Team usage: nuqs team; shown with more than one team)", () => {
  it("with one team there is no picker and that team is read", async () => {
    const api = stub();
    renderContent({ teams: [TEAMS[0]!] });

    await screen.findByText("$111.11");
    expect(screen.queryByRole("combobox", { name: "Team" })).toBeNull();
    expect(api.paths()).toEqual(new Set(["/api/litellm/teams/t1"]));
  });

  it("with several teams the picker lists exactly the given teams, opens on the first and reads only it", async () => {
    const api = stub();
    renderContent();

    const picker = await screen.findByRole("combobox", { name: "Team" });
    expect(
      within(picker)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Payments", "Risk", "Ops"]);
    expect(picker).toHaveValue("t1");
    await screen.findByText("$111.11");
    expect(api.paths()).toEqual(new Set(["/api/litellm/teams/t1"]));
  });

  it("?team= deep links to that team (the Organisation open-team row) and reads that team", async () => {
    const api = stub();
    renderContent({}, { searchParams: { team: "t3" } });

    expect(await screen.findByRole("combobox", { name: "Team" })).toHaveValue(
      "t3",
    );
    expect(await screen.findByText("$33.33")).toBeInTheDocument();
    expect(api.paths()).toEqual(new Set(["/api/litellm/teams/t3"]));
  });

  it("picking a team writes ?team= as a history push and re-reads the spend for that team (linked or not)", async () => {
    const api = stub();
    const onUrlUpdate = vi.fn();
    renderContent({}, { onUrlUpdate });
    await screen.findByText("$111.11");

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Team" }),
      "Risk",
    );

    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("team")).toBe(
        "t2",
      ),
    );
    expect(onUrlUpdate.mock.lastCall?.[0].options.history).toBe("push");
    const spend = screen.getByRole("region", { name: "Team spend" });
    expect(
      await within(spend).findByText("Sum of members"),
    ).toBeInTheDocument();
    expect(api.paths()).toContain("/api/litellm/teams/t2");
  });
});

describe("TeamUsageContent include=memberSum (App Teams - AT6; LiteLLM - LT28)", () => {
  it("includeMemberSum false (a Lead): no read of any team carries an include parameter", async () => {
    const api = stub();
    renderContent({ includeMemberSum: false });
    await screen.findByText("$111.11");

    expect(api.urls.length).toBeGreaterThan(0);
    for (const url of api.urls) {
      expect(url.searchParams.has("include")).toBe(false);
    }
  });

  it("includeMemberSum true (a global reader): the team read carries include=memberSum", async () => {
    const api = stub();
    renderContent({ includeMemberSum: true });
    await screen.findByText("$111.11");

    expect(api.urls.length).toBeGreaterThan(0);
    for (const url of api.urls) {
      expect(url.searchParams.get("include")).toBe("memberSum");
    }
  });
});

// Source: Rules 40.4 and 60.12 (a section's data is fetched in the browser
// behind its own Suspense; the server renders the skeleton); the LiteLLM
// sections gate the same way (LiteLLMSection, useIsClient). A query that runs
// during server rendering calls fetch with a relative URL, which throws on the
// server and surfaces as React error #419 in the browser (found by the nav
// smoke spec and the responsive spec for /dashboard/team-usage, 2026-11-18).
describe("TeamUsageContent server rendering (Rules 40.4, 60.12)", () => {
  it("renders the Team spend skeleton on the server and starts no LiteLLM read", () => {
    const api = stub();
    const Nuqs = withNuqsTestingAdapter({ searchParams: {}, hasMemory: true });
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <Nuqs>
          <TeamUsageContent
            teams={TEAMS}
            includeMemberSum={false}
            scopeLabel={null}
          />
        </Nuqs>
      </QueryClientProvider>,
    );
    expect(html).toContain("Team spend");
    expect(api.urls).toHaveLength(0);
  });
});
