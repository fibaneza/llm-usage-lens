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
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

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
    expect(
      stub
        .teamsRequests()
        .every((u) => u.searchParams.get("departmentId") === "dept-fin"),
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

    const retry = await screen.findByRole("button", { name: /retry/i });
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
