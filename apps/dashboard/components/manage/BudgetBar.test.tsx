import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BudgetBar } from "./BudgetBar";

// Sources: Design System - Management pages, *Budget as a bar* ("a thin
// `BudgetBar` under each member and team budget - neutral below 80%, warning
// from 80%, destructive at or above 100% - with the percentage as text beside
// it (colour is never the only signal; 'No limit' when there is no budget)");
// Rule 40.2 / 60.30 (semantic tokens only, no raw hex); slice B2 brief B2-5.
//
// Contract (components/manage/BudgetBar.tsx, named export):
//   props { spend: number; budget: number | null | undefined }.
//   With a positive budget: an element with role="progressbar" carrying
//   aria-valuenow (the percentage, capped at 100 for the fill), aria-valuemin 0,
//   aria-valuemax 100, an accessible name, and data-state of "neutral" (< 80%),
//   "warning" (80% to < 100%) or "destructive" (>= 100%); the rounded
//   percentage as visible text ("85%"; above 100% the real value, "120%").
//   With null, undefined or 0 budget: the text "No limit" and no progressbar.
const bar = () => screen.getByRole("progressbar");

describe("BudgetBar thresholds (Budget as a bar)", () => {
  it.each([
    [0, 100, "neutral", "0%"],
    [50, 100, "neutral", "50%"],
    [79, 100, "neutral", "79%"],
    [80, 100, "warning", "80%"],
    [99, 100, "warning", "99%"],
    [100, 100, "destructive", "100%"],
    [120, 100, "destructive", "120%"],
  ])("spend %s of %s is %s and reads %s", (spend, budget, state, text) => {
    render(<BudgetBar spend={spend} budget={budget} />);

    expect(bar()).toHaveAttribute("data-state", state);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("caps the fill at 100 for an overspent budget but keeps the real percentage as text", () => {
    render(<BudgetBar spend={250} budget={100} />);

    expect(bar()).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("250%")).toBeInTheDocument();
  });

  it("exposes the value to assistive technology, not colour alone", () => {
    render(<BudgetBar spend={85} budget={100} />);

    expect(bar()).toHaveAttribute("aria-valuemin", "0");
    expect(bar()).toHaveAttribute("aria-valuemax", "100");
    expect(bar()).toHaveAttribute("aria-valuenow", "85");
    expect(bar()).toHaveAccessibleName();
  });
});

describe("BudgetBar without a budget", () => {
  it.each([null, undefined, 0])(
    "budget %s reads 'No limit' and draws no bar",
    (budget) => {
      render(<BudgetBar spend={42} budget={budget} />);

      expect(screen.getByText("No limit")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    },
  );
});

describe("BudgetBar styling (Rule 40.2: tokens only)", () => {
  it("uses no raw hex colour", () => {
    const { container } = render(<BudgetBar spend={90} budget={100} />);

    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(container.innerHTML).not.toMatch(/style="[^"]*(rgb|#)/i);
  });
});
