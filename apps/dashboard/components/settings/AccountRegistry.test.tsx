import type { AccountMeta } from "@bedrock-usage/shared";
import { CreateAccountInputSchema } from "@bedrock-usage/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

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

    await fill(user, dialog, { "Account ID": "123" });
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
    expect(within(dialog).getByLabelText("Account ID")).toBeInvalid();
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
      "Account ID": "000000000000",
      "Account name": "New Account",
      "Department ID": "dept-data",
      "Department name": "Data Science",
      "Team ID": "team-ml",
      "Team name": "ML",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const [call] = api.writes();
    expect(call?.method).toBe("POST");
    expect(call?.path).toBe("/api/accounts");
    expect(CreateAccountInputSchema.safeParse(call?.body).success).toBe(true);
    expect(call?.body).toMatchObject({
      accountId: "000000000000",
      accountName: "New Account",
      region: "ap-southeast-2",
    });
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
      "Account ID": "123456789012",
      "Account name": "Dup",
      "Department ID": "d",
      "Department name": "D",
      "Team ID": "t",
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
      apiError(403, "FORBIDDEN", "Admin role required"),
    );
    renderWithProviders(<AccountRegistry isAdmin />);
    const { user, dialog } = await openAdd();
    await fill(user, dialog, {
      "Account ID": "000000000000",
      "Account name": "N",
      "Department ID": "d",
      "Department name": "D",
      "Team ID": "t",
      "Team name": "T",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );
    expect(
      await within(dialog).findByText(/Admin role required/),
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
      "Account ID": "123456789012",
      "Account name": "X",
      "Department ID": "d",
      "Department name": "D",
      "Team ID": "t",
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

    const id = within(sheet).getByLabelText("Account ID");
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
    await user.clear(within(sheet).getByLabelText("Team name"));
    await user.click(
      within(sheet).getByRole("button", { name: "Save changes" }),
    );

    expect(within(sheet).getByLabelText("Team name")).toBeInvalid();
    expect(api.writes()).toHaveLength(0);
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
