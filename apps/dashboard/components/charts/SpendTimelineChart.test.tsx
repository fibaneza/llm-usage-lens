import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactElement } from "react";
import type { Tooltip, XAxis } from "recharts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderChart,
  seriesFills,
  stubSizedResizeObserver,
  teardownChartTest,
} from "@/test/support/chart-test-utils";

import { SpendTimelineChart } from "./SpendTimelineChart";

// Sources: Design System -- LiteLLM Organisation spend chart (unit OC1,
// T-OC3) and Component Inventory -> SpendTimelineChart: one bar slot per UTC
// day of the range, a bar only for reported days, several series stacked,
// colours from tokens (Rule 40.2), role="img" label, ChartEmptyState with no
// data, no animation under reduced motion. Rule 40.3 / 60.11 (Recharts in
// ResponsiveContainer).
// Records the props the chart gives Recharts' XAxis and Tooltip, then renders
// the real components (jsdom draws no tick text and cannot hover).
const captured = vi.hoisted(() => ({
  xAxis: [] as ComponentProps<typeof XAxis>[],
  tooltip: [] as ComponentProps<typeof Tooltip>[],
}));
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    XAxis: (props: ComponentProps<typeof actual.XAxis>) => {
      captured.xAxis.push(props);
      return <actual.XAxis {...props} />;
    },
    Tooltip: (props: ComponentProps<typeof actual.Tooltip>) => {
      captured.tooltip.push(props);
      return <actual.Tooltip {...props} />;
    },
  };
});

function tooltipHeading(day: string): string | null | undefined {
  const content = captured.tooltip.at(-1)?.content;
  if (typeof content !== "function") return undefined;
  const element = content({
    active: true,
    label: day,
    payload: [],
  } as unknown as Parameters<typeof content>[0]) as ReactElement;
  const { container } = render(element);
  return container.querySelector("p")?.textContent;
}

const DAYS = ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];
const usd = (n: number) => `$${n.toFixed(2)}`;

const one = (values: Record<string, number>) => [
  { key: "total", label: "Spend", colorVar: "--color-primary", values },
];

function rects(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<SVGElement>(".recharts-bar-rectangle rect"),
  ).filter((r) => r.getAttribute("fill") !== null);
}
const num = (el: Element, attr: string) => Number(el.getAttribute(attr));

beforeEach(() => {
  vi.useFakeTimers();
  stubSizedResizeObserver();
});
afterEach(() => {
  teardownChartTest();
});

describe("SpendTimelineChart (T-OC3)", () => {
  it("T-OC3: draws a bar only for reported days; a day with no value has no bar", async () => {
    const { container } = await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={one({ "2026-11-14": 10, "2026-11-17": 30 })}
        format={usd}
        label="Spend"
      />,
    );
    expect(rects(container)).toHaveLength(2);
  });

  it("T-OC3: every UTC day of the range is a slot, so an unreported day leaves a gap of one slot", async () => {
    const adjacent = await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={one({ "2026-11-14": 10, "2026-11-15": 20 })}
        format={usd}
        label="Spend"
      />,
    );
    const [a1, a2] = rects(adjacent.container);
    const slot = num(a2!, "x") - num(a1!, "x");
    expect(slot).toBeGreaterThan(0);
    adjacent.unmount();

    const gap = await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={one({ "2026-11-14": 10, "2026-11-16": 20 })}
        format={usd}
        label="Spend"
      />,
    );
    const [g1, g2] = rects(gap.container);
    expect(num(g2!, "x") - num(g1!, "x")).toBeCloseTo(2 * slot, 0);
  });

  it("T-OC3: several series stack on the same day and take their colour from the token they were given", async () => {
    const { container } = await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={[
          {
            key: "a",
            label: "Alpha",
            colorVar: "--color-team-1",
            values: { "2026-11-14": 10 },
          },
          {
            key: "b",
            label: "Beta",
            colorVar: "--color-team-2",
            values: { "2026-11-14": 5 },
          },
        ]}
        format={usd}
        label="Spend by team"
      />,
    );
    const bars = rects(container);
    expect(bars).toHaveLength(2);
    expect(num(bars[0]!, "x")).toBeCloseTo(num(bars[1]!, "x"), 3);
    expect(seriesFills(container, ".recharts-bar-rectangle rect")).toEqual(
      expect.arrayContaining(["var(--color-team-1)", "var(--color-team-2)"]),
    );
  });

  it("T-OC3: a single series is filled with var(<colorVar>), never a hex", async () => {
    const { container } = await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={one({ "2026-11-14": 10 })}
        format={usd}
        label="Spend"
      />,
    );
    const fills = seriesFills(container, ".recharts-bar-rectangle rect");
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill).toBe("var(--color-primary)");
    }
  });

  it("T-OC3 / Rule 40.2: the component source holds no raw hex colour (a missing file fails)", () => {
    // jsdom's import.meta.url is not a file: URL; vitest runs from the repo root or apps/dashboard.
    const rel = "components/charts/SpendTimelineChart.tsx";
    const path = [
      resolve(process.cwd(), rel),
      resolve(process.cwd(), "apps/dashboard", rel),
    ].find((p) => existsSync(p));
    const source = readFileSync(path ?? resolve(process.cwd(), rel), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("T-OC3: renders in a ResponsiveContainer inside a role=img named by the label", async () => {
    const { container } = await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={one({ "2026-11-14": 10 })}
        format={usd}
        label="Spend, 14 Nov to 17 Nov, total $10.00"
      />,
    );
    expect(
      container.querySelector(".recharts-responsive-container"),
    ).not.toBeNull();
    expect(
      screen.getByRole("img", { name: /Spend, 14 Nov to 17 Nov/ }),
    ).toBeInTheDocument();
  });

  it("T-OC3: with no value in any series it shows the empty state, not blank axes", async () => {
    const { container } = await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={one({})}
        format={usd}
        label="Spend"
      />,
    );
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(rects(container)).toHaveLength(0);
  });

  it("T-OC3: under prefers-reduced-motion the bars are drawn at once, with no entrance animation", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })),
    );
    // Rendered without advancing the fake clock: an animated bar would still
    // be at zero height.
    const { container } = render(
      <SpendTimelineChart
        days={DAYS}
        series={one({ "2026-11-14": 10 })}
        format={usd}
        label="Spend"
      />,
    );
    const [bar] = rects(container);
    expect(bar).toBeDefined();
    expect(num(bar!, "height")).toBeGreaterThan(0);
  });

  // Design System -- LiteLLM Organisation spend chart, the 2026-11-26
  // comparison (T-OC9): the optional `labelFor(key)` replaces the date format on
  // the x-axis ticks and the tooltip heading. jsdom draws no tick text and
  // cannot hover, so these read what the chart hands to Recharts' XAxis and
  // Tooltip.
  it("T-OC9: without labelFor the ticks and the tooltip heading are dates", async () => {
    captured.xAxis.length = 0;
    captured.tooltip.length = 0;
    await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={one({ "2026-11-14": 10 })}
        format={usd}
        label="Spend"
      />,
    );
    expect(captured.xAxis.at(-1)?.tickFormatter?.("2026-11-14", 0)).toBe(
      "Nov 14",
    );
    expect(tooltipHeading("2026-11-14")).toBe("Nov 14");
  });

  it("T-OC9: labelFor names the x-axis ticks and the tooltip heading", async () => {
    captured.xAxis.length = 0;
    captured.tooltip.length = 0;
    await renderChart(
      <SpendTimelineChart
        days={DAYS}
        series={one({ "2026-11-14": 10 })}
        format={usd}
        label="Spend"
        labelFor={(key) => `Week of ${key}`}
      />,
    );
    expect(captured.xAxis.at(-1)?.tickFormatter?.("2026-11-14", 0)).toBe(
      "Week of 2026-11-14",
    );
    expect(tooltipHeading("2026-11-14")).toBe("Week of 2026-11-14");
  });
});
