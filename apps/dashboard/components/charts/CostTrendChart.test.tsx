import type {
  DailyTrendPoint,
  DepartmentDetailResponse,
} from "@llm-usage-lens/shared";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderChart,
  seriesFills,
  srOnlyMatches,
  stubSizedResizeObserver,
  teardownChartTest,
} from "@/test/chart-test-utils";

import { CostTrendChart } from "./CostTrendChart";

// Phase 4.1: stacked area by model, non-model cost as its own series using
// `--color-cost-non-model` (never merged into `other`); wrapped in
// ResponsiveContainer (Rule 40.3, 60.11); colours only via CSS tokens
// (Rule 40.2); each chart is a named image with a screen-reader copy of its
// data (Design System -- Accessibility, "Don't rely on color alone"); empty
// state is "No data yet", not a blank chart (Design System -- Charts and Data).

const trend: DailyTrendPoint[] = [
  {
    date: "2026-10-01",
    cost: 24.57,
    modelCost: 16.68,
    nonModelCost: 7.89,
    byModel: { "claude-opus": 12.34, "claude-sonnet": 4.34 },
  },
  {
    date: "2026-10-02",
    cost: 3.21,
    modelCost: 0,
    nonModelCost: 3.21,
    byModel: {},
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  stubSizedResizeObserver();
});

afterEach(() => {
  teardownChartTest();
});

describe("CostTrendChart", () => {
  it("renders inside a Recharts ResponsiveContainer", async () => {
    const { container } = await renderChart(
      <CostTrendChart data={trend} groupBy="model" />,
    );

    expect(
      container.querySelector(".recharts-responsive-container"),
    ).not.toBeNull();
  });

  it("is a named image", async () => {
    await renderChart(<CostTrendChart data={trend} groupBy="model" />);

    expect(
      screen.getByRole("img", { name: /cost trend/i }),
    ).toBeInTheDocument();
  });

  it("draws one stacked area per series, coloured only by CSS variable tokens", async () => {
    const { container } = await renderChart(
      <CostTrendChart data={trend} groupBy="model" />,
    );

    const fills = seriesFills(container, ".recharts-area-area");
    expect(new Set(fills)).toEqual(
      new Set([
        "var(--color-model-opus)",
        "var(--color-model-sonnet)",
        "var(--color-cost-non-model)",
      ]),
    );
    for (const fill of fills) {
      expect(fill).toMatch(/^var\(--color-[a-z-]+\)$/);
    }
  });

  it("draws no raw hex colour anywhere in the SVG", async () => {
    const { container } = await renderChart(
      <CostTrendChart data={trend} groupBy="model" />,
    );

    expect(container.innerHTML).not.toMatch(/(fill|stroke)="#[0-9a-f]{3,8}"/i);
  });

  it("gives non-model cost its own series, distinct from the other-model token", async () => {
    const { container } = await renderChart(
      <CostTrendChart data={trend} groupBy="model" />,
    );

    const fills = seriesFills(container, ".recharts-area-area");
    expect(fills).toContain("var(--color-cost-non-model)");
    expect(fills).not.toContain("var(--color-model-other)");
  });

  it("exposes the values in a visually hidden copy for screen readers", async () => {
    await renderChart(<CostTrendChart data={trend} groupBy="model" />);

    expect(srOnlyMatches("Claude Opus").length).toBeGreaterThan(0);
    expect(srOnlyMatches("Claude Sonnet").length).toBeGreaterThan(0);
    expect(srOnlyMatches("Non-model charges").length).toBeGreaterThan(0);
    expect(srOnlyMatches(/12\.34/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/4\.34/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/7\.89/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/3\.21/).length).toBeGreaterThan(0);
  });

  it("keeps the screen-reader data outside the image role so it stays reachable", async () => {
    await renderChart(<CostTrendChart data={trend} groupBy="model" />);

    const image = screen.getByRole("img", { name: /cost trend/i });
    for (const el of srOnlyMatches(/12\.34/)) {
      expect(image.contains(el)).toBe(false);
    }
  });

  it("shows an empty state instead of a blank chart when there is no data", async () => {
    await renderChart(<CostTrendChart data={[]} groupBy="model" />);

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
  });
});

// Team mode (Phase 4.1: `groupBy: 'model' | 'team'`, reused on the department
// detail page). `data` is `DepartmentDetailResponse.teamTrend`; the optional
// `teamNames` maps teamId -> display name. One stacked area per team, coloured
// from the team palette tokens; no non-model series (Rule 40.2).
describe("CostTrendChart team mode", () => {
  const teamTrend: DepartmentDetailResponse["teamTrend"] = [
    {
      date: "2026-10-01",
      teams: [
        { teamId: "team-a", cost: 12.34 },
        { teamId: "team-b", cost: 4.56 },
      ],
    },
    {
      date: "2026-10-02",
      teams: [{ teamId: "team-c", cost: 7.89 }],
    },
  ];
  const teamNames = { "team-a": "Platform", "team-b": "Research" };

  it("renders inside a Recharts ResponsiveContainer as a named image", async () => {
    const { container } = await renderChart(
      <CostTrendChart data={teamTrend} groupBy="team" teamNames={teamNames} />,
    );

    expect(
      container.querySelector(".recharts-responsive-container"),
    ).not.toBeNull();
    expect(
      screen.getByRole("img", { name: /cost trend by team/i }),
    ).toBeInTheDocument();
  });

  it("draws one stacked area per team, coloured only by team palette tokens", async () => {
    const { container } = await renderChart(
      <CostTrendChart data={teamTrend} groupBy="team" teamNames={teamNames} />,
    );

    const fills = seriesFills(container, ".recharts-area-area");
    expect(fills).toHaveLength(3);
    expect(new Set(fills)).toEqual(
      new Set([
        "var(--color-team-1)",
        "var(--color-team-2)",
        "var(--color-team-3)",
      ]),
    );
    for (const fill of fills) {
      expect(fill).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
    expect(container.innerHTML).not.toMatch(/(fill|stroke)="#[0-9a-f]{3,8}"/i);
  });

  it("exposes team names and costs in a visually hidden copy for screen readers", async () => {
    await renderChart(
      <CostTrendChart data={teamTrend} groupBy="team" teamNames={teamNames} />,
    );

    expect(srOnlyMatches("Platform").length).toBeGreaterThan(0);
    expect(srOnlyMatches("Research").length).toBeGreaterThan(0);
    expect(srOnlyMatches(/12\.34/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/4\.56/).length).toBeGreaterThan(0);
    expect(srOnlyMatches(/7\.89/).length).toBeGreaterThan(0);
  });

  it("falls back to the teamId for a team without a name", async () => {
    await renderChart(
      <CostTrendChart data={teamTrend} groupBy="team" teamNames={teamNames} />,
    );

    expect(srOnlyMatches("team-c").length).toBeGreaterThan(0);
  });

  it("uses the teamId as the label when no names are given", async () => {
    await renderChart(<CostTrendChart data={teamTrend} groupBy="team" />);

    expect(srOnlyMatches("team-a").length).toBeGreaterThan(0);
    expect(srOnlyMatches("team-b").length).toBeGreaterThan(0);
  });

  it("has no non-model series in team mode", async () => {
    const { container } = await renderChart(
      <CostTrendChart data={teamTrend} groupBy="team" teamNames={teamNames} />,
    );

    expect(srOnlyMatches("Non-model charges")).toHaveLength(0);
    expect(seriesFills(container, ".recharts-area-area")).not.toContain(
      "var(--color-cost-non-model)",
    );
  });

  it("keeps the screen-reader data outside the image role so it stays reachable", async () => {
    await renderChart(
      <CostTrendChart data={teamTrend} groupBy="team" teamNames={teamNames} />,
    );

    const image = screen.getByRole("img", { name: /cost trend by team/i });
    for (const el of srOnlyMatches(/12\.34/)) {
      expect(image.contains(el)).toBe(false);
    }
  });

  it("shows an empty state instead of a blank chart when there is no team data", async () => {
    await renderChart(<CostTrendChart data={[]} groupBy="team" />);

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
  });
});
