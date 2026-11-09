import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  apiResponse,
  NEVER,
  NEVER_SYNCED,
  stubApi,
  syncedFixture,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { SyncStatusPanel } from "./SyncStatusPanel";

// Source: implementation-phases Phase 4.9 (sync status: last run, status,
// accounts processed, duration, errors; reuses SyncStatusBadge/SyncCountdown);
// Data Model -- Entity: SyncStatus; Rule 20.9 (never synced is neutral, not an
// error), 60.17. Module under test: `components/settings/SyncStatusPanel.tsx`,
// a client component with no props reading GET /api/sync-status.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SyncStatusPanel", () => {
  it("shows status, accounts processed, duration and no errors for a clean run", async () => {
    stubApi({
      syncStatus: () =>
        apiResponse({
          data: syncedFixture({
            status: "success",
            accountsTotal: 5,
            accountsSuccess: 5,
            durationMs: 12_000,
          }),
        }),
    });
    renderWithProviders(<SyncStatusPanel />);

    expect(await screen.findByText(/5 of 5/)).toBeInTheDocument();
    expect(screen.getByText(/12\s?s/)).toBeInTheDocument();
    // The top bar owns the live region; the panel badge is a plain labelled
    // term so the page has no duplicate role="status" regions.
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryByLabelText(/^Sync status:/)).not.toBeInTheDocument();
    const statusTerm = screen.getByText("Last run status");
    expect(statusTerm.nextElementSibling).toHaveTextContent("Success");
    const failedTerm = screen.getByText("Failed");
    expect(failedTerm.nextElementSibling).toHaveTextContent("0");
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists per-account errors for a partial run", async () => {
    stubApi({
      syncStatus: () =>
        apiResponse({
          data: syncedFixture({
            status: "partial",
            accountsTotal: 5,
            accountsSuccess: 4,
            accountsFailed: 1,
            errors: [
              { accountId: "123456789012", message: "AssumeRole denied" },
            ],
          }),
        }),
    });
    renderWithProviders(<SyncStatusPanel />);

    expect(await screen.findByText(/4 of 5/)).toBeInTheDocument();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(
      screen.getByText("Last run status").nextElementSibling,
    ).toHaveTextContent("Partial");
    expect(screen.getByText("Failed").nextElementSibling).toHaveTextContent(
      "1",
    );
    const list = screen.getByRole("list", { name: /errors/i });
    expect(within(list).getByText(/123456789012/)).toBeInTheDocument();
    expect(within(list).getByText(/AssumeRole denied/)).toBeInTheDocument();
  });

  it("shows a neutral message, not an error, when never synced", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: NEVER_SYNCED }) });
    renderWithProviders(<SyncStatusPanel />);

    expect(
      await screen.findByText(/never synced|has not synced yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    stubApi({ syncStatus: NEVER });
    const { container } = renderWithProviders(<SyncStatusPanel />);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it("surfaces a request failure rather than hiding it", async () => {
    stubApi({ syncStatus: () => apiError(500, "INTERNAL_ERROR", "boom") });
    renderWithProviders(<SyncStatusPanel />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
