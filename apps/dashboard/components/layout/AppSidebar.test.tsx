import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

const mockUsePathname = vi.fn<() => string>();
const mockUseSearchParams = vi.fn<() => URLSearchParams>();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams(),
}));

function renderSidebar(pathname: string, search = "") {
  mockUsePathname.mockReturnValue(pathname);
  mockUseSearchParams.mockReturnValue(new URLSearchParams(search));
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

const NAV_TITLES = [
  "Overview",
  "Ranking",
  "Departments",
  "Teams",
  "Services",
  "Users",
  "Settings",
];

describe("AppSidebar", () => {
  it("renders all seven top-level navigation links", () => {
    renderSidebar("/dashboard");

    for (const title of NAV_TITLES) {
      expect(screen.getByRole("link", { name: title })).toBeInTheDocument();
    }
  });

  it("marks the link for the active nested route, not Overview", () => {
    renderSidebar("/dashboard/teams/team-123");

    expect(screen.getByRole("link", { name: "Teams" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("activates Overview only on the exact dashboard root", () => {
    renderSidebar("/dashboard");

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  // Issue #75 — the global date range must survive navigation between menus.
  it("carries the active date range onto every navigation link", () => {
    renderSidebar("/dashboard", "dateFrom=2026-01-01&dateTo=2026-01-31");

    for (const title of NAV_TITLES) {
      expect(screen.getByRole("link", { name: title })).toHaveAttribute(
        "href",
        expect.stringContaining("dateFrom=2026-01-01&dateTo=2026-01-31"),
      );
    }
  });

  it("leaves hrefs clean when no date range is in the URL", () => {
    renderSidebar("/dashboard");

    expect(screen.getByRole("link", { name: "Ranking" })).toHaveAttribute(
      "href",
      "/dashboard/ranking",
    );
  });

  it("renders a collapse toggle in the footer", () => {
    renderSidebar("/dashboard");

    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });
});

// shadcn's icon rail: a tooltip names each link while the rail is collapsed to
// icons, and never while it is expanded (the label is already visible). Desktop
// viewport (jsdom default, >= md). Pointer-out dismissal depends on Radix's
// grace area, which needs real layout, so it is covered in e2e/sidebar.spec.ts.
describe("AppSidebar - rail tooltips", () => {
  function renderRail(defaultOpen: boolean) {
    mockUsePathname.mockReturnValue("/dashboard");
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    return render(
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
      </SidebarProvider>,
    );
  }

  it("names a link in a tooltip on hover when collapsed", async () => {
    const user = userEvent.setup();
    renderRail(false);

    await user.hover(screen.getByRole("link", { name: "Ranking" }));

    expect(
      await screen.findByRole("tooltip", { name: "Ranking" }),
    ).toBeInTheDocument();
  });

  it("names the collapse toggle Expand on hover when collapsed", async () => {
    const user = userEvent.setup();
    renderRail(false);

    await user.hover(screen.getByRole("button", { name: "Collapse" }));

    expect(
      await screen.findByRole("tooltip", { name: "Expand" }),
    ).toBeInTheDocument();
  });

  it("names a link in a tooltip on keyboard focus and hides it on Escape", async () => {
    const user = userEvent.setup();
    renderRail(false);
    act(() => screen.getByRole("link", { name: "Overview" }).focus());

    await user.tab();

    expect(screen.getByRole("link", { name: "Ranking" })).toHaveFocus();
    expect(
      await screen.findByRole("tooltip", { name: "Ranking" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows no tooltip on hover when expanded", async () => {
    const user = userEvent.setup();
    renderRail(true);
    const link = screen.getByRole("link", { name: "Ranking" });

    await user.hover(link);

    // The hover registered on the trigger (Radix reflects it as data-state)...
    await waitFor(() =>
      expect(link.getAttribute("data-state")).toMatch(/-open$/),
    );
    // ...but the tooltip content stays hidden while the labels are visible.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows no tooltip on keyboard focus when expanded", async () => {
    const user = userEvent.setup();
    renderRail(true);
    act(() => screen.getByRole("link", { name: "Overview" }).focus());

    await user.tab();

    expect(screen.getByRole("link", { name: "Ranking" })).toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
