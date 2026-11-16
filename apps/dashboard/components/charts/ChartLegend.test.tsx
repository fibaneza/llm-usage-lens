import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartLegend } from "./ChartLegend";

// Design System -- Chart Colors (2026-11-16): legends are a custom swatch +
// foreground-text legend; series colour is never used as text colour (model
// colours failed 4.5:1); Rule 40.2 (tokens, no raw hex).
const items = [
  { key: "claude-opus", label: "Claude Opus", colorVar: "--color-model-opus" },
  {
    key: "nonModel",
    label: "Non-model charges",
    colorVar: "--color-cost-non-model",
  },
];

describe("ChartLegend", () => {
  it("lists one entry per series labelled by its name", () => {
    render(<ChartLegend items={items} />);

    const list = screen.getByRole("list", { name: "Chart legend" });
    const entries = within(list).getAllByRole("listitem");
    expect(entries.map((e) => e.textContent)).toEqual([
      "Claude Opus",
      "Non-model charges",
    ]);
  });

  it("draws a decorative swatch in the series token colour", () => {
    render(<ChartLegend items={items} />);

    const [first] = within(
      screen.getByRole("list", { name: "Chart legend" }),
    ).getAllByRole("listitem");
    const swatch = first?.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(swatch.style.backgroundColor).toBe("var(--color-model-opus)");
  });

  it("renders the label in the foreground colour, never the series colour", () => {
    render(<ChartLegend items={items} />);

    const label = screen.getByText("Claude Opus");
    expect(label).toHaveClass("text-foreground", "text-xs");
    expect(label.style.color).toBe("");
  });
});
