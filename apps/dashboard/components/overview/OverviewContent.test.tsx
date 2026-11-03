import {
  screen,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateRangePicker } from "@/components/filters/DateRangePicker";
import {
  inclusiveSpanDays,
  previousRange,
  resolvePreset,
} from "@/lib/date-range";
import {
  apiError,
  apiResponse,
  emptyOverviewFixture,
  NEVER,
  NEVER_SYNCED,
  overviewFixture,
  stubApi,
  syncedFixture,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { OverviewContent } from "./OverviewContent";

// Source: implementation-phases Phase 4.1 (sections, tasks, Verify: "page
// renders with seed data, skeletons show during load, date filter updates all
// sections"); Design System — Overview Page; Data Model — Dashboard impact
// (v1); Rules 20.9, 40.4, 60.12, 60.24. The sections are exercised together
// through the real hooks, `fetchApi` and nuqs with a stubbed same-origin fetch.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PREVIOUS = previousRange(RANGE);
const URL_PARAMS = { searchParams: RANGE };

const SKELETON = '[data-slot="skeleton"]';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Serves `current` for any range and `previous` for the period just before
// RANGE, so the comparison request is distinguishable from the main one.
function overviewFor(
  current = overviewFixture(),
  previous = overviewFixture({ totalCost: 1000 }),
) {
  return (url: URL) =>
    apiResponse({
      data:
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? previous
          : current,
    });
}

async function card(title: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found =
      screen.queryByRole("region", { name: title }) ??
      screen.queryByRole("group", { name: title });
    if (!found) throw new Error(`no metric card named "${title}"`);
    return found;
  });
}

function skeletons(view: RenderResult): number {
  return view.container.querySelectorAll(SKELETON).length;
}

describe("OverviewContent — KPI row", () => {
  it("renders the five metric cards", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    for (const title of [
      "Total Cost",
      "Total Tokens",
      "Total Invocations",
      "Most Used Model",
      "Active Accounts",
    ]) {
      expect(await card(title)).toBeInTheDocument();
    }
  });

  it("formats Total Cost as USD", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect(await card("Total Cost")).toHaveTextContent("$1,234.56");
  });

  it("shows the model / non-model split on Total Cost (Data Model — Dashboard impact)", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect(await card("Total Cost")).toHaveTextContent(
      /Model \$1,000\.00\s*·\s*Non-model \$234\.56/,
    );
  });

  it("carries the 'Bedrock service charges only' scope note", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect(await card("Total Cost")).toHaveTextContent(
      "Bedrock service charges only",
    );
  });

  it("marks recurring non-model categories with a Recurring indicator", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    const totalCost = await card("Total Cost");
    expect(totalCost).toHaveTextContent(/recurring/i);
    expect(totalCost).toHaveTextContent(/provisioned/i);
  });

  it("shows no Recurring indicator when no category is recurring", async () => {
    const current = overviewFixture({
      nonModelByCategory: [
        { category: "guardrails", cost: 34.56, recurring: false },
      ],
    });
    stubApi({
      overview: overviewFor(current),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect(await card("Total Cost")).not.toHaveTextContent(/recurring/i);
  });

  it("shows Total Tokens as input plus output", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    // 1,000,000 input + 500,000 output; compact or grouped notation both fit.
    expect(await card("Total Tokens")).toHaveTextContent(/1,500,000|1\.5M/);
  });

  it("shows Total Invocations and Active Accounts", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect(await card("Total Invocations")).toHaveTextContent(
      /2,000|2(\.0)?K/i,
    );
    expect(await card("Active Accounts")).toHaveTextContent("7");
  });

  it("shows the display name of the most used model", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect(await card("Most Used Model")).toHaveTextContent("Claude Opus");
  });

  it("shows an em dash, not null, when there is no most used model", async () => {
    stubApi({
      overview: overviewFor(overviewFixture({ mostUsedModel: null })),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    const mostUsed = await card("Most Used Model");
    expect(mostUsed).toHaveTextContent("—");
    expect(mostUsed).not.toHaveTextContent(/null|undefined/);
  });

  it("renders an empty period as zeros without crashing", async () => {
    stubApi({
      overview: () => apiResponse({ data: emptyOverviewFixture() }),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    const totalCost = await card("Total Cost");
    expect(totalCost).toHaveTextContent("$0.00");
    expect(totalCost).not.toHaveTextContent(/recurring/i);
    expect(await card("Active Accounts")).toHaveTextContent("0");
    expect(await card("Most Used Model")).toHaveTextContent("—");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

describe("OverviewContent — DeltaBadge vs the previous period", () => {
  it("requests the previous period (same length, ending the day before) as well as the current one", async () => {
    const api = stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);
    await card("Total Cost");

    await waitFor(() => {
      const ranges = api.overviewRanges();
      expect(ranges).toContainEqual(RANGE);
      expect(ranges).toContainEqual(PREVIOUS);
    });
    expect(PREVIOUS).toEqual({ dateFrom: "2026-01-01", dateTo: "2026-01-10" });
  });

  it("shows the percentage increase against the previous total", async () => {
    // 1234.56 vs 1000 -> +23.456% -> "+23.5%"
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    await waitFor(async () => {
      expect(await card("Total Cost")).toHaveTextContent("+23.5%");
    });
  });

  it("shows the percentage decrease against the previous total", async () => {
    // 900 vs 1000 -> -10.0%
    stubApi({
      overview: overviewFor(
        overviewFixture({ totalCost: 900 }),
        overviewFixture({ totalCost: 1000 }),
      ),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    await waitFor(async () => {
      expect(await card("Total Cost")).toHaveTextContent(/[−-]10\.0%/);
    });
  });

  it("shows no delta when the previous period had no cost (no fake 0%)", async () => {
    stubApi({
      overview: overviewFor(
        overviewFixture(),
        overviewFixture({ totalCost: 0, modelCost: 0, nonModelCost: 0 }),
      ),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    const view = renderWithProviders(<OverviewContent />, URL_PARAMS);
    const totalCost = await card("Total Cost");
    await waitFor(() => expect(totalCost).toHaveTextContent("$1,234.56"));

    expect(within(totalCost).queryByText(/%/)).not.toBeInTheDocument();
    expect(view.container).toBeInTheDocument();
  });

  it("still shows the current period when the comparison request fails", async () => {
    stubApi({
      overview: (url) =>
        url.searchParams.get("dateFrom") === PREVIOUS.dateFrom
          ? apiError(500)
          : apiResponse({ data: overviewFixture() }),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    const totalCost = await card("Total Cost");
    await waitFor(() => expect(totalCost).toHaveTextContent("$1,234.56"));
    expect(within(totalCost).queryByText(/%/)).not.toBeInTheDocument();
  });
});

describe("OverviewContent — chart sections and sync status", () => {
  it("renders all five sections once data arrives", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: syncedFixture() }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    await card("Total Cost");
    expect((await screen.findAllByText(/cost trend/i)).length).toBeGreaterThan(
      0,
    );
    expect(
      (await screen.findAllByText(/top (5 )?departments/i)).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(/model distribution/i)).length,
    ).toBeGreaterThan(0);
    expect((await screen.findAllByText(/sync status/i)).length).toBeGreaterThan(
      0,
    );
  });

  it("feeds the top departments and model distribution charts from the response", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    // Each chart exposes its data in a visually hidden table/list (contract).
    expect(
      (await screen.findAllByText("Engineering", {}, { timeout: 5000 })).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Data Science").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Claude Sonnet").length).toBeGreaterThan(0);
    // Non-model cost is its own segment, never merged into "Other models".
    expect(screen.getAllByText("Non-model charges").length).toBeGreaterThan(0);
  });

  it("shows the neutral 'No sync yet' state when SyncStatus is missing (Rule 20.9)", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect((await screen.findAllByText(/no sync yet/i)).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

describe("OverviewContent — loading skeletons (Rule 40.4)", () => {
  it("shows skeletons, and no figures, while the overview request is pending", () => {
    stubApi({
      overview: NEVER,
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    const view = renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect(skeletons(view)).toBeGreaterThan(0);
    expect(screen.queryByText("$1,234.56")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("gives every section its own skeleton while all data is pending", () => {
    stubApi({ overview: NEVER, syncStatus: NEVER });
    const view = renderWithProviders(<OverviewContent />, URL_PARAMS);

    // KPI row (5 cards) + 3 chart sections + sync status: at least one
    // skeleton per section, so well over the section count in total.
    expect(skeletons(view)).toBeGreaterThanOrEqual(5);
  });

  it("does not hold the sync section hostage to a slow overview request", async () => {
    stubApi({
      overview: NEVER,
      syncStatus: () => apiResponse({ data: syncedFixture() }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect((await screen.findAllByText(/success/i)).length).toBeGreaterThan(0);
  });

  it("does not hold the KPI row hostage to a slow sync-status request", async () => {
    stubApi({ overview: overviewFor(), syncStatus: NEVER });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    expect(await card("Total Cost")).toHaveTextContent("$1,234.56");
  });

  it("replaces skeletons with content once the data resolves", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    const view = renderWithProviders(<OverviewContent />, URL_PARAMS);
    await card("Total Cost");
    await screen.findAllByText(/no sync yet/i);
    await screen.findAllByText("Engineering", {}, { timeout: 5000 });

    await waitFor(() => expect(skeletons(view)).toBe(0));
  });
});

describe("OverviewContent — per-section error isolation (Rule 40.4, 60.12)", () => {
  it("shows an alert in each overview-driven section when /api/overview fails, and keeps sync status", async () => {
    stubApi({
      overview: () => apiError(500),
      syncStatus: () => apiResponse({ data: syncedFixture() }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    // KPI row, cost trend, top departments, model distribution.
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(4));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/couldn.t load/i);
    expect(screen.getAllByText(/success/i).length).toBeGreaterThan(0);
  });

  it("shows a single alert, leaving every other section intact, when /api/sync-status fails", async () => {
    stubApi({
      overview: overviewFor(),
      syncStatus: () => apiError(500),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(await card("Total Cost")).toHaveTextContent("$1,234.56");
    expect(await card("Active Accounts")).toHaveTextContent("7");
  });

  it("recovers a failed section through its Retry button", async () => {
    let syncCalls = 0;
    stubApi({
      overview: overviewFor(),
      syncStatus: () => {
        syncCalls += 1;
        return syncCalls === 1
          ? apiError(500)
          : apiResponse({ data: NEVER_SYNCED });
      },
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);
    const alert = await screen.findByRole("alert");

    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect((await screen.findAllByText(/no sync yet/i)).length).toBeGreaterThan(
      0,
    );
    expect(syncCalls).toBe(2);
  });
});

// Rule 40.4: sections fail independently, but a section that failed must not
// outlive the cause. Phase 4.1 Verify: "date filter updates all sections".
describe("OverviewContent — errored sections recover (Rule 40.4)", () => {
  it("clears every errored section when the date range changes, without a Retry click", async () => {
    const seven = resolvePreset("7d");
    const okFrom = [seven.dateFrom, previousRange(seven).dateFrom];
    const sevenData = overviewFixture({
      totalCost: 77.7,
      modelCost: 77.7,
      nonModelCost: 0,
      nonModelByCategory: [],
      topDepartments: [
        { departmentId: "dept-mkt", departmentName: "Marketing", cost: 77.7 },
      ],
    });
    stubApi({
      overview: (url) =>
        okFrom.includes(url.searchParams.get("dateFrom") ?? "")
          ? apiResponse({ data: sevenData })
          : apiError(500),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(
      <>
        <DateRangePicker />
        <OverviewContent />
      </>,
      URL_PARAMS,
    );
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(4));

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /last 7 days/i }));

    await waitFor(async () =>
      expect(await card("Total Cost")).toHaveTextContent("$77.70"),
    );
    await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
    expect(
      (await screen.findAllByText("Marketing", {}, { timeout: 5000 })).length,
    ).toBeGreaterThan(0);
  });

  it("recovers every section sharing the query when one Retry succeeds", async () => {
    let failing = true;
    stubApi({
      overview: () =>
        failing ? apiError(500) : apiResponse({ data: overviewFixture() }),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    const view = renderWithProviders(<OverviewContent />, URL_PARAMS);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(4));

    failing = false;
    await userEvent
      .setup()
      .click(
        within(screen.getAllByRole("alert")[0] as HTMLElement).getByRole(
          "button",
          { name: /retry/i },
        ),
      );

    expect(await card("Total Cost")).toHaveTextContent("$1,234.56");
    await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
    expect(
      (await screen.findAllByText("Engineering", {}, { timeout: 5000 })).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Claude Sonnet").length).toBeGreaterThan(0);
    await waitFor(() => expect(skeletons(view)).toBe(0));
  });
});

describe("OverviewContent — date filter drives every section", () => {
  it("requests the range carried in the URL", async () => {
    const api = stubApi({
      overview: overviewFor(),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, URL_PARAMS);
    await card("Total Cost");

    await waitFor(() => expect(api.overviewRanges()).toContainEqual(RANGE));
  });

  it("defaults to the last 30 days, with a 30-day comparison period, when the URL has no range", async () => {
    const api = stubApi({
      overview: () => apiResponse({ data: overviewFixture() }),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />);
    await card("Total Cost");

    const thirty = resolvePreset("30d");
    await waitFor(() => {
      const ranges = api.overviewRanges();
      expect(ranges).toContainEqual(thirty);
      expect(ranges).toContainEqual(previousRange(thirty));
    });
    for (const range of api.overviewRanges()) {
      expect(
        inclusiveSpanDays({
          dateFrom: range.dateFrom ?? "",
          dateTo: range.dateTo ?? "",
        }),
      ).toBe(30);
    }
  });

  it("falls back to the default range, not an error, for a malformed URL range", async () => {
    const api = stubApi({
      overview: () => apiResponse({ data: overviewFixture() }),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(<OverviewContent />, {
      searchParams: { dateFrom: "garbage", dateTo: "2026-01-20" },
    });
    await card("Total Cost");

    expect(api.overviewRanges()).toContainEqual(resolvePreset("30d"));
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("refetches and re-renders every overview section when the preset changes", async () => {
    const seven = resolvePreset("7d");
    const sevenData = overviewFixture({
      totalCost: 77.7,
      modelCost: 77.7,
      nonModelCost: 0,
      topDepartments: [
        { departmentId: "dept-mkt", departmentName: "Marketing", cost: 77.7 },
      ],
    });
    const api = stubApi({
      overview: (url) =>
        apiResponse({
          data:
            url.searchParams.get("dateFrom") === seven.dateFrom
              ? sevenData
              : overviewFixture(),
        }),
      syncStatus: () => apiResponse({ data: NEVER_SYNCED }),
    });
    renderWithProviders(
      <>
        <DateRangePicker />
        <OverviewContent />
      </>,
    );
    expect(await card("Total Cost")).toHaveTextContent("$1,234.56");
    await screen.findAllByText("Engineering", {}, { timeout: 5000 });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /last 7 days/i }));

    await waitFor(() => {
      const ranges = api.overviewRanges();
      expect(ranges).toContainEqual(seven);
      expect(ranges).toContainEqual(previousRange(seven));
    });
    await waitFor(async () =>
      expect(await card("Total Cost")).toHaveTextContent("$77.70"),
    );
    // The chart sections re-render with the new range's data too.
    expect(
      (await screen.findAllByText("Marketing", {}, { timeout: 5000 })).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.queryByText("Engineering")).not.toBeInTheDocument(),
    );
  });
});
