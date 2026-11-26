import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/support/render-providers";

import { SpendTimelinePanel } from "./SpendTimelinePanel";

// Sources: Design System - Component Inventory, `SpendTimelinePanel` (unit
// LP3, 2026-11-26) and T-LP15: "the three switches and their URL parameters;
// Weekly bars are the sums of their days and the total equals the daily
// total; an option without data is disabled with 'Not reported by LiteLLM';
// the Table view shows the same numbers; every UTC day of the range has a
// slot; the empty state"; Design System - LiteLLM Organisation spend chart
// (T-OC4, T-OC9, T-OC10: the rules it reuses); LD20 (UTC days).
// Contract: <SpendTimelinePanel rows dateFrom dateTo description? /> with rows
// of { date, spend, requests?, tokens? }, in components/litellm/
// SpendTimelinePanel.tsx; a Panel titled "Spend over time"; groups Metric
// (Spend, Tokens, Requests), Bucket size (Daily, Weekly), View (Chart, Table);
// URL parameters metric, bucket, view (a default is not written); one series
// on --color-primary; the chart is LazySpendTimelineChart; with no rows the
// panel says "No daily spend reported." in both views (the copy the user
// page's table used).
type Series = {
  key: string;
  label: string;
  colorVar: string;
  values: Record<string, number>;
};
vi.mock("@/components/charts/LazyCharts", () => ({
  LazySpendTimelineChart: (props: {
    days: string[];
    series: Series[];
    label: string;
    labelFor?: (key: string) => string;
  }) => (
    <div role="img" aria-label={props.label}>
      <span data-testid="days">{props.days.join(",")}</span>
      <span data-testid="ticks">
        {props.labelFor
          ? props.days.map((d) => props.labelFor?.(d)).join("|")
          : ""}
      </span>
      <ul aria-label="probe series">
        {props.series.map((s) => (
          <li
            key={s.key}
            data-color={s.colorVar}
            data-values={JSON.stringify(s.values)}
          >
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

afterEach(() => vi.restoreAllMocks());

const D1 = "2026-11-14";
const D2 = "2026-11-15";
const RANGE = { dateFrom: D1, dateTo: "2026-11-16" };
const SIMPLE = [
  { date: D1, spend: 100, requests: 1200, tokens: 3_500_000 },
  { date: D2, spend: 50.5, requests: 800, tokens: 2_000_000 },
];
// 2026-11-14 is a Saturday: weeks of 9 Nov (part), 16 Nov, 23 Nov (part).
const WEEK_RANGE = { dateFrom: "2026-11-14", dateTo: "2026-11-25" };
const WEEK_ROWS = [
  { date: "2026-11-14", spend: 10, tokens: 1000 },
  { date: "2026-11-15", spend: 20, tokens: 2000 },
  { date: "2026-11-16", spend: 1, tokens: 100 },
  { date: "2026-11-17", spend: 2, tokens: 200 },
  { date: "2026-11-20", spend: 3, tokens: 300 },
  { date: "2026-11-23", spend: 4, tokens: 400 },
  { date: "2026-11-25", spend: 5, tokens: 500 },
];

function panel(
  props: Partial<Parameters<typeof SpendTimelinePanel>[0]> = {},
  searchParams: Record<string, string> = {},
  onUrlUpdate?: OnUrlUpdateFunction,
) {
  return renderWithProviders(
    <SpendTimelinePanel rows={SIMPLE} {...RANGE} {...props} />,
    { searchParams, onUrlUpdate },
  );
}

function group(name: string) {
  return screen.getByRole("group", { name });
}
function option(groupName: string, name: string) {
  return within(group(groupName)).getByRole("button", { name });
}
const selected = (el: HTMLElement) =>
  el.getAttribute("aria-pressed") === "true" ||
  el.getAttribute("aria-checked") === "true" ||
  el.getAttribute("data-state") === "on";
function probeSeries() {
  const list = screen.getByRole("list", { name: "probe series" });
  return within(list)
    .getAllByRole("listitem")
    .map((li) => ({
      label: li.textContent,
      color: li.getAttribute("data-color"),
      values: JSON.parse(li.getAttribute("data-values") ?? "{}") as Record<
        string,
        number
      >,
    }));
}
const rowOf = (name: RegExp | string) => screen.getByRole("row", { name });

describe("SpendTimelinePanel (T-LP15)", () => {
  it("T-LP15: a Panel 'Spend over time' with the Metric, Bucket size and View groups (no Breakdown), opening on Spend, Daily, Chart", () => {
    panel({ description: "Days are UTC days." });
    expect(
      screen.getByRole("heading", { name: "Spend over time" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Days are UTC days.")).toBeInTheDocument();
    expect(selected(option("Metric", "Spend"))).toBe(true);
    expect(selected(option("Bucket size", "Daily"))).toBe(true);
    expect(selected(option("View", "Chart"))).toBe(true);
    expect(screen.queryByRole("group", { name: "Breakdown" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      within(group("Metric"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Spend", "Tokens", "Requests"]);
  });

  it("T-LP15 / LD20: one primary-coloured series, and every UTC day of the range has a slot though a day has no row", () => {
    panel();
    expect(screen.getByTestId("days")).toHaveTextContent(
      "2026-11-14,2026-11-15,2026-11-16",
    );
    const [only, ...rest] = probeSeries();
    expect(rest).toHaveLength(0);
    expect(only?.color).toBe("--color-primary");
    expect(only?.values).toEqual({ [D1]: 100, [D2]: 50.5 });
  });

  it("T-LP15: the chart's label for assistive technology names the metric, the UTC range and the total", () => {
    panel();
    expect(
      screen.getByRole("img", {
        name: "Spend, 2026-11-14 to 2026-11-16 UTC, total $150.50",
      }),
    ).toBeInTheDocument();
  });

  it("T-LP15: each switch changes the view and writes its URL parameter; a default is not written", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    panel({}, {}, onUrlUpdate);
    const last = () =>
      onUrlUpdate.mock.lastCall?.[0].searchParams as URLSearchParams;

    await user.click(option("Metric", "Requests"));
    expect(last().get("metric")).toBe("requests");
    expect(probeSeries()[0]?.values).toEqual({ [D1]: 1200, [D2]: 800 });
    await user.click(option("Metric", "Tokens"));
    expect(last().get("metric")).toBe("tokens");
    expect(probeSeries()[0]?.values).toEqual({
      [D1]: 3_500_000,
      [D2]: 2_000_000,
    });
    await user.click(option("Metric", "Spend"));
    expect(last().get("metric")).toBeNull();

    await user.click(option("Bucket size", "Weekly"));
    expect(last().get("bucket")).toBe("weekly");
    await user.click(option("Bucket size", "Daily"));
    expect(last().get("bucket")).toBeNull();

    await user.click(option("View", "Table"));
    expect(last().get("view")).toBe("table");
    expect(screen.queryByRole("img")).toBeNull();
    await user.click(option("View", "Chart"));
    expect(last().get("view")).toBeNull();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("T-LP15: a URL carrying metric, bucket and view restores the three switches", () => {
    panel(
      { rows: WEEK_ROWS, ...WEEK_RANGE },
      { metric: "tokens", bucket: "weekly", view: "table" },
    );
    expect(selected(option("Metric", "Tokens"))).toBe(true);
    expect(selected(option("Bucket size", "Weekly"))).toBe(true);
    expect(selected(option("View", "Table"))).toBe(true);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("T-LP15 / T-OC9: Weekly sums each Monday-to-Sunday UTC week, passes the Monday keys as the chart's days and marks a part week", async () => {
    const user = userEvent.setup();
    panel({ rows: WEEK_ROWS, ...WEEK_RANGE });
    await user.click(option("Bucket size", "Weekly"));
    expect(screen.getByTestId("days")).toHaveTextContent(
      "2026-11-09,2026-11-16,2026-11-23",
    );
    const values = probeSeries()[0]?.values ?? {};
    expect(values).toEqual({
      "2026-11-09": 30,
      "2026-11-16": 6,
      "2026-11-23": 9,
    });
    expect(Object.values(values).reduce((a, b) => a + b, 0)).toBe(
      WEEK_ROWS.reduce((a, r) => a + r.spend, 0),
    );
    const ticks = screen.getByTestId("ticks").textContent?.split("|") ?? [];
    expect(ticks[1]).toBe("Week of 16 Nov");
    expect(ticks[0]).toContain("part week");
    expect(ticks[2]).toContain("part week");
  });

  // Design System - SpendTimelinePanel row (Bucket size) and WCAG 2.1.1: the
  // switch works from the keyboard alone.
  it.each(["{Enter}", " "])(
    "T-LP15 / WCAG 2.1.1: Tab reaches Weekly and %j selects it (aria-pressed, weekly chart and subtitle)",
    async (key) => {
      const user = userEvent.setup();
      panel({ rows: WEEK_ROWS, ...WEEK_RANGE });
      const weekly = option("Bucket size", "Weekly");
      for (let i = 0; i < 20 && document.activeElement !== weekly; i++) {
        await user.tab();
      }
      expect(weekly).toHaveFocus();
      await user.keyboard(key);
      expect(weekly).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Weekly spend")).toBeInTheDocument();
      expect(screen.getByTestId("days")).toHaveTextContent(
        "2026-11-09,2026-11-16,2026-11-23",
      );
    },
  );

  it("T-LP15: Weekly keeps the metric (tokens are summed per week too)", () => {
    panel(
      { rows: WEEK_ROWS, ...WEEK_RANGE },
      { bucket: "weekly", metric: "tokens" },
    );
    expect(probeSeries()[0]?.values).toEqual({
      "2026-11-09": 3000,
      "2026-11-16": 600,
      "2026-11-23": 900,
    });
  });

  it("T-LP15: the Table view shows the same numbers as the chart, per UTC day, for each metric", async () => {
    const user = userEvent.setup();
    panel({}, { view: "table" });
    expect(
      screen.getByRole("columnheader", { name: "Date (UTC)" }),
    ).toBeInTheDocument();
    expect(
      within(rowOf(new RegExp(D1))).getAllByText("$100.00"),
    ).not.toHaveLength(0);
    expect(
      within(rowOf(new RegExp(D2))).getAllByText("$50.50"),
    ).not.toHaveLength(0);
    await user.click(option("Metric", "Requests"));
    expect(
      within(rowOf(new RegExp(D1))).getAllByText("1,200"),
    ).not.toHaveLength(0);
    await user.click(option("Metric", "Tokens"));
    expect(
      within(rowOf(new RegExp(D2))).getAllByText("2,000,000"),
    ).not.toHaveLength(0);
  });

  it("T-LP15 / T-OC9: the Table view in Weekly has one row per week under 'Week (UTC)', marks the part weeks, and its figures add up to the daily total", async () => {
    const user = userEvent.setup();
    panel({ rows: WEEK_ROWS, ...WEEK_RANGE }, { view: "table" });
    await user.click(option("Bucket size", "Weekly"));
    expect(
      screen.getByRole("columnheader", { name: "Week (UTC)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Date (UTC)" }),
    ).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(1 + 3);
    expect(rowOf(/Week of 9 Nov/)).toHaveTextContent(/part week/);
    expect(rowOf(/Week of 16 Nov/)).not.toHaveTextContent(/part week/);
    expect(rowOf(/Week of 23 Nov/)).toHaveTextContent(/part week/);
    expect(
      within(rowOf(/Week of 9 Nov/)).getAllByText("$30.00"),
    ).not.toHaveLength(0);
    expect(
      within(rowOf(/Week of 16 Nov/)).getAllByText("$6.00"),
    ).not.toHaveLength(0);
    expect(
      within(rowOf(/Week of 23 Nov/)).getAllByText("$9.00"),
    ).not.toHaveLength(0);
  });

  it("T-LP15: rows carrying no requests or tokens disable those options and say 'Not reported by LiteLLM'", () => {
    panel({
      rows: [
        { date: D1, spend: 100 },
        { date: D2, spend: 50 },
      ],
    });
    expect(option("Metric", "Requests")).toBeDisabled();
    expect(option("Metric", "Tokens")).toBeDisabled();
    expect(option("Metric", "Spend")).toBeEnabled();
    expect(
      screen.getAllByText("Not reported by LiteLLM").length,
    ).toBeGreaterThan(0);
  });

  it("T-LP15: with requests and tokens reported nothing is disabled and no reason shows; a URL naming a disabled metric falls back to Spend", () => {
    const { unmount } = panel();
    expect(option("Metric", "Requests")).toBeEnabled();
    expect(option("Metric", "Tokens")).toBeEnabled();
    expect(screen.queryByText("Not reported by LiteLLM")).toBeNull();
    unmount();
    panel({ rows: [{ date: D1, spend: 1 }] }, { metric: "tokens" });
    expect(selected(option("Metric", "Spend"))).toBe(true);
    expect(probeSeries()[0]?.values).toEqual({ [D1]: 1 });
  });

  // T-OC10 (the subtitle names what is drawn): one row per class.
  it.each([
    [{}, "Daily spend"],
    [{ metric: "tokens", bucket: "weekly" }, "Weekly tokens"],
    [{ metric: "requests" }, "Daily requests"],
  ] as const)(
    "T-LP15 / T-OC10: the subtitle for %j reads '%s'",
    (params, text) => {
      panel({}, { ...params });
      expect(screen.getByText(text)).toBeInTheDocument();
    },
  );

  it("T-LP15: with no rows the panel says 'No daily spend reported.' in the Chart and in the Table view, and shows no data row", () => {
    const { unmount } = panel({ rows: [] });
    expect(screen.getByText("No daily spend reported.")).toBeInTheDocument();
    unmount();
    panel({ rows: [] }, { view: "table" });
    expect(screen.getByText("No daily spend reported.")).toBeInTheDocument();
    expect(screen.queryAllByRole("row").length).toBeLessThanOrEqual(1);
  });
});
