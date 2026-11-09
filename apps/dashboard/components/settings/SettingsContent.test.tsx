import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse, NEVER_SYNCED } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { SettingsContent } from "./SettingsContent";

// Source: implementation-phases Phase 4.9; Rules 40.4 / 60.12 (each section in
// its own Suspense + ErrorBoundary: one failing section never breaks the
// page), 10.3 / 50.4 (admin determined server-side, passed down). Module under
// test: `components/settings/SettingsContent.tsx`,
// `SettingsContent({ isAdmin }: { isAdmin: boolean })`, composing
// AccountRegistry, SyncStatusPanel and DataRetention, each in a SectionBoundary.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubSettingsApi(accounts: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/accounts") return accounts();
      if (path === "/api/sync-status")
        return apiResponse({ data: NEVER_SYNCED });
      throw new Error(`unexpected fetch ${path}`);
    }),
  );
}

describe("SettingsContent", () => {
  it("renders the three sections with headings", async () => {
    stubSettingsApi(() => apiResponse({ data: [] }));
    renderWithProviders(<SettingsContent isAdmin />);
    expect(
      await screen.findByRole("heading", { name: /account registry/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /sync status/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /data retention/i }),
    ).toBeInTheDocument();
  });

  it("isolates a failing account registry from the other sections", async () => {
    stubSettingsApi(() => apiError(500, "INTERNAL_ERROR", "boom"));
    renderWithProviders(<SettingsContent isAdmin={false} />);
    expect(await screen.findByText(/Couldn't load/i)).toBeInTheDocument();
    expect(screen.getByText(/365 days/)).toBeInTheDocument();
    expect(
      await screen.findByText(/never synced|has not synced yet/i),
    ).toBeInTheDocument();
  });

  it("passes isAdmin down: no Add account for a non-admin", async () => {
    stubSettingsApi(() => apiResponse({ data: [] }));
    renderWithProviders(<SettingsContent isAdmin={false} />);
    await screen.findByRole("heading", { name: /account registry/i });
    expect(
      screen.queryByRole("button", { name: /add account/i }),
    ).not.toBeInTheDocument();
  });
});
