import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { AccountsTab } from "./AccountsTab";

// Source: Design System "Settings Page" (unit D, 2026-11-16: the AWS accounts
// tab holds the Account registry); implementation-phases Phase 4.9 (Verify: a
// non-admin sees the registry read-only); Rules 40.4 / 60.12 (the section in
// its own boundary: a failing registry shows its error, never breaks the page),
// 10.3 / 50.4 (admin determined on the server and passed down). Module under
// test: `components/settings/AccountsTab.tsx`
//   <AccountsTab isAdmin={boolean} />
// Moved from SettingsContent.test.tsx (the registry assertions) - see the
// migration list in the unit D report.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubAccounts(accounts: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/accounts") return accounts();
      throw new Error(`unexpected fetch ${path}`);
    }),
  );
}

describe("AccountsTab", () => {
  it("renders the Account registry heading", async () => {
    stubAccounts(() => apiResponse({ data: [] }));
    renderWithProviders(<AccountsTab isAdmin />);
    expect(
      await screen.findByRole("heading", { name: /account registry/i }),
    ).toBeInTheDocument();
  });

  it("isolates a failing registry in its own boundary", async () => {
    stubAccounts(() => apiError(500, "INTERNAL_ERROR", "boom"));
    renderWithProviders(<AccountsTab isAdmin={false} />);
    expect(await screen.findByText(/Couldn't load/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /account registry/i }),
    ).toBeInTheDocument();
  });

  it("passes isAdmin down: an admin gets Add account", async () => {
    stubAccounts(() => apiResponse({ data: [] }));
    renderWithProviders(<AccountsTab isAdmin />);
    expect(
      await screen.findByRole("button", { name: /add account/i }),
    ).toBeInTheDocument();
  });

  it("passes isAdmin down: no Add account for a non-admin", async () => {
    stubAccounts(() => apiResponse({ data: [] }));
    renderWithProviders(<AccountsTab isAdmin={false} />);
    await screen.findByRole("heading", { name: /account registry/i });
    expect(
      screen.queryByRole("button", { name: /add account/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render other Settings groups", async () => {
    stubAccounts(() => apiResponse({ data: [] }));
    renderWithProviders(<AccountsTab isAdmin />);
    await screen.findByRole("heading", { name: /account registry/i });
    for (const name of [/sync status/i, /data retention/i, /^litellm$/i]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
  });
});
