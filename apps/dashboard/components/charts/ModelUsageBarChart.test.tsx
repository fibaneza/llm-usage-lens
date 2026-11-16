import { screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderChart,
  seriesFills,
  srOnlyMatches,
  stubSizedResizeObserver,
  teardownChartTest,
} from "@/test/support/chart-test-utils";

import { ModelUsageBarChart } from "./ModelUsageBarChart";

// Source: Design System -- Team Detail Page ("Model usage breakdown: bar
// chart"); implementation-phases Phase 4.6 ("model usage bar chart (reuse
// Recharts, next/dynamic)"); Rule 40.2 (model tokens, no raw hex), 40.3 / 60.11
// (ResponsiveContainer). Contract: `slices` is the `ModelBreakdownSlice[]` from
// `toModelBreakdownSlices(byModel, 0)`; one bar per model, in the order given.
type Slices = ComponentProps<typeof ModelUsageBarChart>["slices"];

const slices: Slices = [
  {
    key: "claude-opus",
    label: "Claude Opus",
    cost: 412.34,
    colorVar: "--color-model-opus",
  },
  {
    key: "claude-haiku",
    label: "Claude Haiku",
    cost: 33.01,
    colorVar: "--color-model-haiku",
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  stubSizedResizeObserver();
});

afterEach(() => {
  teardownChartTest();
});

describe("ModelUsageBarChart", () => {
  it("renders inside a Recharts ResponsiveContainer", async () => {
    const { container } = await renderChart(
      <ModelUsageBarChart slices={slices} />,
    );

    expect(
      container.querySelector(".recharts-responsive-container"),
    ).not.toBeNull();
  });

  it("is a named image", async () => {
    await renderChart(<ModelUsageBarChart slices={slices} />);

    expect(
      screen.getByRole("img", { name: /model usage.*bar chart/i }),
    ).toBeInTheDocument();
  });

  it("draws one bar per model, filled with that model's CSS token", async () => {
    const { container } = await renderChart(
      <ModelUsageBarChart slices={slices} />,
    );

    const fills = seriesFills(container, ".recharts-rectangle");
    expect(fills).toHaveLength(2);
    expect(new Set(fills)).toEqual(
      new Set(["var(--color-model-opus)", "var(--color-model-haiku)"]),
    );
  });

  it("exposes model names and costs in a visually hidden copy", async () => {
    await renderChart(<ModelUsageBarChart slices={slices} />);

    expect(srOnlyMatches("Claude Opus").length).toBeGreaterThan(0);
    expect(srOnlyMatches("Claude Haiku").length).toBeGreaterThan(0);
    expect(srOnlyMatches(/412\.34/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/33\.01/).length).toBeGreaterThan(0);
  });

  it("keeps the screen-reader data outside the image role", async () => {
    await renderChart(<ModelUsageBarChart slices={slices} />);

    const image = screen.getByRole("img", { name: /model usage/i });
    for (const el of srOnlyMatches(/412\.34/)) {
      expect(image.contains(el)).toBe(false);
    }
  });

  it("shows an empty state instead of a blank chart when there are no models", async () => {
    await renderChart(<ModelUsageBarChart slices={[]} />);

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  // Phase 4.6: "Build ModelBadge ... and use it as the model usage bar chart's
  // legend". The legend lives inside the chart component.
  it("renders a 'Model legend' list with one ModelBadge per slice", async () => {
    await renderChart(<ModelUsageBarChart slices={slices} />);

    const legend = screen.getByRole("list", { name: /model legend/i });
    const items = within(legend).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Claude Opus");
    expect(items[1]).toHaveTextContent("Claude Haiku");
    expect(
      items[0]?.querySelector('[style*="var(--color-model-opus)"]'),
    ).not.toBeNull();
    expect(
      items[1]?.querySelector('[style*="var(--color-model-haiku)"]'),
    ).not.toBeNull();
  });

  it("renders no legend in the empty state", async () => {
    await renderChart(<ModelUsageBarChart slices={[]} />);

    expect(
      screen.queryByRole("list", { name: /model legend/i }),
    ).not.toBeInTheDocument();
  });
});
