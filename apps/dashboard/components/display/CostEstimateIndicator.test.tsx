import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CostEstimateIndicator } from "./CostEstimateIndicator";

// Design System -- Component Inventory, CostEstimateIndicator: the default badge
// reads "Estimated"; the compact form shows "Est." for tight table cells while
// the full word stays in the accessible name and the title (Rule 20.3).
describe("CostEstimateIndicator", () => {
  it("shows the full word 'Estimated' by default", () => {
    render(<CostEstimateIndicator />);

    expect(screen.getByText("Estimated")).toBeVisible();
    expect(screen.queryByText("Est.")).not.toBeInTheDocument();
    expect(screen.getByTitle(/^Estimated/)).toBeInTheDocument();
  });

  it("shows a visible 'Est.' when compact and keeps 'Estimated' for assistive tech and the title", () => {
    render(<CostEstimateIndicator compact />);

    const short = screen.getByText("Est.");
    expect(short).toBeVisible();
    expect(short).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expect(screen.getByTitle(/^Estimated/)).toBeInTheDocument();
  });
});
