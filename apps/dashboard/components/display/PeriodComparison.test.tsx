import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PeriodComparison } from "./PeriodComparison";

// Source: Design System -- Component Inventory, `PeriodComparison` ("vs
// previous 30 days" side-by-side stats); implementation-phases Phase 4.4;
// Rule 20 (a missing previous period shows no delta and no fake 0). Contract:
// `<PeriodComparison days={n} metrics={[{ label, current, previous, kind }]} />`
// where `kind` is "usd" ($1,234.50) or "count" (1,234,500).
const METRICS = [
  { label: "Total cost", current: 600, previous: 500, kind: "usd" as const },
  {
    label: "Invocations",
    current: 1_200,
    previous: 1_000,
    kind: "count" as const,
  },
];

function metric(label: string): HTMLElement {
  return screen.getByRole("group", { name: label });
}

describe("PeriodComparison", () => {
  it("is a labelled group with the 'vs previous N days' caption from the range length", () => {
    render(<PeriodComparison days={30} metrics={METRICS} />);

    expect(
      screen.getByRole("group", { name: /period comparison/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("vs previous 30 days")).toBeInTheDocument();
  });

  it("derives the caption from the given length, singular for one day", () => {
    const { rerender } = render(
      <PeriodComparison days={7} metrics={METRICS} />,
    );
    expect(screen.getByText("vs previous 7 days")).toBeInTheDocument();

    rerender(<PeriodComparison days={1} metrics={METRICS} />);
    expect(screen.getByText("vs previous 1 day")).toBeInTheDocument();
  });

  it("shows current and previous values side by side per metric, formatted by kind", () => {
    render(<PeriodComparison days={10} metrics={METRICS} />);

    const cost = metric("Total cost");
    expect(within(cost).getByText("$600.00")).toBeInTheDocument();
    expect(within(cost).getByText("$500.00")).toBeInTheDocument();
    const calls = metric("Invocations");
    expect(within(calls).getByText("1,200")).toBeInTheDocument();
    expect(within(calls).getByText("1,000")).toBeInTheDocument();
  });

  it("labels which value is current and which is previous", () => {
    render(<PeriodComparison days={10} metrics={METRICS} />);

    const cost = metric("Total cost");
    expect(within(cost).getByText(/current/i)).toBeInTheDocument();
    expect(within(cost).getByText(/previous/i)).toBeInTheDocument();
  });

  it("shows a DeltaBadge for the change", () => {
    render(<PeriodComparison days={10} metrics={METRICS} />);

    expect(
      within(metric("Total cost")).getByRole("img", {
        name: "Up 20.0% vs previous period",
      }),
    ).toBeInTheDocument();
  });

  it("shows a decrease as Down", () => {
    render(
      <PeriodComparison
        days={10}
        metrics={[
          { label: "Total cost", current: 50, previous: 100, kind: "usd" },
        ]}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Down 50.0% vs previous period" }),
    ).toBeInTheDocument();
  });

  it("shows no delta and a dash, never 0, when previous is null", () => {
    render(
      <PeriodComparison
        days={10}
        metrics={[
          { label: "Total cost", current: 600, previous: null, kind: "usd" },
        ]}
      />,
    );

    const cost = metric("Total cost");
    expect(within(cost).getByText("$600.00")).toBeInTheDocument();
    expect(within(cost).queryByRole("img")).not.toBeInTheDocument();
    expect(within(cost).getByText("—")).toBeInTheDocument();
    expect(cost.textContent).not.toMatch(/\$0\.00|NaN|Infinity|undefined|null/);
  });

  it("shows no delta when previous is 0 (but still shows the $0.00 value)", () => {
    render(
      <PeriodComparison
        days={10}
        metrics={[
          { label: "Total cost", current: 600, previous: 0, kind: "usd" },
        ]}
      />,
    );

    const cost = metric("Total cost");
    expect(within(cost).queryByRole("img")).not.toBeInTheDocument();
    expect(cost.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("renders no raw hex colour", () => {
    const { container } = render(
      <PeriodComparison days={10} metrics={METRICS} />,
    );

    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
