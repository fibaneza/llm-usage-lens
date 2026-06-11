import { render, screen } from "@testing-library/react";
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
