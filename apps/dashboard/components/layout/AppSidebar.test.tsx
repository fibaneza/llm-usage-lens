import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

const mockUsePathname = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

function renderSidebar(pathname: string) {
  mockUsePathname.mockReturnValue(pathname);
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

  it("renders a collapse toggle in the footer", () => {
    renderSidebar("/dashboard");

    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });
});
