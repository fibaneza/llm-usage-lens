import { screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderChart,
  seriesFills,
  srOnlyMatches,
  stubSizedResizeObserver,
} from "@/test/chart-test-utils";

import { ModelBreakdownChart } from "./ModelBreakdownChart";

// Phase 4.1: donut of the model distribution; non-model cost is its own
// segment using `--color-cost-non-model`, never merged into `other`
// (Data Model spec -- Dashboard impact (v1); Rule 40.2, 40.3, 60.11).

type Slices = ComponentProps<typeof ModelBreakdownChart>["slices"];

const slices: Slices = [
  {
    key: "claude-opus",
    label: "Claude Opus",
    cost: 12.34,
    colorVar: "--color-model-opus",
  },
  {
    key: "other",
    label: "Other models",
    cost: 3.01,
    colorVar: "--color-model-other",
  },
  {
    key: "nonModel",
    label: "Non-model charges",
    cost: 7.89,
    colorVar: "--color-cost-non-model",
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  stubSizedResizeObserver();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ModelBreakdownChart", () => {
  it("renders inside a Recharts ResponsiveContainer", async () => {
    const { container } = await renderChart(
      <ModelBreakdownChart slices={slices} />,
    );

    expect(
      container.querySelector(".recharts-responsive-container"),
    ).not.toBeNull();
  });

  it("is a named image", async () => {
    await renderChart(<ModelBreakdownChart slices={slices} />);

    expect(
      screen.getByRole("img", { name: /model (distribution|breakdown)/i }),
    ).toBeInTheDocument();
  });

  it("draws one segment per slice, coloured by that slice's CSS variable token", async () => {
    const { container } = await renderChart(
      <ModelBreakdownChart slices={slices} />,
    );

    const fills = seriesFills(container, ".recharts-sector");
    expect(fills).toHaveLength(3);
    expect(new Set(fills)).toEqual(
      new Set([
        "var(--color-model-opus)",
        "var(--color-model-other)",
        "var(--color-cost-non-model)",
      ]),
    );
  });

  it("keeps non-model cost as its own segment, separate from other", async () => {
    const { container } = await renderChart(
      <ModelBreakdownChart slices={slices} />,
    );

    const fills = seriesFills(container, ".recharts-sector");
    expect(
      fills.filter((f) => f === "var(--color-cost-non-model)"),
    ).toHaveLength(1);
    expect(fills.filter((f) => f === "var(--color-model-other)")).toHaveLength(
      1,
    );
  });

  it("uses no raw hex colour on any segment", async () => {
    const { container } = await renderChart(
      <ModelBreakdownChart slices={slices} />,
    );

    for (const fill of seriesFills(container, ".recharts-sector")) {
      expect(fill).toMatch(/^var\(--color-[a-z-]+\)$/);
    }
  });

  it("exposes labels and values in a visually hidden copy for screen readers", async () => {
    await renderChart(<ModelBreakdownChart slices={slices} />);

    expect(srOnlyMatches("Claude Opus").length).toBeGreaterThan(0);
    expect(srOnlyMatches("Other models").length).toBeGreaterThan(0);
    expect(srOnlyMatches("Non-model charges").length).toBeGreaterThan(0);
    expect(srOnlyMatches(/12\.34/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/3\.01/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/7\.89/).length).toBeGreaterThan(0);
  });

  it("keeps the screen-reader data outside the image role so it stays reachable", async () => {
    await renderChart(<ModelBreakdownChart slices={slices} />);

    const image = screen.getByRole("img", {
      name: /model (distribution|breakdown)/i,
    });
    for (const el of srOnlyMatches(/12\.34/)) {
      expect(image.contains(el)).toBe(false);
    }
  });

  it("shows an empty state instead of a blank chart when there are no slices", async () => {
    await renderChart(<ModelBreakdownChart slices={[]} />);

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
  });
});
