import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PercentOfTotalBar } from "./PercentOfTotalBar";

// Design System -- Component Inventory, `PercentOfTotalBar`: "Inline bar showing
// proportion visually in ranking tables". `value` is a fraction 0-1. The bar is
// a meter (ARIA 1.2) with aria-valuenow on a 0-100 scale, one decimal, plus the
// visible "12.3%" text so the proportion is not conveyed by the bar alone. The
// fill uses the --color-primary token (Rule 40.2).
function meter(): HTMLElement {
  return screen.queryByRole("meter") ?? screen.getByRole("progressbar");
}

describe("PercentOfTotalBar", () => {
  it("exposes the percentage to assistive technology on a 0-100 scale", () => {
    render(<PercentOfTotalBar value={0.1234} />);

    const el = meter();
    expect(Number(el.getAttribute("aria-valuenow"))).toBe(12.3);
    expect(Number(el.getAttribute("aria-valuemin"))).toBe(0);
    expect(Number(el.getAttribute("aria-valuemax"))).toBe(100);
  });

  it("shows the percentage as visible text with one decimal", () => {
    render(<PercentOfTotalBar value={0.1234} />);

    expect(screen.getByText("12.3%")).toBeInTheDocument();
  });

  it("shows a whole-number share with a trailing .0", () => {
    render(<PercentOfTotalBar value={0.5} />);

    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(Number(meter().getAttribute("aria-valuenow"))).toBe(50);
  });

  it("shows an empty share as 0.0%", () => {
    render(<PercentOfTotalBar value={0} />);

    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(Number(meter().getAttribute("aria-valuenow"))).toBe(0);
  });

  it("shows a full share as 100.0%", () => {
    render(<PercentOfTotalBar value={1} />);

    expect(screen.getByText("100.0%")).toBeInTheDocument();
    expect(Number(meter().getAttribute("aria-valuenow"))).toBe(100);
  });

  it("clamps an out-of-range fraction to the 0-100 meter range", () => {
    const { rerender } = render(<PercentOfTotalBar value={1.5} />);
    expect(Number(meter().getAttribute("aria-valuenow"))).toBe(100);

    rerender(<PercentOfTotalBar value={-0.2} />);
    expect(Number(meter().getAttribute("aria-valuenow"))).toBe(0);
  });

  it("fills with the primary colour token and no raw hex", () => {
    const { container } = render(<PercentOfTotalBar value={0.25} />);

    expect(container.innerHTML).toMatch(/bg-primary|--color-primary/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
