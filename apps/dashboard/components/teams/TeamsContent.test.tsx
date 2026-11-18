import type { TeamRow } from "@llm-usage-lens/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  apiResponse,
  departmentRowFixture,
  departmentsBody,
  stubApi,
  teamRowFixture,
  teamsBody,
} from "@/test/fakes/api-stubs";
import { orgShow } from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamsContent } from "./TeamsContent";

// Source: implementation-phases Phase 4.5 (tasks: UsageTable, department filter
// dropdown reusing the ModelFilter pattern, columns Team Name / Department /
// Cost / Tokens / Invocations / Services / Users, team name links to
// /dashboard/teams/<id>, EmptyState; "Tests: department filter works; table
// sorting and pagination"; Verify: "all teams appear, filter narrows
// results"); Data Model -- Zod Validation Schemas (`serviceCount`,
// `userCount`); Rules 40.4, 60.12, 60.21, 60.24. Module under test:
// `components/teams/TeamsContent.tsx`, a client component with no props that
// reads the date range and `department` (a departmentId, absent = all) from the
// URL via nuqs and fetches /api/teams (+ /api/departments for filter options).
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const URL_PARAMS = { searchParams: RANGE };

const row = teamRowFixture;

const DEPARTMENTS = [
  departmentRowFixture({
    departmentId: "dept-eng",
    departmentName: "Engineering",
  }),
  departmentRowFixture({ departmentId: "dept-fin", departmentName: "Finance" }),
];

const TEAMS: TeamRow[] = [
  row({
    teamId: "team-pay",
    teamName: "Payments",
    cost: 600,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
    serviceCount: 4,
    userCount: 7,
  }),
  row({
    teamId: "team-ledger",
    teamName: "Ledger",
    departmentId: "dept-fin",
    departmentName: "Finance",
    cost: 300,
    invocations: 50,
    serviceCount: 0,
    userCount: 0,
  }),
  row({ teamId: "team a/b", teamName: "Odd Id", cost: 10 }),
];

function teamsFor(all: TeamRow[] = TEAMS) {
  return (url: URL) => {
    const dep = url.searchParams.get("departmentId");
    return apiResponse(
      teamsBody(dep ? all.filter((t) => t.departmentId === dep) : all),
    );
  };
}

const departments = () => apiResponse(departmentsBody(DEPARTMENTS));

function dataRows(table: HTMLElement): HTMLElement[] {
  return within(table)
    .getAllByRole("row")
    .filter((r) => within(r).queryAllByRole("cell").length > 0);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TeamsContent -- table", () => {
  it("renders the seven columns and one row per team with counts", async () => {
    stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const table = await screen.findByRole("table");

    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim() ?? "");
    for (const name of [
      /^Team Name/,
      /^Department/,
      /^Cost/,
      /^Tokens/,
      /^Invocations/,
      /^Services/,
      /^Users/,
    ]) {
      expect(headers.some((h) => name.test(h))).toBe(true);
    }
    const rows = dataRows(table);
    expect(rows).toHaveLength(3);
    const payments = rows.find((r) => r.textContent?.includes("Payments"));
    expect(payments).toHaveTextContent("Engineering");
    const tokens = within(payments as HTMLElement).getByText("1.5M");
    expect(tokens).toHaveAttribute("title", "1,500,000");
    const invocations = within(payments as HTMLElement).getByText("1.2K");
    expect(invocations).toHaveAttribute("title", "1,200");
    const cells = within(payments as HTMLElement)
      .getAllByRole("cell")
      .map((c) => c.textContent?.trim());
    expect(cells).toContain("4");
    expect(cells).toContain("7");
  });

  it("shows 0 (a real count) for a team without attributed usage", async () => {
    stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    const ledger = dataRows(table).find((r) =>
      r.textContent?.includes("Ledger"),
    );
    const cells = within(ledger as HTMLElement)
      .getAllByRole("cell")
      .map((c) => c.textContent?.trim());
    expect(cells.filter((c) => c === "0").length).toBeGreaterThanOrEqual(2);
  });

  it("links each team name to its detail page, carrying the date range", async () => {
    stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    await screen.findByRole("table");

    const href = screen
      .getByRole("link", { name: "Payments" })
      .getAttribute("href");
    expect(href).toContain("/dashboard/teams/team-pay");
    expect(href).toContain("dateFrom=2026-01-11");
    expect(href).toContain("dateTo=2026-01-20");
    expect(
      screen.getByRole("link", { name: "Odd Id" }).getAttribute("href"),
    ).toContain("/dashboard/teams/team%20a%2Fb");
  });

  it("sorts by cost descending by default and toggles aria-sort on click", async () => {
    stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    const cost = screen.getByRole("columnheader", { name: /^Cost/ });
    expect(cost).toHaveAttribute("aria-sort", "descending");

    await userEvent.setup().click(within(cost).getByRole("button"));
    expect(cost).toHaveAttribute("aria-sort", "ascending");
    expect(dataRows(table)[0]).toHaveTextContent("Odd Id");
  });

  it("paginates 20 rows per page with more than 20 teams", async () => {
    const many = Array.from({ length: 25 }, (_unused, i) =>
      row({
        teamId: `team-${i}`,
        teamName: `Team ${String(i).padStart(2, "0")}`,
        cost: 1000 - i,
      }),
    );
    stubApi({ teams: teamsFor(many), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    expect(dataRows(table)).toHaveLength(20);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(dataRows(table)).toHaveLength(5));
  });
});

describe("TeamsContent -- department filter", () => {
  it("offers All departments plus each department, defaulting to all with no departmentId sent", async () => {
    const stub = stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    await screen.findByRole("table");

    const filter = screen.getByRole("combobox", { name: "Department" });
    expect(filter).toHaveTextContent("All departments");
    for (const req of stub.teamsRequests()) {
      expect(req.searchParams.has("departmentId")).toBe(false);
    }
    await userEvent.setup().click(filter);
    expect(
      await screen.findByRole("option", { name: "Engineering" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument();
  });

  it("requests /api/teams with departmentId and narrows the rows", async () => {
    const stub = stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    await screen.findByRole("table");
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Department" }));
    await user.click(await screen.findByRole("option", { name: "Finance" }));

    await waitFor(() => {
      expect(
        stub
          .teamsRequests()
          .some(
            (u) =>
              u.searchParams.get("departmentId") === "dept-fin" &&
              u.searchParams.get("dateFrom") === RANGE.dateFrom &&
              u.searchParams.get("dateTo") === RANGE.dateTo,
          ),
      ).toBe(true);
    });
    await waitFor(() => {
      const rows = dataRows(screen.getByRole("table"));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("Ledger");
    });
  });

  it("restores the filter from the URL (department=<departmentId>)", async () => {
    const stub = stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, {
      searchParams: { ...RANGE, department: "dept-fin" },
    });
    await screen.findByRole("table");

    expect(
      screen.getByRole("combobox", { name: "Department" }),
    ).toHaveTextContent("Finance");
    // M5-D1: the Bedrock figure asks for the organisation-wide total, so one
    // request carries no departmentId; the table's request carries the filter.
    expect(
      stub
        .teamsRequests()
        .some((u) => u.searchParams.get("departmentId") === "dept-fin"),
    ).toBe(true);
  });
});

// Design System -- Layout, Page frame ("Toolbars are one row: search, filters,
// then view controls (Columns) and Export on the right"); design plan 2.4 and
// D-19 (search + Columns + Export on every list page); SH-70, SH-73.
describe("TeamsContent -- toolbar", () => {
  it("puts the Department filter in the same toolbar row as search, Columns and Export CSV", async () => {
    stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    await screen.findByRole("table");

    const toolbar = screen
      .getByRole("combobox", { name: "Department" })
      .closest('[data-slot="table-toolbar"]') as HTMLElement | null;
    expect(toolbar).not.toBeNull();
    const row = within(toolbar as HTMLElement);
    expect(row.getByRole("searchbox")).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });

  it("filters the rows by team name from the search box (D-19)", async () => {
    stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const table = await screen.findByRole("table");

    await userEvent.setup().type(screen.getByRole("searchbox"), "Ledger");

    await waitFor(() => expect(dataRows(table)).toHaveLength(1));
    expect(dataRows(table)[0]).toHaveTextContent("Ledger");
  });
});

describe("TeamsContent -- states", () => {
  it("shows a no-teams EmptyState when the API returns none", async () => {
    stubApi({ teams: () => apiResponse(teamsBody([])), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);

    expect(await screen.findByText(/no teams/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a distinct no-results EmptyState when a department filter yields none", async () => {
    stubApi({
      teams: (url) =>
        apiResponse(
          teamsBody(url.searchParams.get("departmentId") ? [] : TEAMS),
        ),
      departments,
    });
    renderWithProviders(<TeamsContent />, {
      searchParams: { ...RANGE, department: "dept-fin" },
    });

    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
    expect(screen.queryByText(/no teams/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Department" }),
    ).toBeInTheDocument();
  });

  it("shows a handled state (disabled filter + message) when /api/departments fails, rows still render", async () => {
    stubApi({ teams: teamsFor(), departments: () => apiError(500) });
    renderWithProviders(<TeamsContent />, URL_PARAMS);

    const table = await screen.findByRole("table");
    expect(dataRows(table)).toHaveLength(3);
    expect(
      await screen.findByText(/departments unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Department" })).toBeDisabled();
  });

  it("shows an error with Retry, and Retry refetches", async () => {
    let fail = true;
    const stub = stubApi({
      teams: () => (fail ? apiError(500) : apiResponse(teamsBody(TEAMS))),
      departments,
    });
    renderWithProviders(<TeamsContent />, URL_PARAMS);

    const retry = await within(
      await screen.findByRole("region", { name: "Bedrock" }),
    ).findByRole("button", { name: /retry/i });
    const before = stub.teamsRequests().length;
    fail = false;
    await userEvent.setup().click(retry);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(stub.teamsRequests().length).toBeGreaterThan(before);
  });

  it("shows a loading skeleton while the request is pending", () => {
    stubApi({
      teams: () => new Promise<Response>(() => {}) as never,
      departments,
    });
    const { container } = renderWithProviders(<TeamsContent />, URL_PARAMS);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});

// Source: Design System - "Source panels on Cost by team, Cost by user and
// Cost by service" (D17: a Bedrock panel "AWS-billed" and a LiteLLM panel
// "LiteLLM-reported", each in its own boundary, no table, column or CSV mixing
// the two; a LiteLLM outage leaves the Bedrock panel working; D18: three
// figures; created teams show "No AWS account" in the Bedrock panel);
// M5-D1 (the Bedrock figure is the page's own organisation-wide total, the
// department filter narrows the table only), M5-D2 (L6's "Combined with
// LiteLLM" panel leaves this page); implementation-phases M5 Verify; App Teams
// AT6 (no member read on first load).
describe("TeamsContent -- source panels (M5)", () => {
  const DOWN = () => apiError(503, "LITELLM_UNAVAILABLE", "down");

  it("D17: a Bedrock region labelled AWS-billed holds the table, a LiteLLM region labelled LiteLLM-reported holds no Bedrock table", async () => {
    stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const bedrock = await screen.findByRole("region", { name: "Bedrock" });
    const litellm = await screen.findByRole("region", { name: "LiteLLM" });

    expect(within(bedrock).getByText("AWS-billed")).toBeVisible();
    expect(within(bedrock).getByRole("table")).toBeVisible();
    expect(within(bedrock).queryByText("LiteLLM-reported")).toBeNull();
    expect(within(litellm).getByText("LiteLLM-reported")).toBeVisible();
    expect(within(litellm).queryByText("AWS-billed")).toBeNull();
    expect(within(litellm).queryByText("Payments")).toBeNull();
  });

  it("D17: the Bedrock table holds no LiteLLM or Combined column", async () => {
    stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const table = await within(
      await screen.findByRole("region", { name: "Bedrock" }),
    ).findByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    expect(headers.some((h) => /LiteLLM|Combined|Via/.test(h))).toBe(false);
  });

  it("M5-D2: L6's Combined with LiteLLM panel is gone and its teams route is not read", async () => {
    const stub = stubApi({ teams: teamsFor(), departments });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    await screen.findByRole("region", { name: "LiteLLM" });
    expect(
      screen.queryByRole("region", { name: "Combined with LiteLLM" }),
    ).toBeNull();
    expect(
      stub
        .combinedRequests()
        .some((u) => u.pathname === "/api/litellm/combined/teams"),
    ).toBe(false);
  });

  it("M5-D1: the Bedrock figure is the page's total ($910.00); the department filter narrows the table, not the figure", async () => {
    const stub = stubApi({
      teams: teamsFor(),
      departments,
      combinedOrganisation: () => apiResponse({ data: orgShow() }),
    });
    renderWithProviders(<TeamsContent />, {
      searchParams: { ...RANGE, department: "dept-fin" },
    });
    const figure = await screen.findByTestId("source-figure-bedrock");
    await waitFor(() => expect(figure).toHaveTextContent("$910.00"));
    expect(figure).toHaveTextContent("AWS-billed");
    expect(
      stub.teamsRequests().some((u) => !u.searchParams.has("departmentId")),
    ).toBe(true);
    const table = within(
      screen.getByRole("region", { name: "Bedrock" }),
    ).getByRole("table");
    expect(dataRows(table)).toHaveLength(1);
  });

  it("D18 + LT-MI4: the three figures show the server's combined, not Bedrock plus LiteLLM", async () => {
    stubApi({
      teams: teamsFor(),
      departments,
      combinedOrganisation: () => apiResponse({ data: orgShow() }),
    });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    expect(
      await screen.findByTestId("source-figure-litellm"),
    ).toHaveTextContent("$6.20");
    expect(
      within(screen.getByTestId("source-figure-combined")).getByTestId(
        "combined-total",
      ),
    ).toHaveTextContent("$16.20");
    await waitFor(() =>
      expect(screen.getByTestId("source-figure-bedrock")).toHaveTextContent(
        "$910.00",
      ),
    );
    expect(screen.queryByText("$926.20")).toBeNull();
  });

  it("D17 outage: every LiteLLM read at 503 leaves the Bedrock figure and table working", async () => {
    stubApi({
      teams: teamsFor(),
      departments,
      combinedOrganisation: DOWN,
      litellmOrg: DOWN,
    });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const table = await within(
      await screen.findByRole("region", { name: "Bedrock" }),
    ).findByRole("table");
    expect(dataRows(table)).toHaveLength(3);
    await waitFor(() =>
      expect(screen.getByTestId("source-figure-bedrock")).toHaveTextContent(
        "$910.00",
      ),
    );
    expect(
      await screen.findByText("Couldn't load the LiteLLM and combined totals."),
    ).toBeVisible();
  });

  it("D17 outage the other way: a failing Bedrock read leaves the LiteLLM panel working", async () => {
    stubApi({
      teams: () => apiError(500),
      departments,
      litellmOrg: () =>
        apiResponse({
          data: {
            configured: true,
            totals: { spend: 42.5 },
            daily: [],
            litellmTeams: [],
            appTeams: [],
            enabledOperations: [],
          },
        }),
    });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const litellm = await screen.findByRole("region", { name: "LiteLLM" });
    expect(await within(litellm).findByText("$42.50")).toBeVisible();
  });

  it("M5-D3: a created team is a 'No AWS account' row under the Bedrock table, never $0 and never in the table", async () => {
    stubApi({
      teams: teamsFor(),
      departments,
      orgUnits: () =>
        apiResponse({
          data: {
            teams: [
              {
                id: "team-new",
                name: "Fresh Crew",
                departmentId: "dept-eng",
                hasAwsAccount: false,
              },
            ],
            departments: [{ id: "dept-eng", name: "Engineering" }],
          },
        }),
    });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const bedrock = await screen.findByRole("region", { name: "Bedrock" });
    const created = await within(bedrock).findByRole("table", {
      name: "Teams without an AWS account",
    });
    expect(
      within(created).getByRole("row", { name: /Fresh Crew/ }),
    ).toHaveTextContent("No AWS account");
    expect(created).not.toHaveTextContent("$0");
    const main = within(bedrock)
      .getAllByRole("table")
      .find((t) => t !== created) as HTMLElement;
    expect(dataRows(main)).toHaveLength(3);
    expect(within(main).queryByText("Fresh Crew")).toBeNull();
  });

  it("AT6 + MI-D7: no member read on first load; Sum of members is requested on a press only", async () => {
    const stub = stubApi({
      teams: teamsFor(),
      departments,
      litellmOrg: () =>
        apiResponse({
          data: {
            configured: true,
            totals: { spend: 12.5 },
            daily: [],
            litellmTeams: [],
            appTeams: [
              {
                teamId: "team-pay",
                teamName: "Payments",
                spendSource: "litellm-team",
                spend: 12.5,
              },
            ],
            enabledOperations: [],
          },
        }),
      litellmTeam: () =>
        apiResponse({
          data: {
            connected: false,
            spendSource: "member-sum",
            daily: [],
            memberSum: {
              total: 9,
              daily: [],
              coverage: { members: 1, matched: 1, unmatched: 0, pending: 0 },
              members: [{ oid: "o1", name: "Ada", matched: true, spend: 9 }],
            },
          },
        }),
    });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const litellm = await screen.findByRole("region", { name: "LiteLLM" });
    const button = await within(litellm).findByRole("button", {
      name: "Sum of members for Payments",
    });
    expect(stub.litellmTeamRequests()).toHaveLength(0);

    await userEvent.setup().click(button);
    await waitFor(() => expect(stub.litellmTeamRequests()).toHaveLength(1));
    expect(
      (stub.litellmTeamRequests()[0] as URL).searchParams.get("include"),
    ).toBe("memberSum");
    expect(
      await within(litellm).findByText(/Sum of members for Payments:/),
    ).toBeInTheDocument();
  });

  // Review m5-r1 Q-B1: team cost is exact (Rule 20.3), so no estimate mark.
  it("Q-B1 + Rule 20.3: the Bedrock figure on Cost by team carries no Estimated mark", async () => {
    stubApi({
      teams: teamsFor(),
      departments,
      combinedOrganisation: () => apiResponse({ data: orgShow() }),
    });
    renderWithProviders(<TeamsContent />, URL_PARAMS);
    const figure = await screen.findByTestId("source-figure-bedrock");
    await waitFor(() => expect(figure).toHaveTextContent("$910.00"));
    expect(figure).not.toHaveTextContent(/est/i);
  });
});
