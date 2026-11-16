import { render, screen, within } from "@testing-library/react";
import { DollarSign } from "lucide-react";
import { describe, expect, it } from "vitest";

import { MetricCard } from "./MetricCard";

// Design System -- Component Inventory, `MetricCard`: KPI card with value,
// trend indicator, icon (custom, on the shadcn Card). Values use the numeric
// face (JetBrains Mono -- Design System typography / Rule 40.7).
function card(name: string) {
  return (
    screen.queryByRole("group", { name }) ??
    screen.getByRole("region", { name })
  );
}

describe("MetricCard", () => {
  it("shows the title and the value", () => {
    render(
      <MetricCard title="Total Cost" value="$1,234.56" icon={DollarSign} />,
    );

    const el = card("Total Cost");
    expect(within(el).getByText("Total Cost")).toBeInTheDocument();
    expect(within(el).getByText("$1,234.56")).toBeInTheDocument();
  });

  it("is a group or region labelled by its title", () => {
    render(<MetricCard title="Total Tokens" value="9.1M" icon={DollarSign} />);

    expect(card("Total Tokens")).toBeInTheDocument();
  });

  it("renders the value in the monospace numeric face", () => {
    render(
      <MetricCard title="Total Cost" value="$1,234.56" icon={DollarSign} />,
    );

    expect(screen.getByText("$1,234.56").className).toMatch(/font-mono/);
  });

  // Design System -- Component Inventory, `MetricCard` / Layout KPI rows
  // (amended 2026-11-16): 12px label, one 20px value (`--text-kpi`) with the
  // delta inline, 12px footnote, 12px vertical and 16px horizontal padding.
  it("uses the 20px KPI value size, not text-2xl", () => {
    render(
      <MetricCard title="Total Cost" value="$1,234.56" icon={DollarSign} />,
    );

    const value = screen.getByText("$1,234.56");
    expect(value).toHaveClass("text-kpi");
    expect(value).not.toHaveClass("text-2xl");
  });

  it("shows a 12px muted label and a 12px footnote", () => {
    render(
      <MetricCard
        title="Total Cost"
        value="$1.00"
        icon={DollarSign}
        description={<span>footnote</span>}
      />,
    );

    expect(screen.getByText("Total Cost")).toHaveClass(
      "text-xs",
      "text-muted-foreground",
    );
    expect(screen.getByText("footnote").parentElement).toHaveClass("text-xs");
  });

  it("pads 12px vertically and 16px horizontally", () => {
    const { container } = render(
      <MetricCard title="Total Cost" value="$1.00" icon={DollarSign} />,
    );

    const cardEl = container.querySelector('[data-slot="card"]');
    expect(cardEl?.className).toMatch(/(^|\s)py-(3|card-tight)(\s|$)/);
    expect(cardEl?.className).toMatch(/(^|\s)px-(4|card)(\s|$)/);
  });

  it("places the trend inline with the value in the same row", () => {
    render(
      <MetricCard
        title="Total Cost"
        value="$1.00"
        icon={DollarSign}
        trend={<span>+3%</span>}
      />,
    );

    expect(screen.getByText("$1.00").parentElement).toContainElement(
      screen.getByText("+3%"),
    );
  });

  it("renders the trend slot when given", () => {
    render(
      <MetricCard
        title="Total Cost"
        value="$1,234.56"
        icon={DollarSign}
        trend={<span>trend slot content</span>}
      />,
    );

    expect(
      within(card("Total Cost")).getByText("trend slot content"),
    ).toBeInTheDocument();
  });

  it("renders the description slot when given", () => {
    render(
      <MetricCard
        title="Total Cost"
        value="$1,234.56"
        icon={DollarSign}
        description={<span>Model $1,000.00 · Non-model $234.56</span>}
      />,
    );

    expect(
      within(card("Total Cost")).getByText(
        "Model $1,000.00 · Non-model $234.56",
      ),
    ).toBeInTheDocument();
  });

  it("renders only the title and value when the optional slots are omitted", () => {
    render(<MetricCard title="Active Accounts" value="12" icon={DollarSign} />);

    const el = card("Active Accounts");
    expect(el).toHaveTextContent("Active Accounts");
    expect(el).toHaveTextContent("12");
    expect(within(el).queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps the icon decorative so the title and value carry the meaning", () => {
    const { container } = render(
      <MetricCard title="Total Cost" value="$1,234.56" icon={DollarSign} />,
    );

    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("is built on the shadcn Card", () => {
    const { container } = render(
      <MetricCard title="Total Cost" value="$1,234.56" icon={DollarSign} />,
    );

    expect(container.querySelector('[data-slot="card"]')).not.toBeNull();
  });

  it("distinguishes several cards on one page by their titles", () => {
    render(
      <>
        <MetricCard title="Total Cost" value="$10.00" icon={DollarSign} />
        <MetricCard title="Total Tokens" value="5K" icon={DollarSign} />
      </>,
    );

    expect(within(card("Total Cost")).getByText("$10.00")).toBeInTheDocument();
    expect(within(card("Total Tokens")).getByText("5K")).toBeInTheDocument();
  });
});
