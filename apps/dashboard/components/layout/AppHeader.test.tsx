import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import type { NavScope } from "@/lib/nav";

import { AppHeader } from "./AppHeader";

// Source: Design System - Layout, Structure ("Sync badges by role (decided
// 2026-11-16, user): SyncStatusBadge and SyncCountdown render only for callers
// who see the Usage group ... for a team lead and a user they are absent. The
// DateRangePicker stays for every role"); slice B1 brief B1-1 (Usage
// visibility = scope.global) and B1-9. The composed pieces are stubbed to
// markers so this layer tests only which of them the header renders.
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { oid: "u", roles: [] } })),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/me",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/status/SyncStatusBadge", () => ({
  SyncStatusBadge: () => <div role="status" aria-label="Sync status" />,
}));
// RF1 (Design System - Component Inventory, RefreshButton): composed here;
// its own behaviour is tested in components/status/RefreshButton.test.tsx.
vi.mock("@/components/status/RefreshButton", () => ({
  RefreshButton: ({ syncStatus }: { syncStatus: boolean }) => (
    <button type="button" data-sync-status={String(syncStatus)}>
      Refresh data
    </button>
  ),
}));
vi.mock("@/components/status/SyncCountdown", () => ({
  SyncCountdown: () => <div role="timer" aria-label="Next sync" />,
}));
vi.mock("@/components/filters/DateRangePicker", () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}));
vi.mock("@/components/layout/CommandMenu", () => ({
  CommandMenu: () => <button type="button">Search</button>,
}));
vi.mock("@/components/layout/PageTitle", () => ({
  PageTitle: () => <h1>Page</h1>,
}));
vi.mock("./UserMenu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));
// M4 (LiteLLM spec - MG-D13): the bell is composed here; its own behaviour is
// tested in components/notifications/NotificationBell.test.tsx.
vi.mock("@/components/notifications/NotificationBell", () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}));

const scope = (over: Partial<NavScope> = {}): NavScope => ({
  global: false,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
  ...over,
});

async function renderHeader(s: NavScope) {
  render(<SidebarProvider>{await AppHeader({ scope: s })}</SidebarProvider>);
}

describe("AppHeader sync badges by role", () => {
  it("shows the sync badge and the countdown to a global caller", async () => {
    await renderHeader(scope({ global: true }));

    expect(screen.getByRole("status", { name: "Sync status" })).toBeVisible();
    expect(screen.getByRole("timer", { name: "Next sync" })).toBeVisible();
  });

  it.each([
    ["a team lead", scope({ teamScopes: new Set(["team-a"]) })],
    ["a department lead", scope({ departmentScopes: new Set(["dept-eng"]) })],
    ["a member", scope({ memberTeamId: "team-a" })],
    ["a viewer with no team", scope()],
  ])("hides the sync badge and the countdown from %s", async (_n, s) => {
    await renderHeader(s);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  // Design System - Layout (fail closed); Rule 10.3: no scope is the
  // non-global view.
  it("hides the sync badge and the countdown when no scope is given", async () => {
    render(<SidebarProvider>{await AppHeader()}</SidebarProvider>);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByTestId("date-range-picker")).toBeInTheDocument();
  });

  it.each([
    ["global", scope({ global: true })],
    ["non-global", scope({ memberTeamId: "team-a" })],
  ])(
    "keeps the date range, search, page title and user menu for a %s caller",
    async (_n, s) => {
      await renderHeader(s);

      expect(screen.getByTestId("date-range-picker")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Search" })).toBeVisible();
      expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
      expect(screen.getByTestId("user-menu")).toBeInTheDocument();
    },
  );

  // MG-D13: "A bell in the top bar"; notifications are for any signed-in role
  // (Access Control - role x operation, GET /api/notifications), so the bell is
  // not scope-gated like the sync badges.
  it.each([
    ["a global caller", scope({ global: true })],
    ["a team lead", scope({ teamScopes: new Set(["team-a"]) })],
    ["a member", scope({ memberTeamId: "team-a" })],
    ["a viewer with no team", scope()],
  ])("shows the notification bell to %s", async (_n, s) => {
    await renderHeader(s);

    expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible();
  });

  it("shows the notification bell when no scope is given", async () => {
    render(<SidebarProvider>{await AppHeader()}</SidebarProvider>);

    expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible();
  });
});

// T-RF1 (Design System - Caching Strategy, Refresh; Component Inventory -
// RefreshButton, D-R3-2): every signed-in caller gets the button, immediately
// before SyncCountdown where that is shown, otherwise in its place.
describe("AppHeader refresh button (T-RF1)", () => {
  it("shows the button to a global reader, with the sync status, right before the countdown", async () => {
    await renderHeader(scope({ global: true }));

    const button = screen.getByRole("button", { name: "Refresh data" });
    const countdown = screen.getByRole("timer", { name: "Next sync" });
    expect(button).toHaveAttribute("data-sync-status", "true");
    expect(button.nextElementSibling).toBe(countdown);
  });

  it.each([
    ["a team lead", scope({ teamScopes: new Set(["team-a"]) })],
    ["a member", scope({ memberTeamId: "team-a" })],
  ])("shows the button to %s, without the sync status", async (_n, s) => {
    await renderHeader(s);

    const button = screen.getByRole("button", { name: "Refresh data" });
    expect(button).toBeVisible();
    expect(button).toHaveAttribute("data-sync-status", "false");
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
