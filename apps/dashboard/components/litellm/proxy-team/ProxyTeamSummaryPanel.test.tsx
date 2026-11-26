import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatSydneyTime } from "@/components/litellm/sydney-time";
import { apiError } from "@/test/fakes/api-stubs";
import {
  PROXY_TEAM,
  PROXY_TEAM_CAPPED,
  PROXY_TEAM_ID,
  stubProxyTeam,
} from "@/test/fixtures/proxy-team";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyTeamSummaryPanel } from "./ProxyTeamSummaryPanel";

// Sources: Design System - LiteLLM team page (unit LP1, D-R3-7, D-R3-9),
// T-LP4: "alias and id; spend and budget with a BudgetBar and the budget's
// reset time; the models"; "Under the Organisation cap spend and budget are
// omitted"; LiteLLM spec - API routes, GET /api/litellm/proxy-teams/
// [litellmTeamId], LD20 (LiteLLM times in Australia/Sydney), LD23, LT-key
// ("no key, key alias or secret").
//
// Contract (new module components/litellm/proxy-team/ProxyTeamSummaryPanel.tsx):
//   ProxyTeamSummaryPanel({ litellmTeamId }: { litellmTeamId: string }),
//   a Panel (region) titled "Summary" that GETs
//   /api/litellm/proxy-teams/<encoded litellmTeamId> (hook useProxyTeam in
//   use-proxy-team.ts, shared with ProxyTeamLinkPanel so one team page makes one
//   request) and parses LiteLLMProxyTeamResponseSchema. Failure shows the
//   Panel's "Couldn't load Summary." state.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = () =>
  renderWithProviders(<ProxyTeamSummaryPanel litellmTeamId={PROXY_TEAM_ID} />);
const summary = () => screen.findByRole("region", { name: "Summary" });

describe("ProxyTeamSummaryPanel (T-LP4)", () => {
  it("T-LP4: shows the alias and the id, the member count and the models", async () => {
    stubProxyTeam();
    render();
    const region = await summary();
    expect(await within(region).findByText("Payments LLM")).toBeInTheDocument();
    expect(within(region).getByText("ll-team-1")).toBeInTheDocument();
    expect(within(region).getByText("7")).toBeInTheDocument();
    expect(within(region).getByText("claude-sonnet")).toBeInTheDocument();
    expect(within(region).getByText("claude-haiku")).toBeInTheDocument();
  });

  it("T-LP4: shows spend and budget in USD with a BudgetBar and the reset time in Sydney time (LD20)", async () => {
    stubProxyTeam();
    render();
    const region = await summary();
    expect(await within(region).findByText("$321.75")).toBeInTheDocument();
    expect(within(region).getByText("$500.00")).toBeInTheDocument();
    const bar = within(region).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "64");
    expect(within(region).getByText("64%")).toBeInTheDocument();
    // 2026-12-01T00:00:00Z is 11:00 AEDT in Sydney (LD20).
    expect(formatSydneyTime(PROXY_TEAM.budgetResetAt)).toMatch(
      /Dec 2026, 11:00 AEDT$/,
    );
    expect(
      within(region).getByText(/Dec 2026, 11:00 AEDT/),
    ).toBeInTheDocument();
  });

  it("T-LP4: no budget reads 'No limit', draws no bar and shows no reset time", async () => {
    stubProxyTeam({
      team: { ...PROXY_TEAM, maxBudget: null, budgetResetAt: null },
    });
    render();
    const region = await summary();
    expect(await within(region).findByText("$321.75")).toBeInTheDocument();
    expect(within(region).getByText(/no limit/i)).toBeInTheDocument();
    expect(within(region).queryByRole("progressbar")).toBeNull();
    expect(within(region).queryByText(/AEDT|AEST/)).toBeNull();
  });

  it("T-LP4 decision (e): a team with a budget but no reset time shows 'Budget resets: Not set'", async () => {
    stubProxyTeam({ team: { ...PROXY_TEAM, budgetResetAt: null } });
    render();
    const region = await summary();
    expect(await within(region).findByText("$500.00")).toBeInTheDocument();
    expect(region).toHaveTextContent("Budget resets: Not set");
    expect(within(region).queryByText(/AEDT|AEST/)).toBeNull();
  });

  it("T-LP4 / LD23: under the Organisation cap spend and budget are omitted: no figure, no bar, no 'No limit'", async () => {
    stubProxyTeam({ team: PROXY_TEAM_CAPPED });
    render();
    const region = await summary();
    expect(await within(region).findByText("Payments LLM")).toBeInTheDocument();
    expect(region.textContent).not.toContain("$");
    expect(within(region).queryByRole("progressbar")).toBeNull();
    expect(within(region).queryByText(/no limit/i)).toBeNull();
  });

  it("makes one GET to the team route with the id percent-encoded, and no other request (no key or token route)", async () => {
    const calls = stubProxyTeam();
    renderWithProviders(<ProxyTeamSummaryPanel litellmTeamId="ll/odd id" />);
    await summary();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    // Design System - LiteLLM team page, T-LP4: exactly one GET, no query.
    expect(calls).toEqual([
      {
        path: "/api/litellm/proxy-teams/ll%2Fodd%20id",
        method: "GET",
        search: "",
      },
    ]);
  });

  it("Rule 40.4: a failed read shows the panel's own error and does not throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyTeam({ team: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText("Couldn't load Summary."),
    ).toBeInTheDocument();
  });
});
