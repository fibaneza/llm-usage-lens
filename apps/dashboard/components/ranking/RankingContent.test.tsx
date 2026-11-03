import type { RankingRow, RankingTab } from "@bedrock-usage/shared";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inclusiveSpanDays, previousRange } from "@/lib/date-range";
import {
  apiError,
  apiResponse,
  NEVER,
  rankingBody,
  rankingRowFixture,
  stubApi,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { RankingContent } from "./RankingContent";

// Source: implementation-phases Phase 4.2 (tasks and Verify: "all 4 tabs load,
// sorting works, model filter updates results, CSV exports correctly"); Design
// System — Ranking Page and Component Inventory (EmptyState, Skeleton,
// CostEstimateIndicator); Data Model — RankingResponse / RankingQuery; Rules
// 20.3, 20.9, 20.12, 40.4, 60.12, 60.24. The page body is exercised through the
// real hooks, fetchApi and nuqs with a stubbed same-origin fetch.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PREVIOUS = previousRange(RANGE);
const URL_PARAMS = { searchParams: RANGE };

const SKELETON = '[data-slot="skeleton"]';

const row = rankingRowFixture;

// Costs sum to 1000, so % of Total reads 60.0 / 30.0 / 6.0 / 4.0. Invocation
// order (Data Science, Engineering, Legal, Marketing) differs from cost order
// in both directions so a re-sort is visible.
const DEPARTMENTS: RankingRow[] = [
  row({
    id: "dept-eng",
    name: "Engineering",
    cost: 600,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
  }),
  row({
    id: "dept-data",
    name: "Data Science",
    cost: 300,
    inputTokens: 400_000,
    outputTokens: 200_000,
    invocations: 2_500,
  }),
  row({
    id: "dept-mkt",
    name: "Marketing",
    cost: 60,
    inputTokens: 50_000,
    outputTokens: 20_000,
    invocations: 300,
  }),
  row({
    id: "dept-legal",
    name: "Legal",
    cost: 40,
    inputTokens: 30_000,
    outputTokens: 10_000,
    invocations: 800,
  }),
];

// Engineering +20.0%, Data Science -50.0%, Marketing has no previous match,
// Legal's previous cost is 0 (Rule 20.12: both show "—", never 0%).
const PREVIOUS_DEPARTMENTS: RankingRow[] = [
  row({ id: "dept-eng", name: "Engineering", cost: 500 }),
  row({ id: "dept-data", name: "Data Science", cost: 600 }),
  row({ id: "dept-legal", name: "Legal", cost: 0 }),
];

const NAMES = DEPARTMENTS.map((r) => r.name);

type TabData = { current: RankingRow[]; previous: RankingRow[] };

// Serves `current` for the URL's range and `previous` for the period just
// before it, echoing the requested tab like the real route does.
function rankingFor(
  data: Partial<Record<RankingTab, TabData>> = {},
): (url: URL) => Response {
  const byTab: Record<RankingTab, TabData> = {
    departments: { current: DEPARTMENTS, previous: PREVIOUS_DEPARTMENTS },
    teams: { current: [], previous: [] },
    services: { current: [], previous: [] },
    users: { current: [], previous: [] },
    ...data,
  };
  return (url) => {
    const tab = (url.searchParams.get("tab") ?? "departments") as RankingTab;
    const isPrevious = url.searchParams.get("dateFrom") === PREVIOUS.dateFrom;
    const rows = isPrevious ? byTab[tab].previous : byTab[tab].current;
    return apiResponse(rankingBody(tab, rows));
  };
}

function requestParams(urls: URL[]): Array<Record<string, string>> {
  return urls.map((url) => Object.fromEntries(url.searchParams));
}

async function loadedTable(): Promise<HTMLElement> {
  return screen.findByRole("table");
}

function dataRows(table: HTMLElement): HTMLElement[] {
  return within(table)
    .getAllByRole("row")
    .filter((r) => within(r).queryAllByRole("cell").length > 0);
}

function orderedNames(table: HTMLElement, known: string[] = NAMES): string[] {
  return dataRows(table).map(
    (r) => known.find((name) => r.textContent?.includes(name)) ?? "?",
  );
}

function rowFor(table: HTMLElement, name: string): HTMLElement {
  const found = dataRows(table).find((r) => r.textContent?.includes(name));
  if (!found) throw new Error(`no table row for "${name}"`);
  return found;
}

function header(name: RegExp): HTMLElement {
  return screen.getByRole("columnheader", { name });
}

function hasRankLabel(r: HTMLElement, rank: number): boolean {
  return (
    within(r).queryByLabelText(`Rank ${rank}`) !== null ||
    within(r).queryByText(`Rank ${rank}`) !== null
  );
}

// "Estimated" may be visible text, an aria-label or a title (a tooltip trigger).
function estimatedMarkers(root: HTMLElement): Element[] {
  const pattern = /estimated/i;
  return [...root.querySelectorAll("*")].filter(
    (el) =>
      pattern.test(el.getAttribute("aria-label") ?? "") ||
      pattern.test(el.getAttribute("title") ?? "") ||
      (el.children.length === 0 && pattern.test(el.textContent ?? "")),
  );
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("RankingContent — tabs", () => {
  it("renders Departments, Teams, Services and Users tabs with Departments selected by default", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(
      screen.getAllByRole("tab").map((tab) => tab.textContent?.trim()),
    ).toEqual(["Departments", "Teams", "Services", "Users"]);
    expect(screen.getByRole("tab", { name: "Departments" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Teams" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await loadedTable();
  });

  it("requests the current and previous range with tab, limit=100 and no model for 'all'", async () => {
    const stub = stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    await loadedTable();

    await waitFor(() => {
      const requests = requestParams(stub.rankingRequests());
      expect(requests).toContainEqual(
        expect.objectContaining({
          ...RANGE,
          tab: "departments",
          limit: "100",
        }),
      );
      expect(requests).toContainEqual(
        expect.objectContaining({
          ...PREVIOUS,
          tab: "departments",
          limit: "100",
        }),
      );
    });
    for (const request of requestParams(stub.rankingRequests())) {
      expect(request).not.toHaveProperty("model");
    }
  });

  it("falls back to the last 30 days when the URL carries no usable range", async () => {
    const stub = stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />);
    await loadedTable();

    const spans = requestParams(stub.rankingRequests()).map((request) =>
      inclusiveSpanDays({
        dateFrom: request.dateFrom ?? "",
        dateTo: request.dateTo ?? "",
      }),
    );
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(spans.every((span) => span === 30)).toBe(true);
  });

  it("switching tab persists it in the URL and requests that tab", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const stub = stubApi({
      ranking: rankingFor({
        teams: {
          current: [row({ id: "team-platform", name: "Platform", cost: 80 })],
          previous: [],
        },
      }),
    });
    renderWithProviders(<RankingContent />, { ...URL_PARAMS, onUrlUpdate });
    await loadedTable();

    await userEvent.setup().click(screen.getByRole("tab", { name: "Teams" }));

    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBe(
        "teams",
      ),
    );
    expect(screen.getByRole("tab", { name: "Teams" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("Platform")).toBeInTheDocument();
    expect(screen.queryByText("Engineering")).not.toBeInTheDocument();
    const requests = requestParams(stub.rankingRequests());
    expect(requests).toContainEqual(
      expect.objectContaining({ ...RANGE, tab: "teams", limit: "100" }),
    );
    expect(requests).toContainEqual(
      expect.objectContaining({ ...PREVIOUS, tab: "teams", limit: "100" }),
    );
  });

  it("opens on the tab named in the URL", async () => {
    const stub = stubApi({
      ranking: rankingFor({
        users: {
          current: [row({ id: "u1", name: "Alice Nguyen", cost: 10 })],
          previous: [],
        },
      }),
    });
    renderWithProviders(<RankingContent />, {
      searchParams: { ...RANGE, tab: "users" },
    });

    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Users" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      requestParams(stub.rankingRequests()).every((r) => r.tab === "users"),
    ).toBe(true);
  });

  it("treats an unknown tab in the URL as Departments", async () => {
    const stub = stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, {
      searchParams: { ...RANGE, tab: "bogus" },
    });
    await loadedTable();

    expect(screen.getByRole("tab", { name: "Departments" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      requestParams(stub.rankingRequests()).every(
        (r) => r.tab === "departments",
      ),
    ).toBe(true);
  });
});

describe("RankingContent — model filter", () => {
  it("shows the model named in the URL and sends it with both requests", async () => {
    const stub = stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, {
      searchParams: { ...RANGE, model: "claude-opus" },
    });
    await loadedTable();

    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "Claude Opus",
    );
    await waitFor(() => {
      const requests = requestParams(stub.rankingRequests());
      expect(requests).toContainEqual(
        expect.objectContaining({ ...RANGE, model: "claude-opus" }),
      );
      expect(requests).toContainEqual(
        expect.objectContaining({ ...PREVIOUS, model: "claude-opus" }),
      );
    });
  });

  it("defaults to All models and treats an unknown model in the URL as 'all'", async () => {
    const stub = stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, {
      searchParams: { ...RANGE, model: "bogus" },
    });
    await loadedTable();

    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "All models",
    );
    for (const request of requestParams(stub.rankingRequests())) {
      expect(request).not.toHaveProperty("model");
    }
  });
});

describe("RankingContent — table", () => {
  it("shows Rank, Name, Cost, Input Tokens, Output Tokens, Invocations, % of Total and Trend columns", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    await loadedTable();

    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent?.trim()),
    ).toEqual([
      "Rank",
      "Name",
      "Cost",
      "Input Tokens",
      "Output Tokens",
      "Invocations",
      "% of Total",
      "Trend",
    ]);
  });

  it("lists rows by cost descending, ranks them and marks Cost as the sorted column", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    expect(orderedNames(table)).toEqual([
      "Engineering",
      "Data Science",
      "Marketing",
      "Legal",
    ]);
    expect(header(/^Cost/)).toHaveAttribute("aria-sort", "descending");
    expect(hasRankLabel(rowFor(table, "Engineering"), 1)).toBe(true);
    expect(hasRankLabel(rowFor(table, "Data Science"), 2)).toBe(true);
    expect(hasRankLabel(rowFor(table, "Marketing"), 3)).toBe(true);
    expect(rowFor(table, "Legal").firstElementChild).toHaveTextContent("4");
  });

  it("formats cost as USD and counts with thousands separators", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    const engineering = rowFor(table, "Engineering");
    expect(engineering).toHaveTextContent("$600.00");
    expect(engineering).toHaveTextContent("1,000,000");
    expect(engineering).toHaveTextContent("500,000");
    expect(engineering).toHaveTextContent("1,200");
  });

  it("computes % of Total as the row's cost over the sum of the returned rows", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    const expected: Record<string, [string, number]> = {
      Engineering: ["60.0%", 60],
      "Data Science": ["30.0%", 30],
      Marketing: ["6.0%", 6],
      Legal: ["4.0%", 4],
    };
    for (const [name, [text, value]] of Object.entries(expected)) {
      const r = rowFor(table, name);
      expect(within(r).getByText(text)).toBeInTheDocument();
      const meter = r.querySelector('[role="meter"], [role="progressbar"]');
      expect(meter).not.toBeNull();
      expect(Number(meter?.getAttribute("aria-valuenow"))).toBeCloseTo(
        value,
        1,
      );
    }
  });

  it("shows each row's change vs the previous period and '—' when there is no usable previous cost", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    await waitFor(() =>
      expect(
        within(rowFor(table, "Engineering")).getByRole("img", {
          name: "Up 20.0% vs previous period",
        }),
      ).toBeInTheDocument(),
    );
    expect(
      within(rowFor(table, "Data Science")).getByRole("img", {
        name: "Down 50.0% vs previous period",
      }),
    ).toBeInTheDocument();

    for (const name of ["Marketing", "Legal"]) {
      const r = rowFor(table, name);
      expect(r.lastElementChild).toHaveTextContent("—");
      expect(r.lastElementChild).not.toHaveTextContent("%");
      expect(
        within(r).queryByRole("img", { name: /vs previous period/ }),
      ).not.toBeInTheDocument();
      expect(r.textContent).not.toMatch(/NaN|Infinity/);
    }
  });

  it("matches previous-period rows by id, not by name", async () => {
    stubApi({
      ranking: rankingFor({
        departments: {
          current: DEPARTMENTS,
          previous: [
            row({ id: "dept-eng", name: "Eng (old name)", cost: 500 }),
          ],
        },
      }),
    });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    expect(
      await within(rowFor(table, "Engineering")).findByRole("img", {
        name: "Up 20.0% vs previous period",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the table intact when the previous-period request fails", async () => {
    const current = rankingFor();
    const stub = stubApi({
      ranking: (url) =>
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? apiError(500)
          : current(url),
    });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    await waitFor(() =>
      expect(
        requestParams(stub.rankingRequests()).some(
          (r) => r.dateFrom === PREVIOUS.dateFrom,
        ),
      ).toBe(true),
    );
    await flushPromises();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(orderedNames(table)).toEqual(NAMES);
    for (const r of dataRows(table)) {
      expect(r.lastElementChild).toHaveTextContent("—");
    }
  });

  it("does not wait for the previous period before showing the table", async () => {
    const current = rankingFor();
    stubApi({
      ranking: (url) =>
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? NEVER()
          : current(url),
    });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    expect(orderedNames(table)).toEqual(NAMES);
    expect(rowFor(table, "Engineering").lastElementChild).toHaveTextContent(
      "—",
    );
  });

  it("flags estimated costs on the users tab but not when costs are exact", async () => {
    stubApi({
      ranking: rankingFor({
        users: {
          current: [
            row({
              id: "u1",
              name: "Alice Nguyen",
              cost: 10,
              costEstimated: true,
            }),
            row({ id: "u2", name: "Bob Okafor", cost: 5, costEstimated: true }),
          ],
          previous: [],
        },
      }),
    });
    const view = renderWithProviders(<RankingContent />, {
      searchParams: { ...RANGE, tab: "users" },
    });
    const usersTable = await loadedTable();
    expect(estimatedMarkers(usersTable).length).toBeGreaterThan(0);
    view.unmount();

    renderWithProviders(<RankingContent />, URL_PARAMS);
    const departmentsTable = await loadedTable();
    expect(estimatedMarkers(departmentsTable)).toHaveLength(0);
  });
});

describe("RankingContent — sorting, paging, search and columns", () => {
  it("re-sorts rows and updates aria-sort when a header is clicked", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();
    const user = userEvent.setup();

    await user.click(within(header(/^Cost/)).getByRole("button"));
    expect(header(/^Cost/)).toHaveAttribute("aria-sort", "ascending");
    expect(orderedNames(table)).toEqual([
      "Legal",
      "Marketing",
      "Data Science",
      "Engineering",
    ]);

    await user.click(within(header(/^Invocations/)).getByRole("button"));
    expect(header(/^Cost/)).toHaveAttribute("aria-sort", "none");
    const direction = header(/^Invocations/).getAttribute("aria-sort");
    expect(["ascending", "descending"]).toContain(direction);
    expect(orderedNames(table)).toEqual(
      direction === "ascending"
        ? ["Marketing", "Legal", "Engineering", "Data Science"]
        : ["Data Science", "Engineering", "Legal", "Marketing"],
    );
  });

  it("pages at 20 rows with Previous/Next", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      row({
        id: `dept-${i}`,
        name: `Dept ${String(i + 1).padStart(2, "0")}`,
        cost: 1000 - i,
      }),
    );
    stubApi({
      ranking: rankingFor({ departments: { current: many, previous: [] } }),
    });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    expect(dataRows(table)).toHaveLength(20);
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /next/i }));

    expect(dataRows(table)).toHaveLength(5);
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(within(table).getByText("Dept 25")).toBeInTheDocument();
  });

  it("filters rows by name after the debounce and keeps % of Total relative to all returned rows", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: "eng" },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(orderedNames(table)).toEqual(["Engineering"]);
    expect(
      within(rowFor(table, "Engineering")).getByText("60.0%"),
    ).toBeInTheDocument();
  });

  it("hides a column from the Columns menu", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    await loadedTable();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: "Invocations" }),
    );

    expect(
      screen.queryByRole("columnheader", { name: /Invocations/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Cost/ })).toBeVisible();
  });
});

describe("RankingContent — CSV export", () => {
  it("downloads the current sorted rows as ranking-<tab>-<dateFrom>-<dateTo>.csv with raw numbers", async () => {
    const blobs: Blob[] = [];
    const downloads: string[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        blobs.push(blob);
        return "blob:ranking-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click(this: HTMLAnchorElement) {
        downloads.push(this.download);
      },
    );
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    await loadedTable();
    const user = userEvent.setup();

    await user.click(within(header(/^Cost/)).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(downloads).toEqual([
      `ranking-departments-${RANGE.dateFrom}-${RANGE.dateTo}.csv`,
    ]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toMatch(/^text\/csv/);
    const lines = (await blobs[0]?.text())
      ?.split(/\r?\n/)
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(5);
    const columns = (lines?.[0] ?? "").split(",");
    for (const name of ["Name", "Cost", "Input Tokens", "Invocations"]) {
      expect(columns).toContain(name);
    }
    const first = (lines?.[1] ?? "").split(",");
    expect(first[columns.indexOf("Name")]).toBe("Legal");
    expect(Number(first[columns.indexOf("Cost")])).toBe(40);
    expect(first[columns.indexOf("Input Tokens")]).toMatch(/^\d+$/);
    expect(Number(first[columns.indexOf("Input Tokens")])).toBe(30_000);
    expect((lines?.[4] ?? "").split(",")[columns.indexOf("Name")]).toBe(
      "Engineering",
    );
  });
});

// The ranking table is the shared UsageTable, with the CSV export supplied
// through its toolbar slot -- not a second table implementation (Design System
// -- Component Inventory, `UsageTable`, `ExportButton`).
describe("RankingContent — shared UsageTable", () => {
  it("renders exactly one UsageTable whose toolbar holds search, Columns and Export CSV above the table", async () => {
    stubApi({ ranking: rankingFor() });
    const view = renderWithProviders(<RankingContent />, URL_PARAMS);
    const table = await loadedTable();

    const roots = view.container.querySelectorAll('[data-slot="usage-table"]');
    expect(roots).toHaveLength(1);
    const root = roots[0] as HTMLElement;
    expect(root.contains(table)).toBe(true);
    const columns = within(root).getByRole("button", { name: "Columns" });
    const exportCsv = within(root).getByRole("button", { name: "Export CSV" });
    expect(within(root).getByLabelText(/search/i)).toBeInTheDocument();

    let toolbar: Element | null = exportCsv;
    while (toolbar && !toolbar.contains(columns))
      toolbar = toolbar.parentElement;
    expect(toolbar).not.toBeNull();
    expect(toolbar?.contains(table)).toBe(false);
  });
});

// Design System -- Responsive Tables: below md (768px) each row is a card; the
// controls, including Export CSV, stay available.
describe("RankingContent — mobile card layout (viewport below 768px)", () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 375,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalWidth,
    });
  });

  it("shows each department as a card, in cost order, and no table", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);

    const list = await screen.findByRole("list", { name: "Cost ranking" });
    const cards = within(list).getAllByRole("listitem");

    expect(
      cards.map(
        (card) =>
          NAMES.find((name) => (card.textContent ?? "").includes(name)) ?? "?",
      ),
    ).toEqual(["Engineering", "Data Science", "Marketing", "Legal"]);
    expect((cards[0]?.textContent ?? "").trimStart()).toMatch(/^Engineering/);
    expect(cards[0]).toHaveTextContent("$600.00");
    expect(cards[0]?.textContent).toMatch(/Invocations\W*1,200/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps search, Columns, Export CSV and a Sort control available", async () => {
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    await screen.findByRole("list", { name: "Cost ranking" });

    expect(screen.getByLabelText(/search/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export CSV" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /sort/i })).toBeInTheDocument();
  });

  it("still exports every row, with the table's columns, from the cards layout", async () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        blobs.push(blob);
        return "blob:ranking-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    stubApi({ ranking: rankingFor() });
    renderWithProviders(<RankingContent />, URL_PARAMS);
    await screen.findByRole("list", { name: "Cost ranking" });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Export CSV" }));

    expect(blobs).toHaveLength(1);
    const lines = (await blobs[0]?.text())
      ?.split(/\r?\n/)
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(5);
    const columns = (lines?.[0] ?? "").split(",");
    expect(columns).toContain("Input Tokens");
    expect((lines?.[1] ?? "").split(",")[columns.indexOf("Name")]).toBe(
      "Engineering",
    );
  });
});

describe("RankingContent — loading, empty and error states", () => {
  it("shows a skeleton and no table while the ranking is loading", () => {
    stubApi({ ranking: NEVER });
    const view = renderWithProviders(<RankingContent />, URL_PARAMS);

    expect(view.container.querySelectorAll(SKELETON).length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("shows the 'No usage in this period' empty state when no rows come back", async () => {
    stubApi({
      ranking: rankingFor({ departments: { current: [], previous: [] } }),
    });
    renderWithProviders(<RankingContent />, URL_PARAMS);

    expect(
      await screen.findByText("No usage in this period"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Engineering")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an alert with Retry when the ranking fails, and recovers on Retry", async () => {
    let failing = true;
    const ok = rankingFor();
    stubApi({ ranking: (url) => (failing ? apiError(500) : ok(url)) });
    renderWithProviders(<RankingContent />, URL_PARAMS);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn.t load/i);
    expect(screen.getByRole("tablist")).toBeInTheDocument();

    failing = false;
    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: /retry/i }));

    const table = await loadedTable();
    expect(orderedNames(table)).toEqual(NAMES);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
