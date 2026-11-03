import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  apiResponse,
  NEVER,
  NEVER_SYNCED,
  stubApi,
  syncedFixture,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { SyncCountdown } from "./SyncCountdown";

// WAI-ARIA timer pattern: a countdown is a `timer` (implicit aria-live="off",
// so it does not announce every tick), not a `status` live region. Until a sync
// exists it is the neutral "pending" state, never an error (Rule 20.9). Phase
// 4.1 connects it to SyncStatus.nextScheduledAt via useSyncStatus (Design
// System — Component Inventory: "Next sync in 42 min"). Time is faked so the
// countdown is deterministic (Rule 60.24).
const NOW = new Date("2026-01-20T10:18:00.000Z");
const minutesFromNow = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60_000).toISOString();

// Flush the stubbed request and TanStack Query's scheduled notification
// without moving the clock.
async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SyncCountdown when no sync has run", () => {
  beforeEach(() => {
    stubApi({ syncStatus: () => apiResponse({ data: NEVER_SYNCED }) });
  });

  it("is a timer named for the pending next sync", async () => {
    renderWithProviders(<SyncCountdown />);
    await settle();

    expect(
      screen.getByRole("timer", { name: "Next sync: pending" }),
    ).toBeInTheDocument();
  });

  it("is not a status live region", async () => {
    renderWithProviders(<SyncCountdown />);
    await settle();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not opt back in to live announcements", async () => {
    renderWithProviders(<SyncCountdown />);
    await settle();

    const countdown = screen.getByLabelText(/^Next sync/);
    expect(countdown.getAttribute("aria-live") ?? "off").toBe("off");
  });

  it("uses the same text for its aria-label and title", async () => {
    renderWithProviders(<SyncCountdown />);
    await settle();

    const countdown = screen.getByLabelText(/^Next sync/);
    expect(countdown.getAttribute("aria-label")).not.toBeNull();
    expect(countdown.getAttribute("title")).toBe(
      countdown.getAttribute("aria-label"),
    );
  });

  it("is neutral, not an error", async () => {
    renderWithProviders(<SyncCountdown />);
    await settle();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SyncCountdown while the sync status loads", () => {
  it("stays the neutral pending timer", () => {
    stubApi({ syncStatus: NEVER });
    renderWithProviders(<SyncCountdown />);

    expect(
      screen.getByRole("timer", { name: "Next sync: pending" }),
    ).toBeInTheDocument();
  });
});

describe("SyncCountdown after a sync", () => {
  it("counts down whole minutes to nextScheduledAt", async () => {
    stubApi({
      syncStatus: () =>
        apiResponse({
          data: syncedFixture({ nextScheduledAt: minutesFromNow(42) }),
        }),
    });
    renderWithProviders(<SyncCountdown />);
    await settle();

    const timer = screen.getByRole("timer", { name: "Next sync in 42 min" });
    expect(within(timer).getByText("Next sync in 42 min")).toBeInTheDocument();
  });

  it("keeps aria-label and title as one value while counting", async () => {
    stubApi({
      syncStatus: () =>
        apiResponse({
          data: syncedFixture({ nextScheduledAt: minutesFromNow(42) }),
        }),
    });
    renderWithProviders(<SyncCountdown />);
    await settle();

    const timer = screen.getByRole("timer");
    expect(timer.getAttribute("title")).toBe(timer.getAttribute("aria-label"));
    expect(timer.getAttribute("aria-live") ?? "off").toBe("off");
  });

  it("ticks down as time passes", async () => {
    stubApi({
      syncStatus: () =>
        apiResponse({
          data: syncedFixture({ nextScheduledAt: minutesFromNow(42) }),
        }),
    });
    renderWithProviders(<SyncCountdown />);
    await settle();
    expect(
      screen.getByRole("timer", { name: "Next sync in 42 min" }),
    ).toBeInTheDocument();

    await advance(60_000);
    expect(
      screen.getByRole("timer", { name: "Next sync in 41 min" }),
    ).toBeInTheDocument();

    await advance(10 * 60_000);
    expect(
      screen.getByRole("timer", { name: "Next sync in 31 min" }),
    ).toBeInTheDocument();
  });

  it("never shows a negative or non-numeric value once the next sync is overdue", async () => {
    stubApi({
      syncStatus: () =>
        apiResponse({
          data: syncedFixture({ nextScheduledAt: minutesFromNow(-5) }),
        }),
    });
    renderWithProviders(<SyncCountdown />);
    await settle();

    const label = screen.getByRole("timer").getAttribute("aria-label") ?? "";
    expect(label).not.toMatch(/-\d|NaN|undefined/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SyncCountdown when the status request fails", () => {
  it("falls back to the neutral pending timer rather than crashing", async () => {
    stubApi({ syncStatus: () => apiError(500) });
    renderWithProviders(<SyncCountdown />);
    await settle();

    expect(
      screen.getByRole("timer", { name: "Next sync: pending" }),
    ).toBeInTheDocument();
  });
});
