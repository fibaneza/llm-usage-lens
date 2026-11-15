import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { NAV_GROUPS } from "@/lib/nav";
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

function renderRail(defaultOpen: boolean) {
  mockUsePathname.mockReturnValue("/dashboard");
  mockUseSearchParams.mockReturnValue(new URLSearchParams());
  return render(
    <SidebarProvider defaultOpen={defaultOpen}>
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

    await user.hover(screen.getByRole("button", { name: "Expand" }));

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

// WCAG 4.1.2 Name, Role, Value (Rule 60.30): the footer toggle's accessible name
// must describe the action pressing it performs, not a fixed label. On the
// desktop rail that action flips with the rail state; the tooltip repeats the
// same word. useIsMobile reads window.innerWidth (md breakpoint is 768), so pin
// a wide desktop viewport (design-system - Layout, breakpoints).
describe("AppSidebar - rail toggle accessible name (desktop, 1440px)", () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1440,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalWidth,
    });
  });

  it("is named Collapse while the rail is expanded", () => {
    renderRail(true);

    expect(screen.getByRole("button", { name: "Collapse" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Expand" }),
    ).not.toBeInTheDocument();
  });

  it("is named Expand while the rail is collapsed to icons", () => {
    renderRail(false);

    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse" }),
    ).not.toBeInTheDocument();
  });

  it("repeats its accessible name in the tooltip when collapsed", async () => {
    const user = userEvent.setup();
    renderRail(false);
    const toggle = screen.getByRole("button", { name: "Expand" });

    await user.hover(toggle);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(/^Expand$/);
    expect(toggle).toHaveAccessibleName("Expand");
  });

  it("shows no tooltip while expanded, so the visible label is the name", async () => {
    const user = userEvent.setup();
    renderRail(true);
    const toggle = screen.getByRole("button", { name: "Collapse" });

    await user.hover(toggle);

    await waitFor(() =>
      expect(toggle.getAttribute("data-state")).toMatch(/-open$/),
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renames itself with each press: Collapse, then Expand, then Collapse", async () => {
    const user = userEvent.setup();
    renderRail(true);

    await user.click(screen.getByRole("button", { name: "Collapse" }));

    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand" }));

    expect(screen.getByRole("button", { name: "Collapse" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Expand" }),
    ).not.toBeInTheDocument();
  });

  // Design System — Layout → Structure: the product name shown is "LLM Usage
  // Lens".
  it("brands the sidebar LLM Usage Lens, with the home link named accordingly", () => {
    renderSidebar("/dashboard");

    const brand = screen.getByRole("link", {
      name: "LLM Usage Lens — go to overview",
    });
    expect(brand).toHaveAttribute("href", "/dashboard");
    expect(brand).toHaveTextContent("LLM Usage Lens");
    expect(screen.queryByText("Bedrock Cost")).not.toBeInTheDocument();
  });
});

// Source: docs/specs/2026-11-10-litellm.md -- Page and Settings and LD9: a
// "LiteLLM" rail item at /dashboard/litellm in a new "Gateway" group placed
// after Attribution; the top-bar heading is "LiteLLM usage & administration".
describe("AppSidebar - Gateway group (LD9)", () => {
  it("renders a LiteLLM link to /dashboard/litellm under a Gateway label", () => {
    renderSidebar("/dashboard");

    expect(screen.getByText("Gateway")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LiteLLM" })).toHaveAttribute(
      "href",
      "/dashboard/litellm",
    );
  });

  it("orders the Gateway group directly after Attribution with the page title", () => {
    const labels = NAV_GROUPS.map((group) => group.label);
    expect(labels.indexOf("Gateway")).toBe(labels.indexOf("Attribution") + 1);
    const item = NAV_GROUPS.find((g) => g.label === "Gateway")?.items[0];
    expect(item?.pageTitle).toBe("LiteLLM usage & administration");
  });
});
