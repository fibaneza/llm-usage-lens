import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  PROXY_TEAM_CAPPED,
  PROXY_TEAM_ID,
  stubProxyTeam,
} from "@/test/fixtures/proxy-team";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyTeamPageContent } from "./ProxyTeamPageContent";

// Sources: Design System - LiteLLM team page (unit LP1, D-R3-7, D-R3-9),
// T-LP4 and T-LP5: "It shows: alias and id; spend and budget ...; the models;
// the members (the existing members read, at most 200, with Reset spend and
// Reset budget where RS2 gives them); and the linked app team with its lead
// names ... A breadcrumb leads back to the tab"; Rule 40.4 / 40.9 / 60.12
// (every section is a Panel with its own Suspense and ErrorBoundary);
// LiteLLM spec - API routes (the members read), RS2 (Reset by LiteLLM ids).
//
// Contract (new module components/litellm/proxy-team/ProxyTeamPageContent.tsx):
//   ProxyTeamPageContent({ litellmTeamId, canReset }: { litellmTeamId: string;
//   canReset: boolean }) renders a PageHeader whose breadcrumb has a link
//   "LiteLLM teams" to /dashboard/manage/litellm/teams, then three Panels:
//   ProxyTeamSummaryPanel ("Summary"), the existing LiteLLMTeamMembersPanel
//   inside a Panel titled "Members" (teamName = the team's alias; canReset
//   passed through), and ProxyTeamLinkPanel ("Linked dashboard team").
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (canReset = true) =>
  renderWithProviders(
    <ProxyTeamPageContent litellmTeamId={PROXY_TEAM_ID} canReset={canReset} />,
  );

describe("ProxyTeamPageContent (T-LP4, T-LP5)", () => {
  it("T-LP4: breadcrumb link back to the LiteLLM teams tab", async () => {
    stubProxyTeam();
    render();
    expect(
      await screen.findByRole("link", { name: "LiteLLM teams" }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/teams");
  });

  it("T-LP4 / Rule 40.9: Summary, Members and Linked dashboard team are three regions, each with a heading", async () => {
    stubProxyTeam();
    render();
    for (const name of ["Summary", "Members", "Linked dashboard team"]) {
      const region = await screen.findByRole("region", { name });
      expect(within(region).getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("T-LP4: the Members panel lists the team's members under its alias, from the members read", async () => {
    stubProxyTeam();
    render();
    const region = await screen.findByRole("region", { name: "Members" });
    const table = await within(region).findByRole("table", {
      name: "Members of Payments LLM",
    });
    expect(within(table).getByText("ada@example.test")).toBeInTheDocument();
    expect(within(table).getByText("zed@example.test")).toBeInTheDocument();
  });

  it("T-LP4 / RS2: with canReset each member row has Reset spend and Reset budget, and opening one confirms first without writing", async () => {
    const calls = stubProxyTeam();
    render(true);
    const user = userEvent.setup();
    const resetSpend = await screen.findByRole("button", {
      name: "Reset spend for Ada Lovelace",
    });
    expect(
      screen.getByRole("button", { name: "Reset budget for Ada Lovelace" }),
    ).toBeInTheDocument();
    await user.click(resetSpend);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("T-LP4 / RS2: without canReset (the auditor) no reset control is rendered", async () => {
    stubProxyTeam();
    render(false);
    await screen.findByRole("table", { name: "Members of Payments LLM" });
    expect(screen.queryByRole("button", { name: /^Reset /i })).toBeNull();
  });

  it("T-LP4: one team read serves the Summary and the link panel (one GET to the team route) plus one members GET", async () => {
    const calls = stubProxyTeam();
    render();
    await screen.findByRole("table", { name: "Members of Payments LLM" });
    await within(
      await screen.findByRole("region", { name: "Linked dashboard team" }),
    ).findByText("Payments");
    expect(
      calls.filter((c) => c.path === "/api/litellm/proxy-teams/ll-team-1"),
    ).toHaveLength(1);
    expect(calls.map((c) => c.path).sort()).toEqual([
      "/api/litellm/proxy-teams/ll-team-1",
      "/api/litellm/proxy-teams/ll-team-1/members",
    ]);
  });

  it("T-LP4 / LD23: under the Organisation cap the page shows no dollar figure for the team", async () => {
    stubProxyTeam({ team: PROXY_TEAM_CAPPED });
    render();
    const region = await screen.findByRole("region", { name: "Summary" });
    await within(region).findByText("Payments LLM");
    expect(region.textContent).not.toContain("$");
    expect(within(region).queryByRole("progressbar")).toBeNull();
  });

  it("Rule 40.4 / 60.12: a failing team read breaks only its own panels; the members still show", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyTeam({ team: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText("Couldn't load Summary."),
    ).toBeInTheDocument();
    expect(await screen.findByText("ada@example.test")).toBeInTheDocument();
  });

  it("Rule 40.4 / 60.12: a failing members read leaves the Summary and the link panel up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyTeam({ members: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(await screen.findByText("Payments LLM")).toBeInTheDocument();
    expect(
      await within(
        await screen.findByRole("region", { name: "Linked dashboard team" }),
      ).findByText("Ada Lovelace"),
    ).toBeInTheDocument();
  });
});
