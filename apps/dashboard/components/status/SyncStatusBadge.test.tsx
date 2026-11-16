import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  apiResponse,
  NEVER,
  NEVER_SYNCED,
  stubApi,
  syncedFixture,
} from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { SyncStatusBadge } from "./SyncStatusBadge";

// A missing SyncStatus item is the neutral "never synced" state, announced as
// a polite `status` region — not an alert (Rule 20.9). Phase 4.1 connects the
// badge to SyncStatus via useSyncStatus: a present item shows its run status
// (Design System — Component Inventory: "Last sync time + status indicator").
afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("SyncStatusBadge when no sync has run", () => {
  it("is a status named for the never-synced state", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: NEVER_SYNCED }) });
    renderWithProviders(<SyncStatusBadge />);

    expect(
      await screen.findByRole("status", { name: "Sync status: no sync yet" }),
    ).toBeInTheDocument();
  });

  it("is neutral, not an alert", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: NEVER_SYNCED }) });
    renderWithProviders(<SyncStatusBadge />);
    await screen.findByRole("status", { name: "Sync status: no sync yet" });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses the same text for its aria-label and title", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: NEVER_SYNCED }) });
    renderWithProviders(<SyncStatusBadge />);

    const badge = await screen.findByLabelText(/^Sync status/);
    expect(badge.getAttribute("aria-label")).not.toBeNull();
    expect(badge.getAttribute("title")).toBe(badge.getAttribute("aria-label"));
  });
});

describe("SyncStatusBadge while the sync status loads", () => {
  it("is a neutral status, not an alert", async () => {
    stubApi({ syncStatus: NEVER });
    renderWithProviders(<SyncStatusBadge />);
    await settle();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SyncStatusBadge after a sync", () => {
  // Design System -- Component Inventory: SyncStatusBadge = "Last sync time +
  // status indicator". The last run time is in explicit UTC (Rule 20.1); the
  // fixture's lastRunAt is 10:00 UTC. A date prefix before the time is allowed.
  it.each([
    ["success", /^Sync status: success, last run (?:.+ )?10:00 UTC$/],
    ["partial", /^Sync status: partial, last run (?:.+ )?10:00 UTC$/],
    ["error", /^Sync status: error, last run (?:.+ )?10:00 UTC$/],
  ] as const)(
    "names the %s run status and the last run time in UTC",
    async (status, pattern) => {
      stubApi({
        syncStatus: () => apiResponse({ data: syncedFixture({ status }) }),
      });
      renderWithProviders(<SyncStatusBadge />);

      const badge = await screen.findByRole("status", { name: pattern });
      expect(badge.getAttribute("title")).toBe(
        badge.getAttribute("aria-label"),
      );
    },
  );

  it("no longer reads as never synced once an item exists", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: syncedFixture() }) });
    renderWithProviders(<SyncStatusBadge />);

    await screen.findByRole("status", { name: /success/i });
    expect(
      screen.queryByRole("status", { name: "Sync status: no sync yet" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the badge a status region, never an alert, even for a failed run", async () => {
    stubApi({
      syncStatus: () =>
        apiResponse({ data: syncedFixture({ status: "error" }) }),
    });
    renderWithProviders(<SyncStatusBadge />);

    await screen.findByRole("status", { name: /error/i });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SyncStatusBadge when the status request fails", () => {
  it("renders without crashing and stays a status region", async () => {
    stubApi({ syncStatus: () => apiError(500) });
    renderWithProviders(<SyncStatusBadge />);
    await settle();

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("SyncStatusBadge last run time is UTC regardless of the host timezone (Rule 20.1)", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each(["America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata"])(
    "in %s",
    async (tz) => {
      process.env.TZ = tz;
      stubApi({
        syncStatus: () =>
          apiResponse({
            data: syncedFixture({ lastRunAt: "2026-01-20T10:00:00.000Z" }),
          }),
      });
      renderWithProviders(<SyncStatusBadge />);

      const badge = await screen.findByRole("status", {
        name: /^Sync status: success, last run /,
      });
      expect(badge.getAttribute("aria-label")).toMatch(/10:00 UTC$/);
      expect(badge.getAttribute("title")).toBe(
        badge.getAttribute("aria-label"),
      );
    },
  );
});

describe("SyncStatusBadge when no sync has run keeps its exact label", () => {
  it("has no last-run text", async () => {
    stubApi({ syncStatus: () => apiResponse({ data: NEVER_SYNCED }) });
    renderWithProviders(<SyncStatusBadge />);

    const badge = await screen.findByRole("status", {
      name: "Sync status: no sync yet",
    });
    expect(badge.getAttribute("aria-label")).toBe("Sync status: no sync yet");
    expect(badge.getAttribute("title")).toBe("Sync status: no sync yet");
  });
});

// Design System -- UX Standards: "Contrast 4.5:1 minimum" (Rule 60.30).
// `--color-success` is 3.77:1 and `--color-warning` about 3.2:1 on the card, so
// the visible status word uses a foreground token and only the non-text icon
// (3:1, WCAG 1.4.11) carries the success/warning/destructive tone -- the
// pattern DeltaBadge follows.
describe("SyncStatusBadge status text contrast", () => {
  const TONE_ON_TEXT = /(^|\s)text-(success|warning|destructive)(\/\d+)?(\s|$)/;

  it.each([
    ["success", "Success", /(text|stroke)-success/],
    ["partial", "Partial", /(text|stroke)-warning/],
    ["error", "Error", /(text|stroke)-destructive/],
  ] as const)(
    "keeps the tone token off the visible %s text and on the icon only",
    async (status, text, iconTone) => {
      stubApi({
        syncStatus: () => apiResponse({ data: syncedFixture({ status }) }),
      });
      renderWithProviders(<SyncStatusBadge />);

      const root = await screen.findByRole("status", {
        name: new RegExp(`^Sync status: ${status}`),
      });
      const word = screen.getByText(text, { exact: true });
      const chain: HTMLElement[] = [];
      for (
        let el: HTMLElement | null = word;
        el !== null;
        el = el === root ? null : el.parentElement
      ) {
        chain.push(el);
      }
      const classes = chain.map((el) => el.getAttribute("class") ?? "");

      expect(chain[chain.length - 1]).toBe(root);
      for (const cls of classes) {
        expect(cls).not.toMatch(TONE_ON_TEXT);
      }
      expect(
        classes.some((cls) =>
          /(^|\s)text-(foreground|muted-foreground)(\s|$)/.test(cls),
        ),
      ).toBe(true);

      const icon = root.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("class")).toMatch(iconTone);
    },
  );
});
