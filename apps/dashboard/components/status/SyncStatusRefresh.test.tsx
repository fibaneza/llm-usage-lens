import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiResponse, stubApi, syncedFixture } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { SyncCountdown } from "./SyncCountdown";
import { SyncStatusBadge } from "./SyncStatusBadge";

// Design System -- Caching Strategy: SyncStatus is cached for 5 minutes, so the
// header badge and countdown must refresh it rather than show the first
// response forever. The badge and countdown share one query, as they do in the
// header. Time is faked (Rule 60.24).
const NOW = new Date("2026-01-20T10:18:00.000Z");
const FIVE_MINUTES = 5 * 60_000;

const FIRST_RUN = syncedFixture(); // last run 10:00, next 11:00 (42 min away)
const OVERDUE = syncedFixture({
  lastRunAt: "2026-01-20T09:00:00.000Z",
  nextScheduledAt: "2026-01-20T10:13:00.000Z",
});
const REFRESHED = syncedFixture({
  lastRunAt: "2026-01-20T10:20:00.000Z",
  nextScheduledAt: "2026-01-20T11:20:00.000Z",
});

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

function renderHeaderPair(first: ReturnType<typeof syncedFixture>) {
  let calls = 0;
  const api = stubApi({
    syncStatus: () => {
      calls += 1;
      return apiResponse({ data: calls === 1 ? first : REFRESHED });
    },
  });
  renderWithProviders(
    <>
      <SyncStatusBadge />
      <SyncCountdown />
    </>,
  );
  return api;
}

describe("sync status refresh", () => {
  it("makes one request for the badge and countdown together, then waits", async () => {
    const api = renderHeaderPair(FIRST_RUN);
    await advance(0);

    expect(
      screen.getByRole("timer", { name: "Next sync in 42 min" }),
    ).toBeInTheDocument();
    expect(api.syncStatusCalls()).toBe(1);

    await advance(4 * 60_000);
    expect(api.syncStatusCalls()).toBe(1);
  });

  it("requests the status again after 5 minutes and shows the newer schedule", async () => {
    const api = renderHeaderPair(FIRST_RUN);
    await advance(0);
    expect(api.syncStatusCalls()).toBe(1);

    await advance(FIVE_MINUTES + 1_000);

    expect(api.syncStatusCalls()).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("timer", { name: "Next sync in 57 min" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: /^Sync status: success, last run (?:.+ )?10:20 UTC$/,
      }),
    ).toBeInTheDocument();
  });

  it("refreshes an overdue countdown within 5 minutes without polling every second", async () => {
    const api = renderHeaderPair(OVERDUE);
    await advance(0);
    expect(
      screen.getByRole("timer", { name: "Next sync in 0 min" }),
    ).toBeInTheDocument();

    await advance(FIVE_MINUTES + 1_000);

    expect(api.syncStatusCalls()).toBeGreaterThanOrEqual(2);
    expect(api.syncStatusCalls()).toBeLessThan(10);
    expect(
      screen.getByRole("timer", { name: "Next sync in 57 min" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
