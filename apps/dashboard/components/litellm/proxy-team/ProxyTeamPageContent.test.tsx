import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  PROXY_TEAM_CAPPED,
  PROXY_TEAM_DAILY_CAPPED,
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

// The chart itself is covered by SpendTimelineChart.test.tsx; here it is a probe.
vi.mock("@/components/charts/LazyCharts", () => ({
  LazySpendTimelineChart: (props: { label: string }) => (
    <div role="img" aria-label={props.label} />
  ),
}));

const RANGE = { dateFrom: "2026-11-01", dateTo: "2026-11-30" };
const render = (canReset = true, name: string | null = null) =>
  renderWithProviders(
    <ProxyTeamPageContent
      litellmTeamId={PROXY_TEAM_ID}
      name={name}
      canReset={canReset}
    />,
    { searchParams: RANGE },
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
    // LP3 (T-LP16): the daily panel adds its own read, /daily.
    expect(calls.map((c) => c.path).sort()).toEqual([
      "/api/litellm/proxy-teams/ll-team-1",
      "/api/litellm/proxy-teams/ll-team-1/daily",
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

  // T-LP16 (Design System - LiteLLM team page, name and spend over time): a
  // Spend over time panel stands after Summary, has its own Suspense and
  // ErrorBoundary, and is absent while the cap hides cost.
  it("T-LP16: a 'Spend over time' region stands directly after Summary and before Members", async () => {
    stubProxyTeam();
    render();
    const summary = await screen.findByRole("region", { name: "Summary" });
    const spend = await screen.findByRole("region", {
      name: "Spend over time",
    });
    const members = await screen.findByRole("region", { name: "Members" });
    const after = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(summary, spend)).toBe(true);
    expect(after(spend, members)).toBe(true);
  });

  it("T-LP16: a failed daily read leaves Summary, Members and the link panel up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyTeam({ daily: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText(/Couldn't load spend over time\./i),
    ).toBeInTheDocument();
    expect(await screen.findByText("Payments LLM")).toBeInTheDocument();
    expect(await screen.findByText("ada@example.test")).toBeInTheDocument();
    expect(
      await within(
        await screen.findByRole("region", { name: "Linked dashboard team" }),
      ).findByText("Ada Lovelace"),
    ).toBeInTheDocument();
  });

  it("T-LP16 / LD23: under the cap (no `daily`) the Spend over time region is absent and the rest stays", async () => {
    const calls = stubProxyTeam({ daily: PROXY_TEAM_DAILY_CAPPED });
    render();
    await screen.findByRole("region", { name: "Summary" });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/daily"))).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Spend over time" }),
      ).toBeNull(),
    );
    expect(
      await screen.findByRole("region", { name: "Members" }),
    ).toBeVisible();
  });

  // T-LP14 (Design System - LiteLLM team page, name and spend over time): the
  // breadcrumb's last item is the alias the page resolved on the server, else
  // the id; one line, truncated, the full value in `title`; never HTML.
  const crumb = (text: string) =>
    within(screen.getByRole("navigation", { name: /breadcrumb/i })).getByText(
      text,
    );

  it("T-LP14: with an alias the breadcrumb's last item is the alias, not the id", async () => {
    stubProxyTeam();
    render(true, "Payments alias");
    expect(crumb("Payments alias")).toHaveAttribute("aria-current", "page");
    expect(
      within(
        screen.getByRole("navigation", { name: /breadcrumb/i }),
      ).queryByText(PROXY_TEAM_ID),
    ).toBeNull();
    await screen.findByRole("region", { name: "Summary" });
  });

  it("T-LP14: without a name (no call, or the call failed) the last item is the id", async () => {
    stubProxyTeam();
    render(true, null);
    expect(crumb(PROXY_TEAM_ID)).toHaveAttribute("aria-current", "page");
    await screen.findByRole("region", { name: "Summary" });
  });

  it("T-LP14: a long alias keeps its full value in `title`, and an alias is text, never HTML", async () => {
    stubProxyTeam();
    const long = `${"very-long-alias-".repeat(10)}<b>x</b>`;
    const { container } = render(true, long);
    const last = crumb(long);
    expect(last).toHaveAttribute("title", long);
    expect(last).toHaveClass("truncate");
    expect(
      container.querySelectorAll(`[title="${CSS.escape(long)}"]`),
    ).toHaveLength(1);
    expect(container.querySelector("nav b")).toBeNull();
    await screen.findByRole("region", { name: "Summary" });
  });
});
