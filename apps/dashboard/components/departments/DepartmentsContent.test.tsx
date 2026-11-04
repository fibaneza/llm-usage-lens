import { MODEL_META, type DepartmentRow } from "@bedrock-usage/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateRangePicker } from "@/components/filters/DateRangePicker";
import { previousRange, resolvePreset } from "@/lib/date-range";
import {
  apiError,
  apiResponse,
  departmentRowFixture,
  departmentsBody,
  NEVER,
  stubApi,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { DepartmentsContent } from "./DepartmentsContent";

// Source: implementation-phases Phase 4.3 (tasks and Verify: "cards render
// with seed data, links navigate to detail pages"; "Tests: grid renders
// correct number of cards; empty state when no departments"); Data Model --
// Zod Validation Schemas (`teamCount`, `topModel` on the department row); Design
// System -- Page Architecture (Departments = "Department cards grid"),
// Component Inventory (MetricCard, EmptyState, Skeleton, DeltaBadge); Rules
// 20.5, 20.12, 40.4, 60.12, 60.21, 60.24. The grid is exercised through the
// real hooks, fetchApi and nuqs with a stubbed same-origin fetch. The module
// under test is `components/departments/DepartmentsContent.tsx`, a client
// component that takes no props and reads the global date range from the URL.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PREVIOUS = previousRange(RANGE);
const URL_PARAMS = { searchParams: RANGE };

const SKELETON = '[data-slot="skeleton"]';
const DETAIL_PREFIX = "/dashboard/departments/";

const row = departmentRowFixture;

// Cost order (the API order) is Engineering, Data Science, Marketing, Legal.
// Each card has its own top model so a card showing another card's model, or
// all of them, is visible. Legal has no model usage at all.
const DEPARTMENTS: DepartmentRow[] = [
  row({
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 600,
    modelCost: 550,
    nonModelCost: 50,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
    teamCount: 3,
    topModel: "claude-opus",
  }),
  row({
    departmentId: "dept-data",
    departmentName: "Data Science",
    cost: 300,
    modelCost: 300,
    inputTokens: 400_000,
    outputTokens: 200_000,
    invocations: 2_500,
    teamCount: 1,
    topModel: "claude-sonnet",
  }),
  row({
    departmentId: "dept-mkt",
    departmentName: "Marketing",
    cost: 60,
    modelCost: 60,
    inputTokens: 50_000,
    outputTokens: 25_000,
    invocations: 300,
    teamCount: 2,
    topModel: "claude-haiku",
  }),
  row({
    departmentId: "dept-legal",
    departmentName: "Legal",
    cost: 40,
    modelCost: 0,
    nonModelCost: 40,
    inputTokens: 0,
    outputTokens: 0,
    invocations: 0,
    teamCount: 1,
    topModel: null,
  }),
];

// Engineering +20.0%, Data Science -50.0%, Marketing has no previous match,
// Legal's previous cost is 0 (Rule 20.12: no badge, never 0% or Infinity).
// modelCost is deliberately unlike `cost` so a comparison on the wrong field
// shows.
const PREVIOUS_DEPARTMENTS: DepartmentRow[] = [
  row({
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 500,
    modelCost: 100,
  }),
  row({
    departmentId: "dept-data",
    departmentName: "Data Science",
    cost: 600,
    modelCost: 100,
  }),
  row({
    departmentId: "dept-legal",
    departmentName: "Legal",
    cost: 0,
    modelCost: 0,
  }),
];

const NAMES = DEPARTMENTS.map((d) => d.departmentName);
const MODEL_NAMES = Object.values(MODEL_META).map((m) => m.displayName);

// Serves `current` for the URL's range and `previous` for the period just
// before it.
function departmentsFor(
  current: DepartmentRow[] = DEPARTMENTS,
  previous: DepartmentRow[] = PREVIOUS_DEPARTMENTS,
): (url: URL) => Response {
  return (url) =>
    apiResponse(
      departmentsBody(
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? previous
          : current,
      ),
    );
}

function requestParams(urls: URL[]): Array<Record<string, string>> {
  return urls.map((url) => Object.fromEntries(url.searchParams));
}

// The department cards: each is a link to a department detail page.
function cardLinks(): HTMLElement[] {
  return screen
    .queryAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith(DETAIL_PREFIX));
}

async function loadedCards(): Promise<HTMLElement[]> {
  await waitFor(() => expect(cardLinks().length).toBeGreaterThan(0));
  return cardLinks();
}

async function cardFor(name: string): Promise<HTMLElement> {
  const cards = await loadedCards();
  const found = cards.find((card) => textOf(card).includes(name));
  if (!found) throw new Error(`no department card for "${name}"`);
  return found;
}

// Text of every text node joined by a space, so adjacent elements never fuse
// into one token ("$600.00" + "3 teams").
function textOf(element: HTMLElement): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.textContent ?? "");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function orderedNames(cards: HTMLElement[]): string[] {
  return cards.map(
    (card) => NAMES.find((name) => textOf(card).includes(name)) ?? "?",
  );
}

// "3 teams", "1 team", "Teams 3" or "Teams: 3"; "1 teams" is not accepted.
function expectTeamCount(card: HTMLElement, count: number) {
  const noun = count === 1 ? "team" : "teams";
  const pattern = new RegExp(
    `(\\b${count}\\s+${noun}\\b)|(\\bteams?\\b\\W{0,3}${count}\\b)`,
    "i",
  );
  expect(textOf(card)).toMatch(pattern);
}

function hrefOf(card: HTMLElement): URL {
  return new URL(card.getAttribute("href") ?? "", "http://localhost");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DepartmentsContent -- cards grid", () => {
  it("renders one card per department row", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const cards = await loadedCards();

    expect(cards).toHaveLength(DEPARTMENTS.length);
  });

  it("keeps the API order (cost descending) rather than re-sorting", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    expect(orderedNames(await loadedCards())).toEqual([
      "Engineering",
      "Data Science",
      "Marketing",
      "Legal",
    ]);
  });

  it("renders exactly the rows it is given, whatever their number", async () => {
    stubApi({
      departments: departmentsFor([
        row({ departmentId: "d1", departmentName: "Alpha" }),
        row({ departmentId: "d2", departmentName: "Beta" }),
        row({ departmentId: "d3", departmentName: "Gamma" }),
        row({ departmentId: "d4", departmentName: "Delta" }),
        row({ departmentId: "d5", departmentName: "Epsilon" }),
        row({ departmentId: "d6", departmentName: "Zeta" }),
        row({ departmentId: "d7", departmentName: "Eta" }),
      ]),
    });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    expect(await loadedCards()).toHaveLength(7);
  });

  it("shows a department's name, total cost, total tokens, team count and top model", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const engineering = textOf(await cardFor("Engineering"));

    expect(engineering).toContain("Engineering");
    expect(engineering).toContain("$600.00");
    // Input + output = 1,500,000; the abbreviated form is acceptable too.
    expect(engineering).toMatch(/1,500,000|1\.5M/);
    expectTeamCount(await cardFor("Engineering"), 3);
    expect(engineering).toContain(MODEL_META["claude-opus"].displayName);
  });

  it("shows every card its own figures, not another department's", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const data = await cardFor("Data Science");
    const marketing = await cardFor("Marketing");

    expect(textOf(data)).toContain("$300.00");
    expect(textOf(data)).toMatch(/600,000|600K/);
    expectTeamCount(data, 1);
    expect(textOf(data)).toContain(MODEL_META["claude-sonnet"].displayName);
    expect(textOf(data)).not.toContain(MODEL_META["claude-opus"].displayName);

    expect(textOf(marketing)).toContain("$60.00");
    expect(textOf(marketing)).toMatch(/75,000|75K/);
    expectTeamCount(marketing, 2);
    expect(textOf(marketing)).toContain(MODEL_META["claude-haiku"].displayName);
    expect(textOf(marketing)).not.toContain(
      MODEL_META["claude-sonnet"].displayName,
    );
  });

  it("names the top model from the shared model table, including the 'other' bucket", async () => {
    stubApi({
      departments: departmentsFor(
        [
          row({
            departmentId: "dept-misc",
            departmentName: "Miscellaneous",
            topModel: "other",
          }),
        ],
        [],
      ),
    });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const misc = textOf(await cardFor("Miscellaneous"));

    expect(misc).toContain(MODEL_META.other.displayName);
    expect(misc).not.toContain("claude-");
  });

  it("shows a neutral text, never a model name, when topModel is null", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const legal = await cardFor("Legal");
    const text = textOf(legal);

    for (const modelName of MODEL_NAMES) {
      expect(text).not.toContain(modelName);
    }
    expect(text).not.toMatch(/null|undefined|NaN|Infinity/);
    expect(text).toMatch(/—|no model usage|no usage|none|n\/a/i);
    expectTeamCount(legal, 1);
    expect(text).toContain("$40.00");
  });

  it("shows zero tokens as 0 for a department with no token usage", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const legal = textOf(await cardFor("Legal"));

    expect(legal).toMatch(/\b0\b/);
    expect(legal).not.toMatch(/NaN|undefined/);
  });

  it("never shows the department id as the card's name", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const engineering = textOf(await cardFor("Engineering"));

    expect(engineering).not.toContain("dept-eng");
  });
});

describe("DepartmentsContent -- requests", () => {
  it("requests the current range from the URL and the period just before it, with only the range params", async () => {
    const stub = stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);
    await loadedCards();

    await waitFor(() => {
      const requests = requestParams(stub.departmentsRequests());
      expect(requests).toContainEqual(RANGE);
      expect(requests).toContainEqual(PREVIOUS);
    });
  });

  it("falls back to the last 30 days when the URL carries no range", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-01-20T12:00:00Z"),
    });
    const thirty = resolvePreset("30d");
    const stub = stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />);
    await loadedCards();

    expect(thirty).toEqual({ dateFrom: "2025-12-22", dateTo: "2026-01-20" });
    await waitFor(() => {
      const requests = requestParams(stub.departmentsRequests());
      expect(requests).toContainEqual(thirty);
      expect(requests).toContainEqual(previousRange(thirty));
    });
  });

  it("falls back to the last 30 days when the URL range is malformed", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-01-20T12:00:00Z"),
    });
    const stub = stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, {
      searchParams: { dateFrom: "not-a-date", dateTo: "2026-13-45" },
    });
    await loadedCards();

    await waitFor(() =>
      expect(requestParams(stub.departmentsRequests())).toContainEqual({
        dateFrom: "2025-12-22",
        dateTo: "2026-01-20",
      }),
    );
    expect(
      requestParams(stub.departmentsRequests()).some(
        (r) => r.dateFrom === "not-a-date",
      ),
    ).toBe(false);
  });

  it("caps a URL range longer than 90 days (Rule 20.8) before requesting it", async () => {
    const stub = stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, {
      searchParams: { dateFrom: "2025-01-01", dateTo: "2026-01-20" },
    });
    await loadedCards();

    await waitFor(() =>
      expect(requestParams(stub.departmentsRequests())).toContainEqual({
        dateFrom: "2025-10-23",
        dateTo: "2026-01-20",
      }),
    );
    expect(
      requestParams(stub.departmentsRequests()).some(
        (r) => r.dateFrom === "2025-01-01",
      ),
    ).toBe(false);
  });
});

describe("DepartmentsContent -- change vs the previous period (DeltaBadge)", () => {
  it("shows each card's change against the same department's previous cost", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);
    const engineering = await cardFor("Engineering");

    await waitFor(() =>
      expect(
        within(engineering).getByRole("img", {
          name: "Up 20.0% vs previous period",
        }),
      ).toBeInTheDocument(),
    );
    expect(
      within(await cardFor("Data Science")).getByRole("img", {
        name: "Down 50.0% vs previous period",
      }),
    ).toBeInTheDocument();
  });

  it("shows no badge when the department has no previous cost or a previous cost of 0", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);
    const engineering = await cardFor("Engineering");
    await waitFor(() =>
      expect(
        within(engineering).getByRole("img", { name: /vs previous period/ }),
      ).toBeInTheDocument(),
    );

    for (const name of ["Marketing", "Legal"]) {
      const card = await cardFor(name);
      expect(
        within(card).queryByRole("img", { name: /vs previous period/ }),
      ).not.toBeInTheDocument();
      expect(textOf(card)).not.toMatch(/NaN|Infinity|0\.0%/);
    }
  });

  it("matches previous-period rows by department id, not by name", async () => {
    stubApi({
      departments: departmentsFor(DEPARTMENTS, [
        row({
          departmentId: "dept-eng",
          departmentName: "Eng (old name)",
          cost: 500,
        }),
        row({
          departmentId: "dept-other",
          departmentName: "Data Science",
          cost: 1_000,
        }),
      ]),
    });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    expect(
      await within(await cardFor("Engineering")).findByRole("img", {
        name: "Up 20.0% vs previous period",
      }),
    ).toBeInTheDocument();
    expect(
      within(await cardFor("Data Science")).queryByRole("img", {
        name: /vs previous period/,
      }),
    ).not.toBeInTheDocument();
  });

  it("compares total cost (model plus non-model), not model cost alone", async () => {
    stubApi({
      departments: departmentsFor(
        [
          row({
            departmentId: "dept-eng",
            departmentName: "Engineering",
            cost: 600,
            modelCost: 100,
            nonModelCost: 500,
          }),
        ],
        [
          row({
            departmentId: "dept-eng",
            departmentName: "Engineering",
            cost: 500,
            modelCost: 500,
            nonModelCost: 0,
          }),
        ],
      ),
    });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    expect(
      await within(await cardFor("Engineering")).findByRole("img", {
        name: "Up 20.0% vs previous period",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the cards intact, without badges or an alert, when the previous-period request fails", async () => {
    const current = departmentsFor();
    const stub = stubApi({
      departments: (url) =>
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? apiError(500)
          : current(url),
    });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);
    await loadedCards();

    await waitFor(() =>
      expect(
        requestParams(stub.departmentsRequests()).some(
          (r) => r.dateFrom === PREVIOUS.dateFrom,
        ),
      ).toBe(true),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(orderedNames(cardLinks())).toEqual(NAMES);
    expect(
      screen.queryAllByRole("img", { name: /vs previous period/ }),
    ).toHaveLength(0);
  });

  it("does not wait for the previous period before showing the cards", async () => {
    const current = departmentsFor();
    stubApi({
      departments: (url) =>
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? NEVER()
          : current(url),
    });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    expect(orderedNames(await loadedCards())).toEqual(NAMES);
    expect(
      screen.queryAllByRole("img", { name: /vs previous period/ }),
    ).toHaveLength(0);
  });
});

describe("DepartmentsContent -- links to the department detail page", () => {
  it("makes every card a link to its department's detail route", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const cards = await loadedCards();

    expect(cards.map((card) => hrefOf(card).pathname)).toEqual([
      "/dashboard/departments/dept-eng",
      "/dashboard/departments/dept-data",
      "/dashboard/departments/dept-mkt",
      "/dashboard/departments/dept-legal",
    ]);
  });

  it("carries the global date range in each card's link", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    for (const card of await loadedCards()) {
      const { searchParams } = hrefOf(card);
      expect(searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
      expect(searchParams.get("dateTo")).toBe(RANGE.dateTo);
    }
  });

  it("carries only the date range, not page-local params", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, {
      searchParams: { ...RANGE, tab: "users", sort: "cost" },
    });

    for (const card of await loadedCards()) {
      expect([...hrefOf(card).searchParams.keys()].sort()).toEqual([
        "dateFrom",
        "dateTo",
      ]);
    }
  });

  it("links without a literal 'null' or 'undefined' when the URL has no range", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />);

    const cards = await loadedCards();

    for (const card of cards) {
      const href = card.getAttribute("href") ?? "";
      expect(href).toMatch(/^\/dashboard\/departments\/dept-/);
      expect(href).not.toMatch(/null|undefined/);
    }
  });

  it("URL-encodes the department id in the path", async () => {
    stubApi({
      departments: departmentsFor(
        [
          row({
            departmentId: "dept/ops & co",
            departmentName: "Ops and Co",
          }),
        ],
        [],
      ),
    });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const card = await cardFor("Ops and Co");

    expect(hrefOf(card).pathname).toBe(
      `/dashboard/departments/${encodeURIComponent("dept/ops & co")}`,
    );
    expect(hrefOf(card).searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
  });

  it("gives each card link an accessible name that contains the department name", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);
    await loadedCards();

    for (const name of NAMES) {
      const link = screen.getByRole("link", { name: new RegExp(name) });
      expect(link.getAttribute("href")).toMatch(/^\/dashboard\/departments\//);
    }
  });

  it("does not nest links inside a card", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    for (const card of await loadedCards()) {
      expect(within(card).queryAllByRole("link")).toHaveLength(0);
    }
  });

  it("leaves the cards keyboard-reachable (links, not click handlers on a div)", async () => {
    stubApi({ departments: departmentsFor() });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const [first] = await loadedCards();
    await userEvent.setup().tab();

    expect(first?.tagName).toBe("A");
    expect(first).toHaveFocus();
  });
});

describe("DepartmentsContent -- loading, empty and error states", () => {
  it("shows skeletons and no cards, alert or empty state while the request is pending", () => {
    stubApi({ departments: NEVER });
    const view = renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    expect(view.container.querySelectorAll(SKELETON).length).toBeGreaterThan(0);
    expect(cardLinks()).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryAllByText(/\bno (departments?|usage)/i)).toHaveLength(0);
  });

  it("removes the skeletons once the cards have loaded", async () => {
    stubApi({ departments: departmentsFor() });
    const view = renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    await loadedCards();

    expect(view.container.querySelectorAll(SKELETON)).toHaveLength(0);
  });

  it("shows an empty state, no cards and no alert when there are no departments", async () => {
    stubApi({ departments: departmentsFor([], []) });
    const view = renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    expect(
      (await screen.findAllByText(/\bno (departments?|usage|data|cost)/i))
        .length,
    ).toBeGreaterThan(0);
    expect(cardLinks()).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.container.querySelectorAll(SKELETON)).toHaveLength(0);
  });

  it("shows an alert with Retry when the request fails, and recovers on Retry", async () => {
    let failing = true;
    const ok = departmentsFor();
    stubApi({ departments: (url) => (failing ? apiError(500) : ok(url)) });
    renderWithProviders(<DepartmentsContent />, URL_PARAMS);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn.t load/i);
    expect(cardLinks()).toHaveLength(0);

    failing = false;
    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: /retry/i }));

    expect(orderedNames(await loadedCards())).toEqual(NAMES);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("DepartmentsContent -- the date range drives the grid", () => {
  it("clears an errored grid when the date range changes, without a Retry click", async () => {
    const seven = resolvePreset("7d");
    const okFrom = [seven.dateFrom, previousRange(seven).dateFrom];
    const sevenData = [
      row({
        departmentId: "dept-mkt",
        departmentName: "Marketing",
        cost: 77.7,
      }),
    ];
    stubApi({
      departments: (url) =>
        okFrom.includes(url.searchParams.get("dateFrom") ?? "")
          ? apiResponse(departmentsBody(sevenData))
          : apiError(500),
    });
    renderWithProviders(
      <>
        <DateRangePicker />
        <DepartmentsContent />
      </>,
      URL_PARAMS,
    );
    await screen.findByRole("alert");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /last 7 days/i }));

    const card = await cardFor("Marketing");
    expect(textOf(card)).toContain("$77.70");
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("refetches and re-renders the cards for a new range", async () => {
    const seven = resolvePreset("7d");
    const sevenData = [
      row({
        departmentId: "dept-mkt",
        departmentName: "Marketing",
        cost: 77.7,
      }),
    ];
    const stub = stubApi({
      departments: (url) =>
        apiResponse(
          departmentsBody(
            url.searchParams.get("dateFrom") === seven.dateFrom
              ? sevenData
              : DEPARTMENTS,
          ),
        ),
    });
    renderWithProviders(
      <>
        <DateRangePicker />
        <DepartmentsContent />
      </>,
    );
    expect(orderedNames(await loadedCards())).toEqual(NAMES);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /last 7 days/i }));

    await waitFor(() => {
      const requests = requestParams(stub.departmentsRequests());
      expect(requests).toContainEqual(seven);
      expect(requests).toContainEqual(previousRange(seven));
    });
    await waitFor(() => expect(cardLinks()).toHaveLength(1));
    expect(textOf(await cardFor("Marketing"))).toContain("$77.70");
    expect(screen.queryByText("Engineering")).not.toBeInTheDocument();
    // The card links follow the new range too.
    expect(
      hrefOf(await cardFor("Marketing")).searchParams.get("dateFrom"),
    ).toBe(seven.dateFrom);
  });
});
