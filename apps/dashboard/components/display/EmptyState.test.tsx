import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./EmptyState";

// Design System -- Component Inventory, `EmptyState`: "Reusable empty state
// with icon, message, and optional CTA". Implementation-phases Phase 4.2:
// "Tests: ... EmptyState rendering".
describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="No usage in this period" />);

    expect(screen.getByText("No usage in this period")).toBeInTheDocument();
  });

  it("renders the description when given", () => {
    render(
      <EmptyState
        title="No usage in this period"
        description="Try a wider date range."
      />,
    );

    expect(screen.getByText("Try a wider date range.")).toBeInTheDocument();
  });

  it("renders the action when given", () => {
    render(
      <EmptyState
        title="No usage in this period"
        action={<button type="button">Reset filters</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reset filters" }),
    ).toBeInTheDocument();
  });

  it("renders no button when no action is given", () => {
    render(<EmptyState title="No usage in this period" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides the icon from assistive technology", () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="No usage in this period" />,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  // Design System -- States / Component Inventory (2026-11-16): default is a
  // 32px icon with a 14px semibold title and a 13px description; size="sm" is
  // a one-line empty inside a table or Panel with a 16px left icon.
  it("sizes the default icon 32px with a semibold title", () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="No usage" description="Wider range." />,
    );

    expect(container.querySelector("svg")).toHaveClass("size-8");
    expect(screen.getByText("No usage")).toHaveClass(
      "text-sm",
      "font-semibold",
    );
    expect(screen.getByText("Wider range.")).toHaveClass("text-cell");
  });

  it('renders size="sm" as a compact row with a 16px icon', () => {
    const { container } = render(
      <EmptyState size="sm" icon={Inbox} title="No rows" />,
    );

    expect(container.querySelector("svg")).toHaveClass("size-4");
    expect(container.querySelector("svg")).not.toHaveClass("size-8");
    expect(container.firstElementChild).toHaveClass("flex-row");
    expect(container.firstElementChild?.className).not.toMatch(/\bpy-10\b/);
  });

  it('keeps the title, description and action in size="sm"', () => {
    render(
      <EmptyState
        size="sm"
        title="No rows"
        description="Nothing matched."
        action={<button type="button">Clear</button>}
      />,
    );

    expect(screen.getByText("No rows")).toBeInTheDocument();
    expect(screen.getByText("Nothing matched.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("renders without an icon, description or action", () => {
    render(<EmptyState title="Nothing here" />);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
