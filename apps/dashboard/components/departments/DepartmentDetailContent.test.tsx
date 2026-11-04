import type { DepartmentDetailResponse } from "@bedrock-usage/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { previousRange } from "@/lib/date-range";
import {
  apiError,
  apiResponse,
  departmentDetailBody,
  departmentDetailFixture,
  NEVER,
  stubApi,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { DepartmentDetailContent } from "./DepartmentDetailContent";

// Source: implementation-phases Phase 4.4 (four sections: header with
// DeltaBadge, sortable teams table via UsageTable, cost over time stacked by
// team via CostTrendChart groupBy "team", top users ranked list; "Tests:
// header stats calculation"; PeriodComparison "vs previous N days"); Data
// Model -- Zod Validation Schemas (`DepartmentDetailResponseSchema`); Rules
// 20.3 (per-user cost is estimated), 20.9/20.12 (no previous -> no badge,
// never 0), 40.4 and 60.12 (each section in its own Suspense + boundary),
// 60.24. Contract: `<DepartmentDetailContent id="dept-eng" />`, a client
// component; it reads the URL range, fetches `/api/departments/<id>` for the
// range and for `previousRange(range)` via `useDepartment`. Sections are
// `<section>` regions named "Teams breakdown", "Cost by team over time" and
// "Top users"; the header shows the department name as a heading and
// MetricCard groups "Total cost", "Tokens" and "Invocations".
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PREVIOUS = previousRange(RANGE);
const URL_PARAMS = { searchParams: RANGE };
const SKELETON = '[data-slot="skeleton"]';

const CURRENT: DepartmentDetailResponse = departmentDetailFixture({
  teamCount: 2,
  teams: [
    {
      teamId: "team-a",
      teamName: "Platform",
      departmentId: "dept-eng",
      departmentName: "Engineering",
      cost: 200,
      modelCost: 200,
      nonModelCost: 0,
      inputTokens: 300_000,
      outputTokens: 100_000,
      invocations: 400,
    },
    {
      teamId: "team-b",
      teamName: "Research",
      departmentId: "dept-eng",
      departmentName: "Engineering",
      cost: 400,
      modelCost: 350,
      nonModelCost: 50,
      inputTokens: 700_000,
      outputTokens: 400_000,
      invocations: 800,
    },
  ],
  teamTrend: [
    {
      date: "2026-01-19",
      teams: [
        { teamId: "team-a", cost: 90 },
        { teamId: "team-b", cost: 210 },
      ],
    },
    {
      date: "2026-01-20",
      teams: [
        { teamId: "team-a", cost: 110 },
        { teamId: "team-b", cost: 190 },
      ],
    },
  ],
  topUsers: [
    {
      userId: "alice",
      cost: 120,
      costEstimated: true,
      inputTokens: 100_000,
      outputTokens: 50_000,
      invocations: 100,
    },
    {
      userId: "bob",
      cost: 80,
      costEstimated: true,
      inputTokens: 60_000,
      outputTokens: 20_000,
      invocations: 60,
    },
  ],
});

const PREVIOUS_DETAIL = departmentDetailFixture({
  cost: 500,
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  invocations: 1_000,
});

const EMPTY = departmentDetailFixture({
  cost: 0,
  modelCost: 0,
  nonModelCost: 0,
  inputTokens: 0,
  outputTokens: 0,
  invocations: 0,
  teamCount: 0,
  topModel: null,
});

function detailFor(
  current: DepartmentDetailResponse = CURRENT,
  previous: DepartmentDetailResponse = PREVIOUS_DETAIL,
): (url: URL) => Response {
  return (url) =>
    apiResponse(
      departmentDetailBody(
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? previous
          : current,
      ),
    );
}

function params(urls: URL[]): Array<Record<string, string>> {
  return urls.map((u) => Object.fromEntries(u.searchParams));
}

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

async function loaded() {
  await screen.findByRole("heading", { name: "Engineering" });
}

function rowNames(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.textContent ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DepartmentDetailContent -- requests", () => {
  it("fetches this department for the URL range and the period just before it", async () => {
    const stub = stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    await waitFor(() => {
      const r = params(stub.departmentDetailRequests());
      expect(r).toContainEqual(RANGE);
      expect(r).toContainEqual(PREVIOUS);
    });
    expect(
      stub
        .departmentDetailRequests()
        .every((u) => u.pathname === "/api/departments/dept-eng"),
    ).toBe(true);
  });

  it("URL-encodes the department id in the request path", async () => {
    const stub = stubApi({ departmentDetail: detailFor() });
    renderWithProviders(
      <DepartmentDetailContent id="dept/ops & co" />,
      URL_PARAMS,
    );

    await waitFor(() =>
      expect(stub.departmentDetailRequests().length).toBeGreaterThan(0),
    );
    expect(stub.departmentDetailRequests()[0]?.pathname).toBe(
      `/api/departments/${encodeURIComponent("dept/ops & co")}`,
    );
  });
});

describe("DepartmentDetailContent -- header", () => {
  it("shows the department name, total cost, tokens (input + output) and invocations", async () => {
    stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    expect(screen.getByRole("group", { name: "Total cost" })).toHaveTextContent(
      "$600.00",
    );
    expect(screen.getByRole("group", { name: "Tokens" })).toHaveTextContent(
      /1,500,000|1\.5M/,
    );
    expect(
      screen.getByRole("group", { name: "Invocations" }),
    ).toHaveTextContent(/1,200|1\.2K/);
  });

  it("shows a DeltaBadge per stat vs the previous period", async () => {
    stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    // cost 600 vs 500 = +20.0%, tokens 1.5M vs 2M = -25.0%, calls 1200 vs 1000 = +20.0%
    expect(
      await within(
        screen.getByRole("group", { name: "Total cost" }),
      ).findByRole("img", {
        name: "Up 20.0% vs previous period",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Tokens" })).getByRole("img", {
        name: "Down 25.0% vs previous period",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Invocations" })).getByRole(
        "img",
        {
          name: "Up 20.0% vs previous period",
        },
      ),
    ).toBeInTheDocument();
  });

  it("shows the PeriodComparison with the caption from the range length (10 days)", async () => {
    stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    const comparison = await screen.findByRole("group", {
      name: /period comparison/i,
    });
    expect(
      within(comparison).getByText("vs previous 10 days"),
    ).toBeInTheDocument();
    expect(within(comparison).getByText("$500.00")).toBeInTheDocument();
  });

  it("shows no badge when the previous request fails, and keeps the page without an alert", async () => {
    const ok = detailFor();
    stubApi({
      departmentDetail: (url) =>
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? apiError(500)
          : ok(url),
    });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: "Total cost" }),
      ).toHaveTextContent("$600.00"),
    );
    expect(
      screen.queryByRole("img", { name: /vs previous period/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no badge when the previous cost is 0", async () => {
    stubApi({
      departmentDetail: detailFor(
        CURRENT,
        departmentDetailFixture({
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          invocations: 0,
        }),
      ),
    });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    expect(
      screen.queryByRole("img", { name: /vs previous period/ }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe("DepartmentDetailContent -- teams table", () => {
  it("lists one row per team with its figures", async () => {
    stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    const table = within(section("Teams breakdown")).getByRole("table");
    const rows = rowNames(table);
    expect(rows).toHaveLength(2);
    expect(table).toHaveTextContent("Platform");
    expect(table).toHaveTextContent("Research");
    expect(table).toHaveTextContent("$400.00");
    expect(table).toHaveTextContent("$200.00");
  });

  it("starts sorted by cost descending and re-sorts when the Cost header is clicked", async () => {
    stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();
    const table = within(section("Teams breakdown")).getByRole("table");

    expect(rowNames(table)[0]).toContain("Research");
    const cost = within(table).getByRole("columnheader", { name: /^Cost/ });
    expect(cost).toHaveAttribute("aria-sort", "descending");

    await userEvent.setup().click(within(cost).getByRole("button"));

    expect(cost).toHaveAttribute("aria-sort", "ascending");
    expect(rowNames(table)[0]).toContain("Platform");
  });

  it("shows an empty message and no table when the department has no teams", async () => {
    stubApi({
      departmentDetail: detailFor(departmentDetailFixture({ teams: [] })),
    });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    const region = section("Teams breakdown");
    expect(within(region).queryByRole("table")).not.toBeInTheDocument();
    expect(within(region).getByText(/no teams/i)).toBeInTheDocument();
  });
});

describe("DepartmentDetailContent -- cost over time by team", () => {
  it("renders the stacked team trend chart", async () => {
    stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    expect(
      await within(section("Cost by team over time")).findByRole("img", {
        name: "Cost trend by team, stacked area chart",
      }),
    ).toBeInTheDocument();
  });

  it("shows the chart empty state, not an error, when there is no team trend", async () => {
    stubApi({
      departmentDetail: detailFor(departmentDetailFixture({ teamTrend: [] })),
    });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    const region = section("Cost by team over time");
    expect(
      await within(region).findByText(/no (cost|usage|data)/i),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("DepartmentDetailContent -- top users", () => {
  it("lists users ranked in the API order with rank labels", async () => {
    stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    const region = section("Top users");
    const text = region.textContent ?? "";
    expect(text.indexOf("alice")).toBeGreaterThan(-1);
    expect(text.indexOf("alice")).toBeLessThan(text.indexOf("bob"));
    expect(within(region).getByText("Rank 1")).toBeInTheDocument();
    expect(within(region).getByText("Rank 2")).toBeInTheDocument();
    expect(region).toHaveTextContent("$120.00");
  });

  it("marks every user's cost as estimated (Rule 20.3)", async () => {
    stubApi({ departmentDetail: detailFor() });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    expect(
      within(section("Top users")).getAllByText(/^Estimated$/i),
    ).toHaveLength(2);
  });

  it("shows an empty message when there are no users", async () => {
    stubApi({
      departmentDetail: detailFor(departmentDetailFixture({ topUsers: [] })),
    });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);
    await loaded();

    expect(
      within(section("Top users")).getByText(/no users/i),
    ).toBeInTheDocument();
  });
});

describe("DepartmentDetailContent -- loading, empty, not found and errors", () => {
  it("shows skeletons and no alert while loading", () => {
    stubApi({ departmentDetail: NEVER });
    const view = renderWithProviders(
      <DepartmentDetailContent id="dept-eng" />,
      URL_PARAMS,
    );

    expect(view.container.querySelectorAll(SKELETON).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows one empty state, and no tables or alert, when the department has no rollups in range", async () => {
    stubApi({ departmentDetail: detailFor(EMPTY, EMPTY) });
    const view = renderWithProviders(
      <DepartmentDetailContent id="dept-eng" />,
      URL_PARAMS,
    );

    expect(await screen.findByText(/no usage/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.container.querySelectorAll(SKELETON)).toHaveLength(0);
  });

  it("shows a not-found message, without Retry, for an unknown department (404)", async () => {
    stubApi({
      departmentDetail: () =>
        apiError(404, "NOT_FOUND", "Department x not found"),
    });
    renderWithProviders(<DepartmentDetailContent id="x" />, URL_PARAMS);

    expect(
      await screen.findByText(/department not found/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an alert with Retry when the request fails, and recovers on Retry", async () => {
    let failing = true;
    const ok = detailFor();
    stubApi({ departmentDetail: (url) => (failing ? apiError(500) : ok(url)) });
    renderWithProviders(<DepartmentDetailContent id="dept-eng" />, URL_PARAMS);

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
