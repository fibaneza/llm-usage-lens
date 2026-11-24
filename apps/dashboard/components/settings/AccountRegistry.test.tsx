import type { AccountMeta } from "@llm-usage-lens/shared";
import {
  CreateAccountRequestSchema,
  UpdateAccountPatchSchema,
} from "@llm-usage-lens/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { AccountRegistry } from "./AccountRegistry";

// Source: implementation-phases Phase 4.9 (account registry table; Add in a
// Dialog, Edit in a Sheet with immutable accountId, Deactivate behind a
// confirmation; forms validate with the shared Zod schemas; admin-only
// controls); Data Model -- AccountMetaSchema, CreateAccountInputSchema,
// UpdateAccountPatchSchema, API Routes (/api/accounts, /api/accounts/[id]);
// Rules 50.7 (collector is ap-southeast-2 only, Sydney), 60.15 (Route Handlers are the CRUD
// contract, no Server Actions), 60.17 (errors surface), 60.24.
// Module under test: `components/settings/AccountRegistry.tsx`, a client
// component `AccountRegistry({ isAdmin }: { isAdmin: boolean })` fetching
// GET /api/accounts via useAccounts.
function account(over: Partial<AccountMeta> = {}): AccountMeta {
  return {
    accountId: "123456789012",
    accountName: "Payments Prod",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    teamId: "team-pay",
    teamName: "Payments",
    region: "ap-southeast-2",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

const ACTIVE = account();
const INACTIVE = account({
  accountId: "111122223333",
  accountName: "Legacy Sandbox",
  active: false,
});

type Call = { method: string; path: string; body: unknown };

function stubAccounts(
  list: AccountMeta[],
  write: (call: Call) => Response = () => apiResponse({ data: ACTIVE }),
) {
  const calls: Call[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = init?.method ?? "GET";
    if (method === "GET") {
      expect(path).toBe("/api/accounts");
      return apiResponse({ data: list });
    }
    const call: Call = {
      method,
      path,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return write(call);
  });
  vi.stubGlobal("fetch", stub);
  return {
    writes: () => [...calls],
    listFetches: () =>
      stub.mock.calls.filter(
        ([, init]) => !init?.method || init.method === "GET",
      ).length,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AccountRegistry -- table", () => {
  it("lists every account, showing inactive ones as inactive", async () => {
    stubAccounts([ACTIVE, INACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin={false} />);
    const table = await screen.findByRole("table");

    const active = within(table).getByRole("row", { name: /Payments Prod/ });
    const inactive = within(table).getByRole("row", { name: /Legacy Sandbox/ });
    expect(within(active).getByText("123456789012")).toBeInTheDocument();
    expect(within(active).getByText("Engineering")).toBeInTheDocument();
    expect(within(active).getByText("Payments")).toBeInTheDocument();
    expect(within(active).getByText(/^Active$/)).toBeInTheDocument();
    expect(within(inactive).getByText(/^Inactive$/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no accounts", async () => {
    stubAccounts([]);
    renderWithProviders(<AccountRegistry isAdmin />);
    expect(await screen.findByText(/no accounts/i)).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const { container } = renderWithProviders(<AccountRegistry isAdmin />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});

describe("AccountRegistry -- admin gating", () => {
  it("renders no add/edit/deactivate controls for a non-admin", async () => {
    stubAccounts([ACTIVE, INACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin={false} />);
    await screen.findByRole("table");
    expect(
      screen.queryByRole("button", { name: /add account/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^edit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /deactivate/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the controls for an admin; inactive rows get no deactivate", async () => {
    stubAccounts([ACTIVE, INACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    await screen.findByRole("table");
    expect(
      screen.getByRole("button", { name: /add account/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Payments Prod" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deactivate Payments Prod" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Deactivate Legacy Sandbox" }),
    ).not.toBeInTheDocument();
  });
});

// D-ST5: the add form takes department and team names (no Department ID /
// Team ID inputs) and labels the typed number "AWS account ID".
describe("AccountRegistry -- add account", () => {
  async function openAdd() {
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: /add account/i }));
    const dialog = await screen.findByRole("dialog");
    return { user, dialog };
  }

  async function fill(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    values: Record<string, string>,
  ) {
    for (const [label, value] of Object.entries(values)) {
      await user.type(within(dialog).getByLabelText(label), value);
    }
  }

  it("shows field errors from the shared schema and sends nothing", async () => {
    const api = stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const { user, dialog } = await openAdd();

    await fill(user, dialog, { "AWS account ID": "123" });
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
    expect(within(dialog).getByLabelText("AWS account ID")).toBeInvalid();
    expect(within(dialog).getByLabelText("Account name")).toBeInvalid();
    expect(api.writes()).toHaveLength(0);
  });

  it("has no free-form region input and no active/timestamp fields", async () => {
    stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const { dialog } = await openAdd();
    expect(within(dialog).queryByLabelText(/region/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/active/i)).not.toBeInTheDocument();
  });

  it("POSTs a CreateAccountInput (region ap-southeast-2), closes and refetches the list", async () => {
    const api = stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const { user, dialog } = await openAdd();

    await fill(user, dialog, {
      "AWS account ID": "000000000000",
      "Account name": "New Account",
      "Department name": "Data Science",
      "Team name": "ML",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const [call] = api.writes();
    expect(call?.method).toBe("POST");
    expect(call?.path).toBe("/api/accounts");
    // D-ST5: the body is names + region, validated by the request schema.
    expect(CreateAccountRequestSchema.safeParse(call?.body).success).toBe(true);
    expect(call?.body).toMatchObject({
      accountId: "000000000000",
      accountName: "New Account",
      departmentName: "Data Science",
      teamName: "ML",
      region: "ap-southeast-2",
    });
    expect(call?.body).not.toHaveProperty("departmentId"); // D-ST5
    expect(call?.body).not.toHaveProperty("teamId");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(api.listFetches()).toBeGreaterThanOrEqual(2));
  });

  it("surfaces a server error (duplicate account) and keeps the dialog open", async () => {
    stubAccounts([ACTIVE], () =>
      apiError(400, "BAD_REQUEST", "Account already exists"),
    );
    renderWithProviders(<AccountRegistry isAdmin />);
    const { user, dialog } = await openAdd();
    await fill(user, dialog, {
      "AWS account ID": "123456789012",
      "Account name": "Dup",
      "Department name": "D",
      "Team name": "T",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(
      await within(dialog).findByText(/Account already exists/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("surfaces a 403 FORBIDDEN message", async () => {
    stubAccounts([ACTIVE], () =>
      apiError(403, "FORBIDDEN", "internal-admin role required"),
    );
    renderWithProviders(<AccountRegistry isAdmin />);
    const { user, dialog } = await openAdd();
    await fill(user, dialog, {
      "AWS account ID": "000000000000",
      "Account name": "N",
      "Department name": "D",
      "Team name": "T",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );
    expect(
      await within(dialog).findByText(/internal-admin role required/),
    ).toBeInTheDocument();
  });
});

describe("AccountRegistry -- non-API failures", () => {
  it("shows a generic readable message, not raw parser text, for a non-JSON error body", async () => {
    stubAccounts(
      [ACTIVE],
      () =>
        new Response("<html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    );
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: /add account/i }));
    const dialog = await screen.findByRole("dialog");
    for (const [label, value] of Object.entries({
      "AWS account ID": "123456789012",
      "Account name": "X",
      "Department name": "D",
      "Team name": "T",
    })) {
      await user.type(within(dialog).getByLabelText(label), value);
    }
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/request failed/i);
    expect(alert).not.toHaveTextContent(/JSON|Unexpected token|<html>/i);
  });

  it("shows the same generic message when the response is outside the envelope", async () => {
    stubAccounts([ACTIVE], () => apiResponse({ unexpected: true }));
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Deactivate Payments Prod" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/request failed/i);
    expect(alert).not.toHaveTextContent(/zod|invalid input|expected/i);
  });
});

describe("AccountRegistry -- edit account", () => {
  it("opens a Sheet with the account prefilled and accountId read-only", async () => {
    stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Edit Payments Prod" }),
    );
    const sheet = await screen.findByRole("dialog");

    const id = within(sheet).getByLabelText(/account id/i);
    expect(id).toHaveValue("123456789012");
    expect(id).toHaveAttribute("readonly");
    expect(within(sheet).getByLabelText("Account name")).toHaveValue(
      "Payments Prod",
    );
  });

  it("PATCHes only the changed fields to /api/accounts/<id> without accountId", async () => {
    const api = stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Edit Payments Prod" }),
    );
    const sheet = await screen.findByRole("dialog");

    const name = within(sheet).getByLabelText("Account name");
    await user.clear(name);
    await user.type(name, "Payments Renamed");
    await user.click(
      within(sheet).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const [call] = api.writes();
    expect(call?.method).toBe("PATCH");
    expect(call?.path).toBe("/api/accounts/123456789012");
    expect(call?.body).toEqual({ accountName: "Payments Renamed" });
    await waitFor(() => expect(api.listFetches()).toBeGreaterThanOrEqual(2));
  });

  it("shows a field error when a required field is cleared", async () => {
    const api = stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Edit Payments Prod" }),
    );
    const sheet = await screen.findByRole("dialog");
    await user.clear(within(sheet).getByLabelText("Account name"));
    await user.click(
      within(sheet).getByRole("button", { name: "Save changes" }),
    );

    expect(within(sheet).getByLabelText("Account name")).toBeInvalid();
    expect(api.writes()).toHaveLength(0);
  });

  // Design System - Add account (D-ST5), Edit: coordinator decision 2026-11-24
  //: Edit has the same Existing department / Existing team
  // picks as Add and PATCHes the picked ids (UpdateAccountPatchSchema); the
  // name fields follow the pick and are not free text (no rename of a shared
  // team from one account).
  it("Edit moves an account to another existing team and sends the picked ids", async () => {
    const other = account({
      accountId: "111122223333",
      accountName: "Billing Prod",
      departmentId: "dept-fin",
      departmentName: "Finance",
      teamId: "team-bill",
      teamName: "Billing",
    });
    const api = stubAccounts([ACTIVE, other]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Edit Payments Prod" }),
    );
    const sheet = await screen.findByRole("dialog");

    await user.selectOptions(
      within(sheet).getByLabelText(/existing department/i),
      "Finance",
    );
    await user.selectOptions(
      within(sheet).getByLabelText(/existing team/i),
      "Billing",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const [call] = api.writes();
    expect(call?.method).toBe("PATCH");
    expect(call?.path).toBe("/api/accounts/123456789012");
    expect(call?.body).toMatchObject({
      departmentId: "dept-fin",
      teamId: "team-bill",
    });
    expect(UpdateAccountPatchSchema.safeParse(call?.body).success).toBe(true);
  });

  // R2-B1: Design System - Add account (Existing team lists only the picked
  // department's teams, as on create, Q-B1) and Data Model - API Routes (the
  // PATCH takes departmentId/teamId; the UI keeps the pair consistent).
  const crossDept = () => [
    ACTIVE,
    account({
      accountId: "111122223333",
      accountName: "Fin Ledger Prod",
      departmentId: "dept-fin",
      departmentName: "Finance",
      teamId: "team-fin-ledger",
      teamName: "Ledger",
    }),
    account({
      accountId: "000000000000",
      accountName: "Sales Ledger Prod",
      departmentId: "dept-sales",
      departmentName: "Sales",
      teamId: "team-sales-ledger",
      teamName: "Ledger",
    }),
  ];

  async function openEditAndPickDepartment(department: string) {
    const api = stubAccounts(crossDept());
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Edit Payments Prod" }),
    );
    const sheet = await screen.findByRole("dialog");
    await user.selectOptions(
      within(sheet).getByLabelText(/existing department/i),
      department,
    );
    return { api, user, sheet };
  }

  it("Edit lists only the picked department's teams, with no duplicate names", async () => {
    const { sheet } = await openEditAndPickDepartment("Finance");
    const names = within(within(sheet).getByLabelText(/existing team/i))
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(names).toContain("Ledger");
    expect(names).not.toContain("Payments");
    expect(names.filter((n) => n === "Ledger")).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it("Edit cannot save a department-only change and sends nothing", async () => {
    const { api, user, sheet } = await openEditAndPickDepartment("Sales");
    const save = within(sheet).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(api.writes()).toHaveLength(0);
  });

  it("Edit sends the new department's teamId once a team in it is picked", async () => {
    const { api, user, sheet } = await openEditAndPickDepartment("Sales");
    await user.selectOptions(
      within(sheet).getByLabelText(/existing team/i),
      "Ledger",
    );
    const save = within(sheet).getByRole("button", { name: "Save changes" });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({
      departmentId: "dept-sales",
      teamId: "team-sales-ledger",
    });
  });

  it("Edit's department and team name inputs are not free text", async () => {
    stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Edit Payments Prod" }),
    );
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText(/^department name/i)).toHaveAttribute(
      "readonly",
    );
    expect(within(sheet).getByLabelText(/^team name/i)).toHaveAttribute(
      "readonly",
    );
  });
});

describe("AccountRegistry -- deactivate", () => {
  it("asks for confirmation, then DELETEs and refetches", async () => {
    const api = stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Deactivate Payments Prod" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Payments Prod/)).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const [call] = api.writes();
    expect(call?.method).toBe("DELETE");
    expect(call?.path).toBe("/api/accounts/123456789012");
    await waitFor(() => expect(api.listFetches()).toBeGreaterThanOrEqual(2));
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const api = stubAccounts([ACTIVE]);
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Deactivate Payments Prod" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.writes()).toHaveLength(0);
  });

  it("surfaces a server error from the delete", async () => {
    stubAccounts([ACTIVE], () => apiError(404, "NOT_FOUND", "Account gone"));
    renderWithProviders(<AccountRegistry isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Deactivate Payments Prod" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );
    expect(await within(dialog).findByText(/Account gone/)).toBeInTheDocument();
  });
});

// Sources: Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
// D-SR1, D-SR2)": the AWS accounts registry sorts in the browser with the one
// SortableHeader; the order is stable (ties keep the server's order) and
// survives a refetch; the sort lives in the URL (nuqs `sort`, `dir`). Contract:
// the sortable columns are Account ID (`accountId`), Name (`name`), Department
// (`department`), Team (`team`) and Status (`status`, Active before Inactive
// ascending); the Actions column is not sortable; with no (or an unknown) URL
// sort the table keeps the server's order and no header is active.
const reg = (
  accountId: string,
  accountName: string,
  departmentName: string,
  teamName: string,
  active = true,
) => account({ accountId, accountName, departmentName, teamName, active });

// Server order is deliberately not sorted by any column.
const SERVER = [
  reg("333333333333", "Charlie", "Operations", "Ops", true),
  reg("111111111111", "Alice", "Engineering", "Payments", false),
  reg("222222222222", "Bob", "Operations", "Growth", true),
  reg("444444444444", "Dora", "Engineering", "Payments", false),
];
const accountOrder = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[1]?.textContent);
const th = (name: string) => screen.getByRole("columnheader", { name });

describe("AccountRegistry sorting (unit SRT1; D-SR1)", () => {
  it("each data column is a SortableHeader button; Actions is not; the server order holds by default", async () => {
    stubAccounts(SERVER);
    renderWithProviders(<AccountRegistry isAdmin />);
    await screen.findByRole("table");
    for (const name of ["Account ID", "Name", "Department", "Team", "Status"]) {
      expect(within(th(name)).getByRole("button")).toBeInTheDocument();
      expect(th(name)).toHaveAttribute("aria-sort", "none");
    }
    expect(within(th("Actions")).queryByRole("button")).not.toBeInTheDocument();
    expect(accountOrder()).toEqual(["Charlie", "Alice", "Bob", "Dora"]);
  });

  it.each([
    ["accountId", "asc", "Account ID", ["Alice", "Bob", "Charlie", "Dora"]],
    ["accountId", "desc", "Account ID", ["Dora", "Charlie", "Bob", "Alice"]],
    ["name", "asc", "Name", ["Alice", "Bob", "Charlie", "Dora"]],
    // ties keep the server order in both directions
    ["department", "asc", "Department", ["Alice", "Dora", "Charlie", "Bob"]],
    ["department", "desc", "Department", ["Charlie", "Bob", "Alice", "Dora"]],
    ["team", "asc", "Team", ["Bob", "Charlie", "Alice", "Dora"]],
    ["status", "asc", "Status", ["Charlie", "Bob", "Alice", "Dora"]],
    ["status", "desc", "Status", ["Alice", "Dora", "Charlie", "Bob"]],
  ])(
    "the URL sort=%s dir=%s sets aria-sort on %s and orders the rows",
    async (sort, dir, header, expected) => {
      stubAccounts(SERVER);
      renderWithProviders(<AccountRegistry isAdmin />, {
        searchParams: { sort, dir },
      });
      await screen.findByRole("table");
      expect(th(header)).toHaveAttribute(
        "aria-sort",
        dir === "asc" ? "ascending" : "descending",
      );
      expect(accountOrder()).toEqual(expected);
    },
  );

  it("an unknown URL sort falls back to the server order with no active header", async () => {
    stubAccounts(SERVER);
    renderWithProviders(<AccountRegistry isAdmin />, {
      searchParams: { sort: "region", dir: "desc" },
    });
    await screen.findByRole("table");
    expect(accountOrder()).toEqual(["Charlie", "Alice", "Bob", "Dora"]);
    expect(th("Name")).toHaveAttribute("aria-sort", "none");
  });

  it("a header click sorts in the browser, flips on the second click and does not refetch", async () => {
    const u = userEvent.setup();
    const stub = stubAccounts(SERVER);
    renderWithProviders(<AccountRegistry isAdmin />);
    await screen.findByRole("table");
    const button = within(th("Name")).getByRole("button");
    await u.click(button);
    await waitFor(() =>
      expect(accountOrder()).toEqual(["Alice", "Bob", "Charlie", "Dora"]),
    );
    expect(th("Name")).toHaveAttribute("aria-sort", "ascending");
    await u.click(button);
    await waitFor(() =>
      expect(accountOrder()).toEqual(["Dora", "Charlie", "Bob", "Alice"]),
    );
    expect(th("Name")).toHaveAttribute("aria-sort", "descending");
    expect(stub.listFetches()).toBe(1);
  });

  it("a read-only caller sorts too (no Actions column, same headers)", async () => {
    stubAccounts(SERVER);
    renderWithProviders(<AccountRegistry isAdmin={false} />, {
      searchParams: { sort: "name", dir: "asc" },
    });
    await screen.findByRole("table");
    expect(th("Name")).toHaveAttribute("aria-sort", "ascending");
    expect(accountOrder()).toEqual(["Alice", "Bob", "Charlie", "Dora"]);
  });

  it("the sort survives a refetch: the new list arrives in the chosen order", async () => {
    const list = [...SERVER];
    const stub = stubAccounts(list);
    renderWithProviders(<AccountRegistry isAdmin />, {
      searchParams: { sort: "name", dir: "asc" },
    });
    await screen.findByRole("table");
    list.unshift(reg("555555555555", "Aaron", "Operations", "Ops"));
    window.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(stub.listFetches()).toBe(2));
    await waitFor(() =>
      expect(accountOrder()).toEqual([
        "Aaron",
        "Alice",
        "Bob",
        "Charlie",
        "Dora",
      ]),
    );
    expect(th("Name")).toHaveAttribute("aria-sort", "ascending");
  });
});
