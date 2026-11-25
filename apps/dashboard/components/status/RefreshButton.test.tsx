import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { apiResponse, syncedFixture } from "@/test/fakes/api-stubs";

import { RefreshButton } from "./RefreshButton";

// Sources: Design System - Caching Strategy, Refresh (T-RF1, T-RF2) and
// Component Inventory - RefreshButton (aria-label, tooltip text, 32px control,
// 44px touch target below md, spin and aria-disabled/aria-busy while fetching (U-W1), no spin under
// prefers-reduced-motion); Rule 60.24 (no real network).
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

type Call = { path: string; cacheControl: string | null };
let calls: Call[];
let gate: Promise<void> | null;

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const path = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ path, cacheControl: headers.get("cache-control") });
      if (gate) await gate;
      if (path.includes("/api/sync-status")) {
        return apiResponse({ data: syncedFixture() });
      }
      return apiResponse({ data: { n: 1 } });
    }),
  );
}

function Mounted({ keyName, path }: { keyName: string; path: string }) {
  useQuery({
    queryKey: [keyName],
    queryFn: async () => {
      const res = await fetch(path);
      return ((await res.json()) as { data: unknown }).data;
    },
    staleTime: Infinity,
  });
  return null;
}

function setup(syncStatus: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {syncStatus ? (
          <Mounted keyName="sync-status" path="/api/sync-status" />
        ) : null}
        <Mounted keyName="overview" path="/api/overview" />
        <Mounted keyName="teams" path="/api/teams" />
        <RefreshButton syncStatus={syncStatus} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  refresh.mockClear();
  gate = null;
  stubFetch();
  mockReducedMotion(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(initialCalls: number) {
  await waitFor(() => {
    expect(calls.length).toBe(initialCalls);
  });
  calls.length = 0;
}

describe("RefreshButton - T-RF1 (Design System - Component Inventory, RefreshButton)", () => {
  it("is an icon-only button named 'Refresh data'", () => {
    setup(true);
    expect(screen.getByRole("button", { name: "Refresh data" })).toBeVisible();
  });

  it("shows the tooltip text on focus", async () => {
    setup(true);
    await settle(3);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Refresh data" }),
      ).not.toHaveAttribute("aria-busy", "true");
    });
    await userEvent.tab();
    expect(
      await screen.findByRole("tooltip", {
        name: /Reload the data on this page\. The next sync from AWS runs on schedule\./,
      }),
    ).toBeInTheDocument();
  });

  it("is a 32px control on desktop and a 44px touch target below md", () => {
    setup(true);
    const button = screen.getByRole("button", { name: "Refresh data" });
    expect(button).toHaveClass("size-8");
    expect(button).toHaveClass("max-md:min-h-touch", "max-md:min-w-touch");
  });
});

describe("RefreshButton - T-RF2 (Design System - Caching Strategy, Refresh)", () => {
  it("with the sync status: one no-cache sync-status request, every other query once, one page refresh", async () => {
    setup(true);
    await settle(3);

    await userEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    await waitFor(() => {
      expect(calls).toHaveLength(3);
    });
    const sync = calls.filter((c) => c.path.includes("/api/sync-status"));
    expect(sync).toHaveLength(1);
    expect(sync[0]?.cacheControl).toContain("no-cache");
    expect(calls.filter((c) => c.path.includes("/api/overview"))).toHaveLength(
      1,
    );
    expect(calls.filter((c) => c.path.includes("/api/teams"))).toHaveLength(1);
    expect(
      calls
        .filter((c) => !c.path.includes("/api/sync-status"))
        .every((c) => !c.cacheControl?.includes("no-cache")),
    ).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("without the sync status: every query once, no sync-status request, one page refresh", async () => {
    setup(false);
    await settle(2);

    await userEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls.some((c) => c.path.includes("/api/sync-status"))).toBe(false);
    expect(calls.filter((c) => c.path.includes("/api/overview"))).toHaveLength(
      1,
    );
    expect(calls.filter((c) => c.path.includes("/api/teams"))).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("is aria-disabled and aria-busy (never natively disabled) and the icon spins while fetching (U-W1)", async () => {
    setup(true);
    await settle(3);
    let release: () => void = () => {};
    gate = new Promise<void>((r) => {
      release = r;
    });

    await userEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    const button = screen.getByRole("button", { name: "Refresh data" });
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-disabled", "true");
    });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toBeDisabled();
    expect(button.querySelector("svg")).toHaveClass("animate-spin");

    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy", "true");
    });
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    expect(button.querySelector("svg")).not.toHaveClass("animate-spin");
  });

  it("ignores a click while busy and keeps focus on the button (U-W1; WCAG 2.4.3)", async () => {
    setup(true);
    await settle(3);
    let release: () => void = () => {};
    gate = new Promise<void>((r) => {
      release = r;
    });
    const button = screen.getByRole("button", { name: "Refresh data" });

    await userEvent.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    expect(button).toHaveFocus();
    const sent = calls.length;
    await userEvent.click(button);
    expect(calls).toHaveLength(sent);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(button).toHaveFocus();

    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy", "true");
    });
    expect(button).toHaveFocus();
  });

  it("a visually hidden status reads 'Refreshing…' while busy, then 'Updated' (U-W1; WCAG 4.1.3)", async () => {
    setup(true);
    await settle(3);
    let release: () => void = () => {};
    gate = new Promise<void>((r) => {
      release = r;
    });
    const status = screen.getByRole("status");
    expect(status).toHaveClass("sr-only");
    expect(status).toHaveTextContent("");

    await userEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    await waitFor(() => {
      expect(status).toHaveTextContent("Refreshing…");
    });

    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(status).toHaveTextContent("Updated");
    });
  });

  it("does not spin under prefers-reduced-motion", async () => {
    mockReducedMotion(true);
    setup(true);
    await settle(3);
    gate = new Promise<void>(() => {});

    await userEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    const button = screen.getByRole("button", { name: "Refresh data" });
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    expect(button.querySelector("svg")).not.toHaveClass("animate-spin");
  });
});
