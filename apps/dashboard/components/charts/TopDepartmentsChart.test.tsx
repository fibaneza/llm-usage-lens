import { screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderChart,
  seriesFills,
  srOnlyMatches,
  stubSizedResizeObserver,
  teardownChartTest,
} from "@/test/support/chart-test-utils";

import { TopDepartmentsChart } from "./TopDepartmentsChart";

// Phase 4.1 section 3: top 5 departments by cost, horizontal bar chart
// (Design System -- Overview Page; Rule 40.3, 60.11). `bars` is the output of
// `toTopDepartmentBars`: already sorted descending and capped at five.

type Bars = ComponentProps<typeof TopDepartmentsChart>["bars"];

const bars: Bars = [
  { departmentId: "eng", departmentName: "Engineering", cost: 98.76 },
  { departmentId: "data", departmentName: "Data Science", cost: 54.32 },
  { departmentId: "ops", departmentName: "Operations", cost: 10.11 },
];

beforeEach(() => {
  vi.useFakeTimers();
  stubSizedResizeObserver();
});

afterEach(() => {
  teardownChartTest();
});

describe("TopDepartmentsChart", () => {
  it("renders inside a Recharts ResponsiveContainer", async () => {
    const { container } = await renderChart(
      <TopDepartmentsChart bars={bars} />,
    );

    expect(
      container.querySelector(".recharts-responsive-container"),
    ).not.toBeNull();
  });

  it("is a named image", async () => {
    await renderChart(<TopDepartmentsChart bars={bars} />);

    expect(
      screen.getByRole("img", { name: /top (5 )?departments/i }),
    ).toBeInTheDocument();
  });

  it("draws one bar per department, coloured only by CSS variable tokens", async () => {
    const { container } = await renderChart(
      <TopDepartmentsChart bars={bars} />,
    );

    const fills = seriesFills(container, ".recharts-rectangle");
    expect(fills).toHaveLength(3);
    for (const fill of fills) {
      expect(fill).toMatch(/^var\(--color-[a-z-]+\)$/);
    }
  });

  it("exposes names and costs in a visually hidden copy for screen readers", async () => {
    await renderChart(<TopDepartmentsChart bars={bars} />);

    expect(srOnlyMatches("Engineering").length).toBeGreaterThan(0);
    expect(srOnlyMatches("Data Science").length).toBeGreaterThan(0);
    expect(srOnlyMatches("Operations").length).toBeGreaterThan(0);
    expect(srOnlyMatches(/98\.76/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/54\.32/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/10\.11/).length).toBeGreaterThan(0);
  });

  it("lists departments in the order given, most expensive first", async () => {
    await renderChart(<TopDepartmentsChart bars={bars} />);

    const [eng] = srOnlyMatches("Engineering");
    const [data] = srOnlyMatches("Data Science");
    const [ops] = srOnlyMatches("Operations");
    expect(eng?.compareDocumentPosition(data as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(data?.compareDocumentPosition(ops as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps the screen-reader data outside the image role so it stays reachable", async () => {
    await renderChart(<TopDepartmentsChart bars={bars} />);

    const image = screen.getByRole("img", { name: /top (5 )?departments/i });
    for (const el of srOnlyMatches("Engineering")) {
      expect(image.contains(el)).toBe(false);
    }
  });

  it("shows an empty state instead of a blank chart when there are no departments", async () => {
    await renderChart(<TopDepartmentsChart bars={[]} />);

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
  });
});
