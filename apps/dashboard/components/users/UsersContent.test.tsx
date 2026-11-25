import type { UserListRow } from "@llm-usage-lens/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  apiResponse,
  stubApi,
  userListRowFixture,
  usersBody,
} from "@/test/fakes/api-stubs";
import { orgShow } from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

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
    const initials = Array.from(
      bob.querySelectorAll('[aria-hidden="true"]'),
    ).find((el) => el.textContent === "BE");
    expect(initials).toBeDefined();
    // Neutral avatar: no per-user colour (Design System -- Avatar Colors,
    // amended 2026-11-16; Users Page).
    expect(initials?.getAttribute("style") ?? "").not.toContain(
      "--color-avatar-",
    );
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

  // Layout amended by M5 (Design System -- Source panels): the page description
  // is the PageHeader above the panels; the note leads the Bedrock panel.
  it("shows the model-usage-only note as a role=note inside the Bedrock panel, above the toolbar (Design System -- Users Page, 2026-11-16; M5)", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    await screen.findByRole("table");
    const bedrock = screen.getByRole("region", { name: "Bedrock" });
    const note = within(bedrock).getByRole("note");

    expect(note).toHaveTextContent(/model usage only/i);
    expect(
      note.compareDocumentPosition(screen.getByRole("searchbox")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// Design System -- Users Page (2026-11-16): "the toolbar has Search, Columns
// and Export CSV like Ranking"; SH-70, SH-73.
describe("UsersContent -- toolbar", () => {
  it("puts search, Columns and Export CSV in the table toolbar above the table", async () => {
    stubApi({ users: usersFor() });
    const view = renderWithProviders(<UsersContent />, URL_PARAMS);
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

  it("filters the rows by user id from the search box", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const table = await screen.findByRole("table");

    await userEvent.setup().type(screen.getByRole("searchbox"), "bob");

    await waitFor(() => expect(dataRows(table)).toHaveLength(1));
    expect(dataRows(table)[0]).toHaveTextContent("bob@example.com");
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

    // The Bedrock figure and the Bedrock panel are separate boundaries (D17),
    // so one failed read shows a Retry in each; use the panel's.
    const retry = await within(
      await screen.findByRole("region", { name: "Bedrock" }),
    ).findByRole("button", { name: /retry/i });
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

// Source: Design System - "Source panels on Cost by team, Cost by user and
// Cost by service" (D17 two panels labelled AWS-billed / LiteLLM-reported in
// their own boundaries; D18 three figures; Cost by user: the LiteLLM users
// list, 25 a page, one /user/list page per request (LD34); the range figure
// for one person moves to Management -> LiteLLM -> LiteLLM users, M5-D4);
// M5-D1 (model usage only); LT-MI4; implementation-phases M5 Verify.
// Supersedes the L6 note "Combined ... under Management -> Users".
describe("UsersContent -- source panels (M5)", () => {
  const DOWN = () => apiError(503, "LITELLM_UNAVAILABLE", "down");

  it("D17: a Bedrock region labelled AWS-billed holds the table, a LiteLLM region labelled LiteLLM-reported the LiteLLM users", async () => {
    stubApi({
      users: usersFor(),
      litellmUsers: () =>
        apiResponse({
          data: {
            users: [
              {
                key: "u-1",
                linkState: "unlinked",
                appUser: null,
                litellmUser: {
                  userId: "u-1",
                  email: "lite@example.test",
                  spend: 2,
                  maxBudget: null,
                  teams: [],
                },
              },
            ],
            page: 1,
            pageSize: 25,
            hasMore: false,
            enabledOperations: [],
          },
        }),
    });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const bedrock = await screen.findByRole("region", { name: "Bedrock" });
    const litellm = await screen.findByRole("region", { name: "LiteLLM" });
    expect(within(bedrock).getByText("AWS-billed")).toBeVisible();
    expect(await within(bedrock).findByRole("table")).toBeVisible();
    expect(within(bedrock).queryByText("lite@example.test")).toBeNull();
    expect(within(litellm).getByText("LiteLLM-reported")).toBeVisible();
    expect(await within(litellm).findByText("lite@example.test")).toBeVisible();
    expect(within(litellm).queryByText("alice@example.com")).toBeNull();
  });

  // Design System - LiteLLM client requests, T-FX4: the default stub answer must
  // mount the panel, not its error boundary.
  it("D17 + T-FX4: with the default stub the LiteLLM region renders its panel (empty state and pointer), not an error", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const litellm = await screen.findByRole("region", { name: "LiteLLM" });
    expect(await within(litellm).findByText("No LiteLLM users")).toBeVisible();
    expect(
      within(litellm).getByRole("link", {
        name: "Management → LiteLLM → LiteLLM users",
      }),
    ).toBeVisible();
    expect(within(litellm).queryByRole("alert")).toBeNull();
  });

  it("M5-D4: the old 'Management → Users' note is gone; the pointer is in the LiteLLM panel", async () => {
    stubApi({
      users: usersFor(),
      litellmUsers: () =>
        apiResponse({
          data: {
            users: [],
            page: 1,
            pageSize: 25,
            hasMore: false,
            enabledOperations: [],
          },
        }),
    });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    await screen.findByRole("table");
    expect(
      screen.queryByRole("link", { name: "Management → Users" }),
    ).toBeNull();
    const litellm = await screen.findByRole("region", { name: "LiteLLM" });
    expect(
      await within(litellm).findByRole("link", {
        name: "Management → LiteLLM → LiteLLM users",
      }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/users");
  });

  it("M5-D1 + D18: the Bedrock figure is the table's model-usage total ($100.00); Combined is the server's combined (LT-MI4)", async () => {
    stubApi({
      users: usersFor(),
      combinedOrganisation: () => apiResponse({ data: orgShow() }),
    });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const bedrock = await screen.findByTestId("source-figure-bedrock");
    await waitFor(() => expect(bedrock).toHaveTextContent("$100.00"));
    expect(bedrock).toHaveTextContent(/model usage only/i);
    expect(
      within(await screen.findByTestId("source-figure-combined")).getByTestId(
        "combined-total",
      ),
    ).toHaveTextContent("$16.20");
  });

  it("makes exactly one combined request (the figures) and none per row (LD34)", async () => {
    const stub = stubApi({
      users: usersFor(),
      combinedOrganisation: () => apiResponse({ data: orgShow() }),
    });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    await screen.findByTestId("source-figure-combined");
    expect(stub.combinedRequests().map((u) => u.pathname)).toEqual([
      "/api/litellm/combined/organisation",
    ]);
  });

  it("D17 outage: every LiteLLM read at 503 leaves the Bedrock figure and table working", async () => {
    stubApi({
      users: usersFor(),
      combinedOrganisation: DOWN,
      litellmUsers: DOWN,
    });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const bedrock = await screen.findByRole("region", { name: "Bedrock" });
    expect(await within(bedrock).findByRole("table")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId("source-figure-bedrock")).toHaveTextContent(
        "$100.00",
      ),
    );
  });

  // Review m5-r1 Q-B1: per-user cost is a proportional estimate (Rule 20.3), so
  // the headline figure that sums it carries the mark.
  it("Q-B1 + Rule 20.3: the Bedrock figure carries the Estimated mark", async () => {
    stubApi({ users: usersFor() });
    renderWithProviders(<UsersContent />, URL_PARAMS);
    const bedrock = await screen.findByTestId("source-figure-bedrock");
    await waitFor(() => expect(bedrock).toHaveTextContent("$100.00"));
    expect(bedrock).toHaveTextContent(/estimated/i);
  });
});
