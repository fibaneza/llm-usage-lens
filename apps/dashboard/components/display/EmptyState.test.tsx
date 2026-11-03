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

  it("renders without an icon, description or action", () => {
    render(<EmptyState title="Nothing here" />);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
