import { act, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  NEVER,
  NEVER_SYNCED,
  stubApi,
  syncedFixture,
} from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { SyncStatusSection } from "./SyncStatusSection";

// Source: implementation-phases Phase 4.1 section 5 ("Sync status with last
// update time and countdown"); Design System — Overview Page; Data Model —
// Entity: SyncStatus; Rule 20.1 (UTC, explicit); Rule 20.9 (a missing item is
// "never synced", not an error); Rule 60.24 (fake timers).
const NOW = new Date("2026-01-20T10:18:00.000Z");

function renderSection() {
  return renderWithProviders(
    <Suspense fallback={<div data-slot="skeleton" />}>
      <SyncStatusSection />
    </Suspense>,
  );
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

// Design System -- Control Patterns, Key-value lists: the synced state is a
// <dl>; the value paired with a term is its <dd>.
function definition(term: string): HTMLElement {
  const dt = screen.getByText(term, { selector: "dt" });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement) || dd.tagName !== "DD") {
    throw new Error(`no <dd> after the "${term}" term`);
  }
  return dd;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SyncStatusSection", () => {
  it("shows a skeleton while the status loads", () => {
    stubApi({ syncStatus: NEVER });
    const { container } = renderSection();

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the neutral 'No sync yet' message when no SyncStatus item exists", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: NEVER_SYNCED }) });
    renderSection();
    await settle();

    expect(screen.getByText(/no sync yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/next sync in/i)).not.toBeInTheDocument();
  });

  it("shows the run status, the last run time in explicit UTC, and the countdown", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: syncedFixture() }) });
    renderSection();
    await settle();

    expect(screen.getByText(/success/i)).toBeInTheDocument();
    expect(screen.getByText(/10:00.*UTC|UTC.*10:00/)).toBeInTheDocument();
    expect(definition("Next sync")).toHaveTextContent("in 42 min");
  });

  // Design System -- Control Patterns (Key-value lists), OV-11: status, last run
  // (a <time> in the mono face) and next sync read as a term/value list.
  it("lists Status, Last run and Next sync as a key-value list", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: syncedFixture() }) });
    renderSection();
    await settle();

    expect(definition("Status")).toHaveTextContent("Success");
    const lastRun = definition("Last run").querySelector("time");
    expect(lastRun).toHaveAttribute("datetime", "2026-01-20T10:00:00.000Z");
    expect(lastRun).toHaveTextContent(/10:00.*UTC|UTC.*10:00/);
    expect(lastRun).toHaveClass("font-mono");
    expect(definition("Next sync")).toHaveTextContent("in 42 min");
  });

  it.each([
    ["partial", /partial/i],
    ["error", /error/i],
  ] as const)(
    "shows a %s run as data, not as a failed section",
    async (status, pattern) => {
      stubApi({
        syncStatus: () => apiResponse({ data: syncedFixture({ status }) }),
      });
      renderSection();
      await settle();

      expect(screen.getByText(pattern)).toBeInTheDocument();
      expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
    },
  );

  it("counts the next sync down as time passes", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: syncedFixture() }) });
    renderSection();
    await settle();
    expect(definition("Next sync")).toHaveTextContent("in 42 min");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });

    expect(definition("Next sync")).toHaveTextContent("in 40 min");
  });

  describe("last run time is UTC regardless of the host timezone (Rule 20.1)", () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it.each(["America/Los_Angeles", "Pacific/Auckland"])(
      "in %s",
      async (tz) => {
        process.env.TZ = tz;
        stubApi({ syncStatus: () => apiResponse({ data: syncedFixture() }) });
        renderSection();
        await settle();

        const lastRun = screen.getByText(/10:00.*UTC|UTC.*10:00/);
        expect(lastRun).toBeInTheDocument();
      },
    );
  });
});
