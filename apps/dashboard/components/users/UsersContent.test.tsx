import type { UserListRow } from "@llm-usage-lens/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  apiResponse,
  stubApi,
  userListRowFixture,
  usersBody,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { UsersContent } from "./UsersContent";

// Source: implementation-phases Phase 4.8 (users table: User, Team, Department,
// Cost, Tokens, Invocations, % of Total; Team links to the team detail page;
// EmptyState); Data Model -- `UsersResponseSchema` (one row per team and user,
// decided 2026-11-06) and "Non-model cost is account-level only" (model-usage
// note); Design System -- Users Page, *Avatar Colors (Per User)*; Rules 20.3,
// 40.4, 60.12, 60.17, 60.24. Module under test:
// `components/users/UsersContent.tsx`, a client component with no props that
// reads the date range from the URL via nuqs and fetches /api/users.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const URL_PARAMS = { searchParams: RANGE };

const row = userListRowFixture;

const ROWS: UserListRow[] = [
  row({
    userId: "alice@example.com",
    teamId: "team-pay",
    teamName: "Payments",
    cost: 60,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
  }),
  row({
    userId: "bob@example.com",
    teamId: "team a/b",
    teamName: "Odd Id",
    departmentId: "dept-fin",
    departmentName: "Finance",
    cost: 30,
  }),
  row({
    userId: "alice@example.com",
    teamId: "team-ledger",
    teamName: "Ledger",
    cost: 10,
  }),
];

const usersFor =
  (all: UserListRow[] = ROWS) =>
  () =>
    apiResponse(usersBody(all));

function dataRows(table: HTMLElement): HTMLElement[] {
  return within(table)
    .getAllByRole("row")
    .filter((r) => within(r).queryAllByRole("cell").length > 0);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("UsersContent -- table", () => {
  it("renders the seven columns and one row per team and user", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const table = await screen.findByRole("table");

    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim() ?? "");
    for (const name of [
      /^User/,
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
    const alicePay = rows.find((r) => r.textContent?.includes("Payments"));
    expect(alicePay).toHaveTextContent("alice@example.com");
    expect(alicePay).toHaveTextContent("Engineering");
    expect(within(alicePay as HTMLElement).getByText("1.5M")).toHaveAttribute(
      "title",
      "1,500,000",
    );
  });

  it("renders a decorative UserAvatar with initials in every row", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    for (const r of dataRows(table)) {
      const avatar = r.querySelector('[aria-hidden="true"]');
      expect(avatar).not.toBeNull();
    }
    const bob = dataRows(table).find((r) =>
      r.textContent?.includes("bob@example.com"),
    ) as HTMLElement;
    expect(
      Array.from(bob.querySelectorAll('[aria-hidden="true"]')).some(
        (el) => el.textContent === "BE",
      ),
    ).toBe(true);
  });

  it("requests /api/users with the URL date range", async () => {
    const stub = stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    await screen.findByRole("table");
    expect(
      stub
        .usersRequests()
        .every(
          (u) =>
            u.searchParams.get("dateFrom") === RANGE.dateFrom &&
            u.searchParams.get("dateTo") === RANGE.dateTo,
        ),
    ).toBe(true);
  });

  it("computes % of Total as row cost over the sum of all rows", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    const meters = within(table).getAllByRole("meter");
    expect(meters.map((m) => m.getAttribute("aria-valuetext")).sort()).toEqual([
      "10.0%",
      "30.0%",
      "60.0%",
    ]);
  });

  it("marks every cost as an estimate", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    for (const r of dataRows(table)) {
      expect(r.textContent).toMatch(/est/i);
    }
  });

  it("links each team to its detail page, carrying the date range", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
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
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const table = await screen.findByRole("table");
    const cost = screen.getByRole("columnheader", { name: /^Cost/ });
    expect(cost).toHaveAttribute("aria-sort", "descending");
    expect(dataRows(table)[0]).toHaveTextContent("Payments");

    await userEvent.setup().click(within(cost).getByRole("button"));
    expect(cost).toHaveAttribute("aria-sort", "ascending");
    expect(dataRows(table)[0]).toHaveTextContent("Ledger");
  });

  it("shows the model-usage-only note", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    await screen.findByRole("table");
    expect(screen.getByRole("note")).toHaveTextContent(/model usage only/i);
  });
});

describe("UsersContent -- states", () => {
  it("shows a no-users EmptyState when the API returns none", async () => {
    stubApi({ users: usersFor([]) });
    renderWithProviders(<UsersContent />, URL_PARAMS);

    expect(await screen.findByText(/no users/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows 0.0% for every row when the total cost is zero", async () => {
    stubApi({
      users: usersFor([
        row({ userId: "a@x.com", teamId: "t1", cost: 0 }),
        row({ userId: "b@x.com", teamId: "t2", cost: 0 }),
      ]),
    });
    renderWithProviders(<UsersContent />, URL_PARAMS);
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
      users: () => (fail ? apiError(500) : apiResponse(usersBody(ROWS))),
    });
    renderWithProviders(<UsersContent />, URL_PARAMS);

    const retry = await screen.findByRole("button", { name: /retry/i });
    const before = stub.usersRequests().length;
    fail = false;
    await userEvent.setup().click(retry);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(stub.usersRequests().length).toBeGreaterThan(before);
  });

  it("shows a loading skeleton while the request is pending", () => {
    stubApi({ users: () => new Promise<Response>(() => {}) as never });
    const { container } = renderWithProviders(<UsersContent />, URL_PARAMS);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});
