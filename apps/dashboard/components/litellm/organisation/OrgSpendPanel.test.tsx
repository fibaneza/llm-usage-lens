import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/support/render-providers";

import { OrgSpendPanel } from "./OrgSpendPanel";

// Sources: Design System -- LiteLLM Organisation spend chart (unit OC1, T-OC4):
// panel "Spend over time"; switches Metric (Spend | Requests | Tokens),
// Breakdown (Total | By team), View (Chart | Table) kept in the URL as
// `metric`, `by`, `view` (a default is not written); By team = the seven
// largest teams of the range by the chosen metric (--color-team-1..7, largest
// first) then "Other teams" (--color-team-8); Total uses the primary token;
// the Table view shows the same numbers ("Date (UTC)"); an option the answer
// carries no data for is disabled with "Not reported by LiteLLM"; LD20 (UTC).
// Contract: <OrgSpendPanel daily dailyByTeam? dateFrom dateTo />; URL values
// metric=spend|requests|tokens, by=total|team, view=chart|table; the lazy
// chart export is `LazySpendTimelineChart` in components/charts/LazyCharts.
// The lazy chart is replaced by a probe that lists the series it was given
// (the chart itself is covered by SpendTimelineChart.test.tsx, Rule 60.24a).
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

const RANGE = { dateFrom: "2026-11-14", dateTo: "2026-11-16" };
const D1 = "2026-11-14";
const D2 = "2026-11-15";

// Nine teams. Team N: spend N*10 / N, requests N*100 / N*10, tokens N*1000 /
// N*100 on D1 / D2; team 1 has a huge token count so the ranking differs per
// metric. Day figures are the sums, as the route guarantees (T-OC1).
const teams = Array.from({ length: 9 }, (_, i) => {
  const n = i + 1;
  const t1 = n === 1 ? 1_000_000 : n * 1000;
  return {
    litellmTeamId: `ll-${n}`,
    alias: `Team ${n}`,
    daily: [
      { date: D1, spend: n * 10, requests: n * 100, tokens: t1 },
      { date: D2, spend: n, requests: n * 10, tokens: n * 100 },
    ],
  };
});
const sumDay = (d: string, k: "spend" | "requests" | "tokens") =>
  teams.reduce(
    (acc, t) => acc + (t.daily.find((r) => r.date === d)?.[k] ?? 0),
    0,
  );
const daily = [D1, D2].map((date) => ({
  date,
  spend: sumDay(date, "spend"),
  requests: sumDay(date, "requests"),
  tokens: sumDay(date, "tokens"),
}));

const SIMPLE = [
  { date: D1, spend: 100, requests: 1200, tokens: 3_500_000 },
  { date: D2, spend: 50.5, requests: 800, tokens: 2_000_000 },
];

function panel(
  props: Partial<Parameters<typeof OrgSpendPanel>[0]> = {},
  searchParams: Record<string, string> = {},
  onUrlUpdate?: OnUrlUpdateFunction,
) {
  return renderWithProviders(
    <OrgSpendPanel daily={SIMPLE} dailyByTeam={teams} {...RANGE} {...props} />,
    { searchParams, onUrlUpdate },
  );
}

// A switch is a radio group or a toggle group: find a group by its visible
// label, an option by its name.
function group(name: string) {
  return (
    screen.queryByRole("radiogroup", { name }) ??
    screen.getByRole("group", { name })
  );
}
function option(groupName: string, name: string) {
  const g = group(groupName);
  return (
    within(g).queryByRole("radio", { name }) ??
    within(g).getByRole("button", { name })
  );
}
function selected(el: HTMLElement) {
  return (
    el.getAttribute("aria-checked") === "true" ||
    el.getAttribute("aria-pressed") === "true" ||
    el.getAttribute("data-state") === "on" ||
    el.getAttribute("data-state") === "checked"
  );
}
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
function cell(date: string, header: string) {
  const heads = screen
    .getAllByRole("columnheader")
    .map((h) => h.textContent?.trim());
  const row = screen.getByRole("row", { name: new RegExp(date) });
  const cells = Array.from(row.querySelectorAll("th,td"));
  return cells[heads.indexOf(header)]?.textContent?.trim();
}

describe("OrgSpendPanel (T-OC4)", () => {
  it("T-OC4: opens on Spend, Total, Chart with the three labelled groups and one primary-coloured series over every UTC day of the range", () => {
    panel();
    expect(
      screen.getByRole("heading", { name: "Spend over time" }),
    ).toBeInTheDocument();
    for (const label of ["Metric", "Breakdown", "View"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(selected(option("Metric", "Spend"))).toBe(true);
    expect(selected(option("Breakdown", "Total"))).toBe(true);
    expect(selected(option("View", "Chart"))).toBe(true);
    expect(screen.getByTestId("days")).toHaveTextContent(
      "2026-11-14,2026-11-15,2026-11-16",
    );
    const [only, ...rest] = probeSeries();
    expect(rest).toHaveLength(0);
    expect(only?.color).toBe("--color-primary");
    expect(only?.values).toEqual({ [D1]: 100, [D2]: 50.5 });
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("T-OC4: each switch changes the view and writes the URL; a default is not written", async () => {
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

    await user.click(option("Breakdown", "By team"));
    expect(last().get("by")).toBe("team");
    await user.click(option("Breakdown", "Total"));
    expect(last().get("by")).toBeNull();

    await user.click(option("View", "Table"));
    expect(last().get("view")).toBe("table");
    expect(screen.queryByRole("img")).toBeNull();
    await user.click(option("View", "Chart"));
    expect(last().get("view")).toBeNull();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("T-OC4: a URL carrying metric, by and view restores all three switches", () => {
    panel({}, { metric: "tokens", by: "team", view: "table" });
    expect(selected(option("Metric", "Tokens"))).toBe(true);
    expect(selected(option("Breakdown", "By team"))).toBe(true);
    expect(selected(option("View", "Table"))).toBe(true);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("T-OC4: By team with nine teams shows the seven largest, largest first, with team tokens 1 to 7, then 'Other teams' on token 8, and a legend", async () => {
    const user = userEvent.setup();
    panel({ daily, dailyByTeam: teams });
    await user.click(option("Breakdown", "By team"));

    const series = probeSeries();
    expect(series.map((s) => s.label)).toEqual([
      "Team 9",
      "Team 8",
      "Team 7",
      "Team 6",
      "Team 5",
      "Team 4",
      "Team 3",
      "Other teams",
    ]);
    expect(series.map((s) => s.color)).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `--color-team-${n}`),
      "--color-team-8",
    ]);
    // Other teams = Team 2 + Team 1.
    expect(series[7]?.values).toEqual({ [D1]: 30, [D2]: 3 });
    const legend = screen.getByRole("list", { name: "Chart legend" });
    expect(within(legend).getByText("Other teams")).toBeInTheDocument();
    expect(within(legend).getByText("Team 9")).toBeInTheDocument();
  });

  it("T-OC4: By team ranks the teams by the chosen metric (Tokens puts the token-heavy team first)", async () => {
    const user = userEvent.setup();
    panel({ daily, dailyByTeam: teams }, { metric: "tokens" });
    await user.click(option("Breakdown", "By team"));
    const series = probeSeries();
    expect(series[0]).toMatchObject({
      label: "Team 1",
      color: "--color-team-1",
    });
    expect(series.at(-1)?.label).toBe("Other teams");
  });

  it("T-OC4: the Table view shows the same numbers as the chart, per UTC day, with a Total column", async () => {
    const user = userEvent.setup();
    panel({}, { view: "table" });
    expect(
      screen.getByRole("columnheader", { name: "Date (UTC)" }),
    ).toBeInTheDocument();
    expect(cell(D1, "Total")).toBe("$100.00");
    expect(cell(D2, "Total")).toBe("$50.50");
    await user.click(option("Metric", "Requests"));
    expect(cell(D1, "Total")).toBe("1,200");
    await user.click(option("Metric", "Tokens"));
    expect(cell(D1, "Total")).toBe("3,500,000");
  });

  it("T-OC4: the Table view by team has a column per series and a Total, the Other teams column summed", () => {
    panel(
      { daily, dailyByTeam: teams },
      { view: "table", by: "team", metric: "spend" },
    );
    const heads = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());
    expect(heads).toEqual(
      expect.arrayContaining([
        "Date (UTC)",
        "Team 9",
        "Team 3",
        "Other teams",
        "Total",
      ]),
    );
    expect(heads).not.toContain("Team 2");
    expect(cell(D1, "Team 9")).toBe("$90.00");
    expect(cell(D1, "Other teams")).toBe("$30.00");
    expect(cell(D1, "Total")).toBe("$450.00");
    expect(cell(D2, "Other teams")).toBe("$3.00");
  });

  it("T-OC4: an option the answer has no data for is disabled and says 'Not reported by LiteLLM'", () => {
    panel({
      daily: [
        { date: D1, spend: 100 },
        { date: D2, spend: 50 },
      ],
      dailyByTeam: undefined,
    });
    expect(option("Metric", "Requests")).toBeDisabled();
    expect(option("Metric", "Tokens")).toBeDisabled();
    expect(option("Breakdown", "By team")).toBeDisabled();
    expect(option("Metric", "Spend")).toBeEnabled();
    expect(
      screen.getAllByText("Not reported by LiteLLM").length,
    ).toBeGreaterThan(0);
  });

  it("T-OC4: an empty dailyByTeam disables By team; with all data present nothing is disabled and no reason shows", () => {
    const { unmount } = panel({ dailyByTeam: [] });
    expect(option("Breakdown", "By team")).toBeDisabled();
    unmount();
    panel();
    for (const [g, o] of [
      ["Metric", "Requests"],
      ["Metric", "Tokens"],
      ["Breakdown", "By team"],
    ] as const) {
      expect(option(g, o)).toBeEnabled();
    }
    expect(screen.queryByText("Not reported by LiteLLM")).toBeNull();
  });
});

// Sources: Design System -- LiteLLM Organisation spend chart, the 2026-11-26
// comparison (T-OC9, T-OC10): Metric in the order Spend, Tokens, Requests; a
// fourth switch "Bucket size" Daily (default) | Weekly kept in the URL as
// `bucket=weekly` (the default not written); a week is Monday to Sunday UTC,
// labelled "Week of 9 Nov", a part week marked "part week" in the table and the
// tooltip; the chart gets the bucket keys as `days` and a `labelFor`; the
// subtitle says what is drawn ("Daily spend by team, 7 largest stacked").
const WEEK_RANGE = { dateFrom: "2026-11-14", dateTo: "2026-11-25" };
// 2026-11-14 is a Saturday: weeks of 9 Nov (part), 16 Nov, 23 Nov (part).
const WEEK_DAILY = [
  { date: "2026-11-14", spend: 10, tokens: 1000 },
  { date: "2026-11-15", spend: 20, tokens: 2000 },
  { date: "2026-11-16", spend: 1, tokens: 100 },
  { date: "2026-11-17", spend: 2, tokens: 200 },
  { date: "2026-11-20", spend: 3, tokens: 300 },
  { date: "2026-11-23", spend: 4, tokens: 400 },
  { date: "2026-11-25", spend: 5, tokens: 500 },
];

describe("OrgSpendPanel -- OC2 comparison (T-OC9, T-OC10)", () => {
  it("T-OC10: the Metric options come in LiteLLM's order Spend, Tokens, Requests", () => {
    panel();
    const names = within(group("Metric"))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Spend", "Tokens", "Requests"]);
  });

  it("T-OC9: a fourth group 'Bucket size' opens on Daily; the chart gets every UTC day", () => {
    panel();
    expect(selected(option("Bucket size", "Daily"))).toBe(true);
    expect(selected(option("Bucket size", "Weekly"))).toBe(false);
    expect(screen.getByTestId("days")).toHaveTextContent(
      "2026-11-14,2026-11-15,2026-11-16",
    );
  });

  it("T-OC9: Weekly by click sums each Monday-to-Sunday UTC week, passes the Monday keys as the chart's days and writes bucket=weekly; Daily removes it", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    panel({ daily: WEEK_DAILY, ...WEEK_RANGE }, {}, onUrlUpdate);
    const last = () =>
      onUrlUpdate.mock.lastCall?.[0].searchParams as URLSearchParams;

    await user.click(option("Bucket size", "Weekly"));
    expect(last().get("bucket")).toBe("weekly");
    expect(selected(option("Bucket size", "Weekly"))).toBe(true);
    expect(screen.getByTestId("days")).toHaveTextContent(
      "2026-11-09,2026-11-16,2026-11-23",
    );
    expect(probeSeries()[0]?.values).toEqual({
      "2026-11-09": 30,
      "2026-11-16": 6,
      "2026-11-23": 9,
    });

    await user.click(option("Bucket size", "Daily"));
    expect(last().get("bucket")).toBeNull();
    expect(screen.getByTestId("days")).toHaveTextContent("2026-11-14,");
  });

  it("T-OC9: a URL carrying bucket=weekly restores the switch and the weekly series", () => {
    panel({ daily: WEEK_DAILY, ...WEEK_RANGE }, { bucket: "weekly" });
    expect(selected(option("Bucket size", "Weekly"))).toBe(true);
    expect(probeSeries()[0]?.values).toEqual({
      "2026-11-09": 30,
      "2026-11-16": 6,
      "2026-11-23": 9,
    });
  });

  it("T-OC9: the chart's labelFor gives 'Week of 16 Nov' for a whole week and marks a part week", () => {
    panel({ daily: WEEK_DAILY, ...WEEK_RANGE }, { bucket: "weekly" });
    const ticks = screen.getByTestId("ticks").textContent?.split("|") ?? [];
    expect(ticks).toHaveLength(3);
    expect(ticks[1]).toBe("Week of 16 Nov");
    expect(ticks[0]).toContain("Week of 9 Nov");
    expect(ticks[0]).toContain("part week");
    expect(ticks[2]).toContain("Week of 23 Nov");
    expect(ticks[2]).toContain("part week");
  });

  it("T-OC9: By team, Weekly sums each team's days per week and ranks by the week-range total", () => {
    panel({ daily, dailyByTeam: teams }, { bucket: "weekly", by: "team" });
    const series = probeSeries();
    // D1 = 14 Nov, D2 = 15 Nov, both in the week of 9 Nov: Team 9 = 90 + 9.
    expect(series[0]).toMatchObject({
      label: "Team 9",
      values: { "2026-11-09": 99 },
    });
    expect(series.at(-1)).toMatchObject({
      label: "Other teams",
      values: { "2026-11-09": 33 },
    });
  });

  it("T-OC9: the Table view in Weekly has one row per week under 'Week (UTC)', marks the part weeks, and its Total equals the daily total", async () => {
    const user = userEvent.setup();
    panel({ daily: WEEK_DAILY, ...WEEK_RANGE }, { view: "table" });
    const dailyTotal = WEEK_DAILY.reduce((a, r) => a + r.spend, 0);
    await user.click(option("Bucket size", "Weekly"));

    expect(
      screen.getByRole("columnheader", { name: "Week (UTC)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Date (UTC)" }),
    ).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(1 + 3);
    expect(cell("Week of 9 Nov", "Week (UTC)")).toMatch(/part week/);
    expect(cell("Week of 16 Nov", "Week (UTC)")).not.toMatch(/part week/);
    expect(cell("Week of 23 Nov", "Week (UTC)")).toMatch(/part week/);
    expect(cell("Week of 9 Nov", "Total")).toBe("$30.00");
    expect(cell("Week of 16 Nov", "Total")).toBe("$6.00");
    expect(cell("Week of 23 Nov", "Total")).toBe("$9.00");
    const sum = ["Week of 9 Nov", "Week of 16 Nov", "Week of 23 Nov"].reduce(
      (a, w) => a + Number(cell(w, "Total")?.replace(/[$,]/g, "")),
      0,
    );
    expect(sum).toBe(dailyTotal);
  });

  it("T-OC9: Weekly keeps the metric (tokens are summed per week too)", () => {
    panel(
      { daily: WEEK_DAILY, ...WEEK_RANGE },
      { bucket: "weekly", metric: "tokens" },
    );
    expect(probeSeries()[0]?.values).toEqual({
      "2026-11-09": 3000,
      "2026-11-16": 600,
      "2026-11-23": 900,
    });
  });

  // T-OC10: one row per class of subtitle -- (metric, breakdown, bucket).
  it.each([
    [{}, "Daily spend"],
    [{ metric: "tokens", bucket: "weekly" }, "Weekly tokens"],
    [
      { metric: "requests", by: "team" },
      "Daily requests by team, 7 largest stacked",
    ],
    [
      { bucket: "weekly", by: "team" },
      "Weekly spend by team, 7 largest stacked",
    ],
  ] as const)("T-OC10: the subtitle for %j reads '%s'", (params, subtitle) => {
    panel({}, { ...params });
    expect(screen.getByText(subtitle)).toBeInTheDocument();
  });
});
