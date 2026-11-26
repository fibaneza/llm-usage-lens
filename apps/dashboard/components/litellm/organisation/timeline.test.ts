import { describe, expect, it } from "vitest";

import { weeklyBuckets } from "./format";
import { bucketed, daysOf, valuesOf } from "./timeline";

// Sources: Design System - Component Inventory, `SpendTimelinePanel` (unit
// LP3, 2026-11-26): "the timeline helpers (`organisation/timeline.ts`, moved
// out of `OrgSpendPanel` by coordinator ruling)"; LD20 and Rule 20.1 (every
// UTC day from dateFrom to dateTo, never local time); T-OC9 (weekly sums).
// Contract: daysOf(dateFrom, dateTo): string[]; valuesOf(rows, metric):
// Record<date, number> skipping rows without the metric; bucketed(values,
// weekBuckets): Record<bucketKey, number> summing each bucket's days.
describe("timeline helpers (T-LP15)", () => {
  it("daysOf: every UTC day inclusive, across a month end, and one day for a one-day range", () => {
    expect(daysOf("2026-11-29", "2026-12-02")).toEqual([
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
    expect(daysOf("2026-11-14", "2026-11-14")).toEqual(["2026-11-14"]);
  });

  it("valuesOf: maps date to the metric and skips a row that does not report it", () => {
    const rows = [
      { date: "2026-11-14", spend: 1, tokens: 10 },
      { date: "2026-11-15", spend: 2 },
    ];
    expect(valuesOf(rows, "spend")).toEqual({
      "2026-11-14": 1,
      "2026-11-15": 2,
    });
    expect(valuesOf(rows, "tokens")).toEqual({ "2026-11-14": 10 });
    expect(valuesOf(rows, "requests")).toEqual({});
  });

  it("bucketed: sums each week's days under its Monday key and omits a week with no value", () => {
    const buckets = weeklyBuckets(daysOf("2026-11-14", "2026-11-25"));
    expect(
      bucketed(
        {
          "2026-11-14": 10,
          "2026-11-15": 20,
          "2026-11-16": 1,
          "2026-11-17": 2,
        },
        buckets,
      ),
    ).toEqual({ "2026-11-09": 30, "2026-11-16": 3 });
  });
});
