import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PageTabs } from "./PageTabs";

// Design System -- Layout, Tabs vs secondary navigation and Component
// Inventory, `PageTabs` (2026-11-16): URL-bound peer-view tabs over shadcn
// Tabs; the caller owns the nuqs state. Behaviour kept from the Ranking tabs
// (design-plan section 2.3): `aria-label` on the list, arrow-key navigation,
// panel id for aria-controls.
type Tab = "departments" | "teams" | "services";

const items = [
  { value: "departments", label: "Departments" },
  { value: "teams", label: "Teams", badge: <span>3</span> },
  { value: "services", label: "Services" },
] satisfies { value: Tab; label: string; badge?: React.ReactNode }[];

function renderTabs(value: Tab = "departments") {
  const onValueChange = vi.fn<(value: Tab) => void>();
  render(
    <PageTabs<Tab>
      label="Ranking by"
      value={value}
      onValueChange={onValueChange}
      items={items}
      panelId="ranking-tabpanel"
    >
      <p>the body</p>
    </PageTabs>,
  );
  return onValueChange;
}

describe("PageTabs", () => {
  it("is a tablist named by label with one tab per item, the value selected", () => {
    renderTabs("teams");

    const list = screen.getByRole("tablist", { name: "Ranking by" });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /Teams/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Departments" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("renders the badge inside its tab", () => {
    renderTabs();

    expect(screen.getByRole("tab", { name: /Teams/ })).toHaveTextContent("3");
  });

  it("renders one tabpanel with the given id around the children", () => {
    renderTabs();

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "ranking-tabpanel");
    expect(panel).toHaveTextContent("the body");
  });

  it("reports the value of a clicked tab", async () => {
    const user = userEvent.setup();
    const onValueChange = renderTabs();

    await user.click(screen.getByRole("tab", { name: "Services" }));

    expect(onValueChange).toHaveBeenCalledWith("services");
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    const onValueChange = renderTabs();

    await user.click(screen.getByRole("tab", { name: "Departments" }));
    onValueChange.mockClear();
    await user.keyboard("{ArrowRight}");

    expect(onValueChange).toHaveBeenCalledWith("teams");
  });

  // Design System -- Tabs: 36px strip, never wraps, scrolls horizontally on
  // narrow screens; focus ring from the focus-ring token.
  it("keeps the strip on one scrollable line with a visible focus ring", () => {
    renderTabs();

    const list = screen.getByRole("tablist", { name: "Ranking by" });
    expect(list).toHaveClass("overflow-x-auto", "flex-nowrap");
    expect(list).not.toHaveClass("flex-wrap");
    expect(
      screen.getByRole("tab", { name: "Departments" }).className,
    ).toContain("focus-visible:ring-focus-ring");
  });
});
