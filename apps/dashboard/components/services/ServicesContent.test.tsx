import type { ServiceListRow } from "@llm-usage-lens/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  apiResponse,
  serviceListRowFixture,
  servicesBody,
  stubApi,
} from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { ServicesContent } from "./ServicesContent";

// Source: implementation-phases Phase 4.7 (services table: Service Name, Team,
// Department, Cost, Tokens, Invocations, % of Total; Team links to the team
// detail page; EmptyState); Data Model -- `ServicesResponseSchema` (one row per
// team and service, decided 2026-11-06) and "Non-model cost is account-level
// only" (model-usage note); Rules 20.3, 20.10, 40.4, 60.12, 60.17, 60.24.
// Module under test: `components/services/ServicesContent.tsx`, a client
// component with no props that reads the date range from the URL via nuqs and
// fetches /api/services.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const URL_PARAMS = { searchParams: RANGE };

const row = serviceListRowFixture;

const ROWS: ServiceListRow[] = [
  row({
    serviceName: "payments-api",
    teamId: "team-pay",
    teamName: "Payments",
    cost: 60,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
  }),
  row({
    serviceName: "ledger-svc",
    teamId: "team a/b",
    teamName: "Odd Id",
    departmentId: "dept-fin",
    departmentName: "Finance",
    cost: 30,
  }),
  row({
    serviceName: "_untagged",
    teamId: "team-pay",
    teamName: "Payments",
    cost: 10,
  }),
];

const servicesFor =
  (all: ServiceListRow[] = ROWS) =>
  () =>
    apiResponse(servicesBody(all));

function dataRows(table: HTMLElement): HTMLElement[] {
  return within(table)
    .getAllByRole("row")
    .filter((r) => within(r).queryAllByRole("cell").length > 0);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ServicesContent -- table", () => {
  it("renders the seven columns and one row per team and service", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    const table = await screen.findByRole("table");

    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim() ?? "");
    for (const name of [
      /^Service Name/,
      /^Team/,
      /^Department/,
      /^Cost/,
      /^Tokens/,
      /^Invocations/,
      /^% of Total/,
    ]) {
      expect(headers.some((h) => name.test(h))).toBe(true);
    }
    const rows = dataRows(table);
    expect(rows).toHaveLength(3);
    const pay = rows.find((r) => r.textContent?.includes("payments-api"));
    expect(pay).toHaveTextContent("Payments");
    expect(pay).toHaveTextContent("Engineering");
    expect(within(pay as HTMLElement).getByText("1.5M")).toHaveAttribute(
      "title",
      "1,500,000",
    );
  });

  it("requests /api/services with the URL date range", async () => {
    const stub = stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    await screen.findByRole("table");
    expect(
      stub
        .servicesRequests()
        .every(
          (u) =>
            u.searchParams.get("dateFrom") === RANGE.dateFrom &&
            u.searchParams.get("dateTo") === RANGE.dateTo,
        ),
    ).toBe(true);
  });

  it("shows _untagged as 'Untagged', never the raw key", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Untagged")).toBeInTheDocument();
    expect(within(table).queryByText("_untagged")).not.toBeInTheDocument();
  });

  it("computes % of Total as row cost over the sum of all rows", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    const meters = within(table).getAllByRole("meter");
    expect(meters.map((m) => m.getAttribute("aria-valuetext")).sort()).toEqual([
      "10.0%",
      "30.0%",
      "60.0%",
    ]);
  });

  it("marks every cost as an estimate", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    for (const r of dataRows(table)) {
      expect(r.textContent).toMatch(/est/i);
    }
  });

  it("links each team to its detail page, carrying the date range", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    await screen.findByRole("table");

    const href = screen
      .getAllByRole("link", { name: "Payments" })[0]
      ?.getAttribute("href");
    expect(href).toContain("/dashboard/teams/team-pay");
    expect(href).toContain("dateFrom=2026-01-11");
    expect(href).toContain("dateTo=2026-01-20");
    expect(
      screen.getByRole("link", { name: "Odd Id" }).getAttribute("href"),
    ).toContain("/dashboard/teams/team%20a%2Fb");
  });

  it("sorts by cost descending by default and toggles aria-sort on click", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    const cost = screen.getByRole("columnheader", { name: /^Cost/ });
    expect(cost).toHaveAttribute("aria-sort", "descending");
    expect(dataRows(table)[0]).toHaveTextContent("payments-api");

    await userEvent.setup().click(within(cost).getByRole("button"));
    expect(cost).toHaveAttribute("aria-sort", "ascending");
    expect(dataRows(table)[0]).toHaveTextContent("Untagged");
  });

  it("shows the model-usage-only note as a role=note under the page description, above the toolbar (Design System -- Services Page, 2026-11-16)", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    await screen.findByRole("table");
    const note = screen.getByRole("note");

    expect(note).toHaveTextContent(/model usage only/i);
    const description = note.previousElementSibling;
    expect(description?.textContent?.trim()).toBeTruthy();
    expect(description).not.toContainElement(screen.getByRole("searchbox"));
    expect(
      note.compareDocumentPosition(screen.getByRole("searchbox")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// Design System -- Services Page (2026-11-16): "the toolbar has Search,
// Columns and Export CSV like Ranking"; SH-70, SH-73.
describe("ServicesContent -- toolbar", () => {
  it("puts search, Columns and Export CSV in the table toolbar above the table", async () => {
    stubApi({ services: servicesFor() });
    const view = renderWithProviders(<ServicesContent />, URL_PARAMS);
    const table = await screen.findByRole("table");

    const root = view.container.querySelector(
      '[data-slot="usage-table"]',
    ) as HTMLElement;
    const toolbar = within(root)
      .getByRole("button", {
        name: "Export CSV",
      })
      .closest('[data-slot="table-toolbar"]') as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(within(toolbar).getByRole("searchbox")).toBeInTheDocument();
    expect(
      within(toolbar).getByRole("button", { name: "Columns" }),
    ).toBeInTheDocument();
    expect(toolbar.contains(table)).toBe(false);
  });

  it("filters the rows by service name from the search box", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    const table = await screen.findByRole("table");

    await userEvent.setup().type(screen.getByRole("searchbox"), "ledger");

    await waitFor(() => expect(dataRows(table)).toHaveLength(1));
    expect(dataRows(table)[0]).toHaveTextContent("ledger-svc");
  });
});

describe("ServicesContent -- states", () => {
  it("shows a no-services EmptyState when the API returns none", async () => {
    stubApi({ services: servicesFor([]) });
    renderWithProviders(<ServicesContent />, URL_PARAMS);

    expect(await screen.findByText(/no services/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps the table and adds a notice above it when every row is untagged", async () => {
    stubApi({
      services: servicesFor([
        row({ serviceName: "_untagged", teamId: "team-pay", cost: 5 }),
        row({ serviceName: "_untagged", teamId: "team-b", cost: 3 }),
      ]),
    });
    renderWithProviders(<ServicesContent />, URL_PARAMS);

    const table = await screen.findByRole("table");
    expect(dataRows(table)).toHaveLength(2);
    expect(within(table).getAllByText("Untagged")).toHaveLength(2);
    // SV-02: the notice is a status message, not an alert.
    expect(screen.getByRole("status")).toHaveTextContent(
      /no usage carries a service tag/i,
    );
    expect(screen.queryByText(/no services/i)).not.toBeInTheDocument();
  });

  it("shows no untagged notice when some rows carry a service tag", async () => {
    stubApi({ services: servicesFor() });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    await screen.findByRole("table");
    expect(
      screen.queryByText(/no usage carries a service tag/i),
    ).not.toBeInTheDocument();
  });

  it("shows 0.0% for every row when the total cost is zero", async () => {
    stubApi({
      services: servicesFor([
        row({ serviceName: "a", teamId: "t1", cost: 0 }),
        row({ serviceName: "b", teamId: "t2", cost: 0 }),
      ]),
    });
    renderWithProviders(<ServicesContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    const meters = within(table).getAllByRole("meter");
    expect(meters).toHaveLength(2);
    for (const m of meters) {
      expect(m).toHaveAttribute("aria-valuetext", "0.0%");
    }
  });

  it("shows an error with Retry, and Retry refetches", async () => {
    let fail = true;
    const stub = stubApi({
      services: () => (fail ? apiError(500) : apiResponse(servicesBody(ROWS))),
    });
    renderWithProviders(<ServicesContent />, URL_PARAMS);

    const retry = await screen.findByRole("button", { name: /retry/i });
    const before = stub.servicesRequests().length;
    fail = false;
    await userEvent.setup().click(retry);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(stub.servicesRequests().length).toBeGreaterThan(before);
  });

  it("shows a loading skeleton while the request is pending", () => {
    stubApi({ services: () => new Promise<Response>(() => {}) as never });
    const { container } = renderWithProviders(<ServicesContent />, URL_PARAMS);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});
