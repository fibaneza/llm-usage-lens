import type { TeamDetailResponse } from "@llm-usage-lens/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  apiResponse,
  NEVER,
  stubApi,
  teamDetailBody,
  teamDetailFixture,
} from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamDetailContent } from "./TeamDetailContent";

// Source: implementation-phases Phase 4.6 (four sections: header with one
// AccountIdBadge per accounts[] entry + "Bedrock service charges only" scope
// note, services table, users table with UserAvatar, model usage bar chart;
// reuse UsageTable); Design System -- Team Detail Page, Responsive Tables;
// Data Model -- `TeamDetailResponseSchema`, Dashboard impact (v1); Rules 20.3
// (per-user / per-service cost is estimated), 20.10 (`_untagged`), 20.9/20.12,
// 40.4 and 60.12 (section boundaries), 60.24. Contract:
// `<TeamDetailContent id="team-a" />`, a client component reading the URL
// range and fetching `/api/teams/<id>` via `useTeam`. The header shows the team
// name as a heading; MetricCard groups "Total cost" and "Tokens". Sections are
// `<section>` regions named "Services breakdown", "Users breakdown" and
// "Model usage". `_untagged` renders as "Untagged" (no earlier page displays
// it, so this pins the label). No previous-period request is required.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const URL_PARAMS = { searchParams: RANGE };
const SKELETON = '[data-slot="skeleton"]';

const attribution = (
  cost: number,
  inputTokens: number,
  outputTokens: number,
  invocations: number,
) => ({
  cost,
  costEstimated: true as const,
  inputTokens,
  outputTokens,
  invocations,
});

const CURRENT: TeamDetailResponse = teamDetailFixture({
  accounts: [
    {
      accountId: "123456789012",
      cost: 500,
      modelCost: 450,
      nonModelCost: 50,
      inputTokens: 800_000,
      outputTokens: 400_000,
      invocations: 1_000,
    },
    {
      accountId: "111122223333",
      cost: 100,
      modelCost: 100,
      nonModelCost: 0,
      inputTokens: 200_000,
      outputTokens: 100_000,
      invocations: 200,
    },
  ],
  byModel: [
    {
      model: "claude-opus",
      cost: 400,
      inputTokens: 600_000,
      outputTokens: 300_000,
      invocations: 700,
    },
    {
      model: "claude-haiku",
      cost: 150,
      inputTokens: 400_000,
      outputTokens: 200_000,
      invocations: 500,
    },
  ],
  services: [
    { serviceName: "chat-api", ...attribution(300, 500_000, 250_000, 600) },
    { serviceName: "_untagged", ...attribution(50, 100_000, 50_000, 100) },
    { serviceName: "search", ...attribution(200, 400_000, 200_000, 500) },
  ],
  users: [
    { userId: "alice.smith", ...attribution(120, 100_000, 50_000, 100) },
    { userId: "bob", ...attribution(80, 60_000, 20_000, 60) },
  ],
});

const EMPTY = teamDetailFixture({
  cost: 0,
  modelCost: 0,
  nonModelCost: 0,
  inputTokens: 0,
  outputTokens: 0,
  invocations: 0,
  serviceCount: 0,
  userCount: 0,
});

function detailFor(detail: TeamDetailResponse = CURRENT) {
  return () => apiResponse(teamDetailBody(detail));
}

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

async function loaded() {
  await screen.findByRole("heading", { name: "Platform" });
}

function rowTexts(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.textContent ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamDetailContent -- requests", () => {
  it("fetches this team for the URL range", async () => {
    const stub = stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const requests = stub.teamDetailRequests();
    expect(requests.every((u) => u.pathname === "/api/teams/team-a")).toBe(
      true,
    );
    expect(
      requests.map((u) => Object.fromEntries(u.searchParams)),
    ).toContainEqual(RANGE);
  });

  it("URL-encodes the team id in the request path", async () => {
    const stub = stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team/a & b" />, URL_PARAMS);

    await waitFor(() =>
      expect(stub.teamDetailRequests().length).toBeGreaterThan(0),
    );
    expect(stub.teamDetailRequests()[0]?.pathname).toBe(
      `/api/teams/${encodeURIComponent("team/a & b")}`,
    );
  });
});

describe("TeamDetailContent -- header", () => {
  it("shows the team name, its department, total cost and tokens (input + output)", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Total cost" })).toHaveTextContent(
      "$600.00",
    );
    expect(screen.getByRole("group", { name: "Tokens" })).toHaveTextContent(
      /1,500,000|1\.5M/,
    );
  });

  it("shows the Bedrock-service-charges-only scope note", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(
      screen.getByText(/bedrock service charges only/i),
    ).toBeInTheDocument();
  });

  it("renders one formatted AccountIdBadge per accounts[] entry", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(screen.getByText("123-456-789-012")).toBeInTheDocument();
    expect(screen.getByText("111-122-223-333")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /copy/i })).toHaveLength(2);
  });

  it("renders no account badge when accounts[] is empty", async () => {
    stubApi({ teamDetail: detailFor(teamDetailFixture({ accounts: [] })) });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(
      screen.queryByRole("button", { name: /copy/i }),
    ).not.toBeInTheDocument();
  });
});

// Design System -- Team Detail Page and Layout, Page frame (2026-11-16):
// PageHeader with a breadcrumb "Teams / <name>", the team name as h2, and one
// meta line holding the department, the account IDs and the scope note.
describe("TeamDetailContent -- page header", () => {
  it("leads with a breadcrumb 'Teams / <name>' whose first crumb links to the list with the date range carried (TMD-02)", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    const link = within(crumbs).getByRole("link", { name: "Teams" });
    const href = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(href.pathname).toBe("/dashboard/teams");
    expect(href.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(href.searchParams.get("dateTo")).toBe(RANGE.dateTo);
    expect(within(crumbs).getByText("Platform")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("names the team with an h2 entity title; the page h1 stays in the top bar (TMD-02)", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(
      screen.getByRole("heading", { level: 2, name: "Platform" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("keeps the department, the account IDs and the scope note on one meta line beside the title (Team Detail Page)", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const titleRow = screen.getByRole("heading", { level: 2, name: "Platform" })
      .parentElement as HTMLElement;
    expect(within(titleRow).getByText("Engineering")).toBeInTheDocument();
    expect(within(titleRow).getByText("123-456-789-012")).toBeInTheDocument();
    expect(within(titleRow).getByText("111-122-223-333")).toBeInTheDocument();
    expect(
      within(titleRow).getByText(/bedrock service charges only/i),
    ).toBeInTheDocument();
  });

  // Design System -- Team Detail Page; 4R.5 "no dead links": a team-scoped
  // caller gets 404 on the department route, so the name is never a link.
  it("renders the department name as plain text, not a link", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Engineering" }),
    ).not.toBeInTheDocument();
  });
});

// Design System -- Layout, Panels and density: every section is a Panel -- a
// card-surface region named by its heading (TMD-04..06).
describe("TeamDetailContent -- sections are Panels", () => {
  it.each(["Services breakdown", "Users breakdown", "Model usage"])(
    "renders %s as a Panel region with a card-title heading",
    async (name) => {
      stubApi({ teamDetail: detailFor() });
      renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
      await loaded();

      const region = section(name);
      expect(region).toHaveAttribute("data-slot", "card");
      expect(
        within(region).getByRole("heading", { name, level: 2 }),
      ).toHaveAttribute("data-slot", "card-title");
    },
  );
});

describe("TeamDetailContent -- services table", () => {
  it("lists one row per service, sorted by cost descending", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const table = within(section("Services breakdown")).getByRole("table");
    const rows = rowTexts(table);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("chat-api");
    expect(rows[0]).toContain("$300.00");
    expect(rows[1]).toContain("search");
    expect(
      within(table).getByRole("columnheader", { name: /^Cost/ }),
    ).toHaveAttribute("aria-sort", "descending");
  });

  it("re-sorts when the Cost header is clicked", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();
    const table = within(section("Services breakdown")).getByRole("table");

    await userEvent
      .setup()
      .click(
        within(
          within(table).getByRole("columnheader", { name: /^Cost/ }),
        ).getByRole("button"),
      );

    expect(rowTexts(table)[0]).toContain("Untagged");
  });

  it("shows _untagged as a readable 'Untagged' label, never the raw key", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const region = section("Services breakdown");
    expect(within(region).getByText("Untagged")).toBeInTheDocument();
    expect(region).not.toHaveTextContent("_untagged");
  });

  it("marks service cost as estimated (Rule 20.3)", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(
      within(section("Services breakdown")).getAllByText(/^Estimated$/i).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("shows an empty message and no table when there are no services", async () => {
    stubApi({
      teamDetail: detailFor(teamDetailFixture({ services: [], users: [] })),
    });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const region = section("Services breakdown");
    expect(within(region).queryByRole("table")).not.toBeInTheDocument();
    expect(within(region).getByText(/no services/i)).toBeInTheDocument();
  });
});

describe("TeamDetailContent -- users table", () => {
  it("lists one row per user with a neutral UserAvatar next to the name (Avatar Colors, amended 2026-11-16)", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const table = within(section("Users breakdown")).getByRole("table");
    const rows = rowTexts(table);
    const userRows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("alice.smith");
    expect(rows[0]).toContain("$120.00");
    expect(rows[1]).toContain("bob");
    // Neutral 20px avatar, no per-user colour (Design System -- Avatar Colors,
    // amended 2026-11-16): decorative initials beside the id.
    const alice = within(userRows[0] as HTMLElement).getByText("AS");
    const bob = within(userRows[1] as HTMLElement).getByText("B");
    for (const avatar of [alice, bob]) {
      expect(avatar).toHaveAttribute("aria-hidden", "true");
      expect(avatar.getAttribute("style") ?? "").not.toContain(
        "--color-avatar-",
      );
    }
  });

  it("marks every user's cost as estimated (Rule 20.3)", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(
      within(section("Users breakdown")).getAllByText(/^Estimated$/i).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("shows an empty message when there are no users", async () => {
    stubApi({ teamDetail: detailFor(teamDetailFixture({ users: [] })) });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const region = section("Users breakdown");
    expect(within(region).queryByRole("table")).not.toBeInTheDocument();
    expect(within(region).getByText(/no users/i)).toBeInTheDocument();
  });
});

describe("TeamDetailContent -- model usage chart", () => {
  it("renders the model usage bar chart", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    expect(
      await within(section("Model usage")).findByRole("img", {
        name: /model usage.*bar chart/i,
      }),
    ).toBeInTheDocument();
  });

  it("shows a model legend with each costed model's name and colour dot", async () => {
    stubApi({ teamDetail: detailFor() });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const region = section("Model usage");
    const legend = await within(region).findByRole("list", {
      name: /model legend/i,
    });
    const items = within(legend).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(legend).toHaveTextContent("Claude Opus");
    expect(legend).toHaveTextContent("Claude Haiku");
    expect(
      legend.querySelector('[style*="var(--color-model-opus)"]'),
    ).not.toBeNull();
    expect(
      legend.querySelector('[style*="var(--color-model-haiku)"]'),
    ).not.toBeNull();
  });

  it("omits the model legend when there is no model usage", async () => {
    stubApi({ teamDetail: detailFor(teamDetailFixture({ byModel: [] })) });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const region = section("Model usage");
    await within(region).findByText(/no data yet/i);
    expect(
      within(region).queryByRole("list", { name: /model legend/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the chart empty state, not an error, when there is no model usage", async () => {
    stubApi({ teamDetail: detailFor(teamDetailFixture({ byModel: [] })) });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);
    await loaded();

    const region = section("Model usage");
    expect(await within(region).findByText(/no data yet/i)).toBeInTheDocument();
    expect(within(region).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TeamDetailContent -- loading, empty, not found and errors", () => {
  it("shows skeletons and no alert while loading", () => {
    stubApi({ teamDetail: NEVER });
    const view = renderWithProviders(
      <TeamDetailContent id="team-a" />,
      URL_PARAMS,
    );

    expect(view.container.querySelectorAll(SKELETON).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows one empty state, and no tables or alert, when the team has no rollups in range", async () => {
    stubApi({ teamDetail: detailFor(EMPTY) });
    const view = renderWithProviders(
      <TeamDetailContent id="team-a" />,
      URL_PARAMS,
    );

    expect(await screen.findByText(/no usage/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.container.querySelectorAll(SKELETON)).toHaveLength(0);
  });

  it("shows a not-found message, without Retry, for an unknown team (404)", async () => {
    stubApi({
      teamDetail: () => apiError(404, "NOT_FOUND", "Team x not found"),
    });
    renderWithProviders(<TeamDetailContent id="x" />, URL_PARAMS);

    expect(await screen.findByText(/team not found/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an alert with Retry when the request fails, and recovers on Retry", async () => {
    let failing = true;
    const ok = detailFor();
    stubApi({ teamDetail: () => (failing ? apiError(500) : ok()) });
    renderWithProviders(<TeamDetailContent id="team-a" />, URL_PARAMS);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts[0]).toHaveTextContent(/couldn.t load/i);

    failing = false;
    await userEvent.setup().click(
      within(alerts[0] as HTMLElement).getByRole("button", {
        name: /retry/i,
      }),
    );

    await loaded();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
