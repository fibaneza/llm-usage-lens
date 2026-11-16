import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse, NEVER_SYNCED } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { SyncTab } from "./SyncTab";

// Source: Design System "Settings Page" (unit D, 2026-11-16: the Sync and data
// tab holds Sync status and Data retention); Data Model / Rule 20.9 (a missing
// SyncStatus item is the "never synced" state); Rules 40.4 / 60.12 (one failing
// section never breaks the other). Module under test:
// `components/settings/SyncTab.tsx`   <SyncTab />
// Moved from SettingsContent.test.tsx (the sync and retention assertions).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubSync(sync: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/sync-status") return sync();
      throw new Error(`unexpected fetch ${path}`);
    }),
  );
}

describe("SyncTab", () => {
  it("renders the Sync status and Data retention sections", async () => {
    stubSync(() => apiResponse({ data: NEVER_SYNCED }));
    renderWithProviders(<SyncTab />);
    expect(
      await screen.findByRole("heading", { name: /sync status/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /data retention/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/365 days/)).toBeInTheDocument();
  });

  it("shows the neutral never-synced message, not an error", async () => {
    stubSync(() => apiResponse({ data: NEVER_SYNCED }));
    renderWithProviders(<SyncTab />);
    expect(
      await screen.findByText(/never synced|has not synced yet/i),
    ).toBeInTheDocument();
  });

  it("isolates a failing sync status from Data retention", async () => {
    stubSync(() => apiError(500, "INTERNAL_ERROR", "boom"));
    renderWithProviders(<SyncTab />);
    expect(await screen.findByText(/Couldn't load/i)).toBeInTheDocument();
    expect(screen.getByText(/365 days/)).toBeInTheDocument();
  });

  it("does not render the Account registry or other groups", async () => {
    stubSync(() => apiResponse({ data: NEVER_SYNCED }));
    renderWithProviders(<SyncTab />);
    await screen.findByRole("heading", { name: /sync status/i });
    expect(
      screen.queryByRole("heading", { name: /account registry/i }),
    ).not.toBeInTheDocument();
  });
});
