import { MAX_RANGE_DAYS as SHARED_MAX_RANGE_DAYS } from "@llm-usage-lens/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  clampCustomRange,
  defaultDateRange,
  fromLocalDay,
  inclusiveSpanDays,
  MAX_RANGE_DAYS,
  parseDay,
  presetForRange,
  previousRange,
  resolvePreset,
  toLocalDay,
} from "./date-range";

// A fixed reference instant so preset arithmetic is deterministic (Rule 60.24 —
// no wall-clock reads). Midday UTC keeps the UTC calendar day unambiguous.
const NOW = new Date("2026-06-10T12:00:00.000Z");

describe("resolvePreset", () => {
  // Spans are asserted relative to the same `now` rather than as absolute date
  // strings, so the suite holds regardless of the host timezone.
  it("resolves each preset to its inclusive day span ending today", () => {
    expect(inclusiveSpanDays(resolvePreset("7d", NOW))).toBe(7);
    expect(inclusiveSpanDays(resolvePreset("30d", NOW))).toBe(30);
    expect(inclusiveSpanDays(resolvePreset("90d", NOW))).toBe(90);
  });

  it("pins dateTo to today for every preset", () => {
    const today = resolvePreset("7d", NOW).dateTo;
    expect(resolvePreset("30d", NOW).dateTo).toBe(today);
    expect(resolvePreset("90d", NOW).dateTo).toBe(today);
  });

  it("falls back to the 30-day span for the custom preset", () => {
    expect(inclusiveSpanDays(resolvePreset("custom", NOW))).toBe(30);
  });
});

describe("defaultDateRange", () => {
  it("is the 30-day preset", () => {
    expect(defaultDateRange(NOW)).toEqual(resolvePreset("30d", NOW));
  });
});

describe("presetForRange", () => {
  it("round-trips each resolved preset back to its key", () => {
    expect(presetForRange(resolvePreset("7d", NOW), NOW)).toBe("7d");
    expect(presetForRange(resolvePreset("30d", NOW), NOW)).toBe("30d");
    expect(presetForRange(resolvePreset("90d", NOW), NOW)).toBe("90d");
  });

  it("is custom when dateTo is not today", () => {
    const past = { dateFrom: "2026-01-01", dateTo: "2026-01-30" };
    expect(presetForRange(past, NOW)).toBe("custom");
  });

  it("is custom when the span matches no preset", () => {
    const fourteen = resolvePreset("7d", NOW);
    const odd = { dateFrom: "2026-05-28", dateTo: fourteen.dateTo };
    expect(presetForRange(odd, NOW)).toBe("custom");
  });
});

describe("clampCustomRange", () => {
  it("caps an over-long span to the 90-day maximum", () => {
    const result = clampCustomRange({
      dateFrom: "2026-01-01",
      dateTo: "2026-06-10",
    });
    expect(inclusiveSpanDays(result)).toBe(MAX_RANGE_DAYS);
    // dateTo is preserved; dateFrom is pulled forward toward it.
    expect(result.dateTo).toBe("2026-06-10");
  });

  it("normalizes a reversed range without changing its span", () => {
    const result = clampCustomRange({
      dateFrom: "2026-06-10",
      dateTo: "2026-06-01",
    });
    expect(result).toEqual({ dateFrom: "2026-06-01", dateTo: "2026-06-10" });
  });

  it("leaves a within-cap range unchanged", () => {
    const within = { dateFrom: "2026-05-12", dateTo: "2026-06-10" };
    expect(clampCustomRange(within)).toEqual(within);
  });
});

// Audit A1: parseDay backs values read from the URL, so invalid input yields
// `undefined` (the same "absent" signal callers already handle) instead of an
// Invalid Date that crashes date-fns `format`.
describe("parseDay", () => {
  it("parses a valid yyyy-MM-dd day as UTC midnight", () => {
    expect(parseDay("2026-06-10")?.toISOString()).toBe(
      "2026-06-10T00:00:00.000Z",
    );
  });

  it.each(["x-y-z", "garbage", "", "2026-13-01", "2026-02-30", "2026-6-1"])(
    "returns undefined for %j",
    (value) => {
      expect(parseDay(value)).toBeUndefined();
    },
  );
});

// W3: one source of truth for the 90-day cap (Rule 20.8).
describe("MAX_RANGE_DAYS", () => {
  it("equals the shared DateRangeQuerySchema constant", () => {
    expect(MAX_RANGE_DAYS).toBe(SHARED_MAX_RANGE_DAYS);
  });
});

// Local-day <-> UTC-day boundary conversion (design-system — Date Filtering:
// URL days are UTC calendar days, date-fns/react-day-picker work in local days;
// date-fns is for display only). Node re-reads process.env.TZ on assignment,
// so each case pins an explicit zone and restores it afterwards.
describe("toLocalDay / fromLocalDay", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  const ZONES = [
    "UTC",
    "America/Los_Angeles", // UTC-8/-7
    "Pacific/Auckland", // UTC+12/+13
    "Pacific/Kiritimati", // UTC+14
  ];

  describe.each(ZONES)("in %s", (tz) => {
    const DAYS = [
      "2026-01-01",
      "2025-12-31", // year boundary
      "2026-02-28",
      "2028-02-29", // leap day
      "2026-03-01", // month boundary
      "2026-03-08", // US spring-forward
      "2026-11-01", // US fall-back
      "2026-09-27", // NZ spring-forward
      "2026-04-05", // NZ fall-back
    ];

    it.each(DAYS)(
      "toLocalDay(%s) is local midnight of that calendar day",
      (day) => {
        process.env.TZ = tz;
        const [y, m, d] = day.split("-").map(Number);
        const local = toLocalDay(day);
        expect(local.getFullYear()).toBe(y);
        expect(local.getMonth()).toBe((m ?? 1) - 1);
        expect(local.getDate()).toBe(d);
        expect(local.getHours()).toBe(0);
        expect(local.getMinutes()).toBe(0);
      },
    );

    it.each(DAYS)("round-trips %s unchanged", (day) => {
      process.env.TZ = tz;
      expect(fromLocalDay(toLocalDay(day))).toBe(day);
    });

    it("fromLocalDay ignores the time of day within the local day", () => {
      process.env.TZ = tz;
      expect(fromLocalDay(new Date(2026, 5, 10, 0, 0, 0))).toBe("2026-06-10");
      expect(fromLocalDay(new Date(2026, 5, 10, 23, 59, 59))).toBe(
        "2026-06-10",
      );
    });

    it("pads single-digit months and days", () => {
      process.env.TZ = tz;
      expect(fromLocalDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    });
  });
});

// Phase 4.1 — DeltaBadge compares a range against the period immediately before
// it: same inclusive length, ending the day before `dateFrom`. Arithmetic is in
// UTC calendar days (Rule 20.1), so a host timezone can never shift a boundary.
describe("previousRange", () => {
  it("returns the 7 days immediately before a 7-day range", () => {
    const current = resolvePreset("7d", NOW);
    expect(current).toEqual({ dateFrom: "2026-06-04", dateTo: "2026-06-10" });

    expect(previousRange(current)).toEqual({
      dateFrom: "2026-05-28",
      dateTo: "2026-06-03",
    });
  });

  it("keeps the inclusive length for the 7, 30 and 90-day presets", () => {
    for (const preset of ["7d", "30d", "90d"] as const) {
      const current = resolvePreset(preset, NOW);
      expect(inclusiveSpanDays(previousRange(current))).toBe(
        inclusiveSpanDays(current),
      );
    }
  });

  it("ends the day before the current range starts, with no gap or overlap", () => {
    for (const preset of ["7d", "30d", "90d"] as const) {
      const current = resolvePreset(preset, NOW);
      const previous = previousRange(current);
      const dayAfterPreviousEnds = new Date(
        Date.parse(`${previous.dateTo}T00:00:00Z`) + 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);
      expect(dayAfterPreviousEnds).toBe(current.dateFrom);
    }
  });

  it("resolves the 30-day and 90-day presets to the exact preceding window", () => {
    expect(previousRange(resolvePreset("30d", NOW))).toEqual({
      dateFrom: "2026-04-12",
      dateTo: "2026-05-11",
    });
    expect(previousRange(resolvePreset("90d", NOW))).toEqual({
      dateFrom: "2025-12-13",
      dateTo: "2026-03-12",
    });
  });

  it("maps a single-day range to the previous single day", () => {
    expect(
      previousRange({ dateFrom: "2026-06-10", dateTo: "2026-06-10" }),
    ).toEqual({ dateFrom: "2026-06-09", dateTo: "2026-06-09" });
  });

  it("crosses month and year boundaries", () => {
    expect(
      previousRange({ dateFrom: "2026-01-01", dateTo: "2026-01-07" }),
    ).toEqual({ dateFrom: "2025-12-25", dateTo: "2025-12-31" });
  });

  it("counts a leap day as a calendar day", () => {
    expect(
      previousRange({ dateFrom: "2024-03-01", dateTo: "2024-03-07" }),
    ).toEqual({ dateFrom: "2024-02-23", dateTo: "2024-02-29" });
  });

  it("does not mutate its argument", () => {
    const current = { dateFrom: "2026-06-04", dateTo: "2026-06-10" };
    previousRange(current);
    expect(current).toEqual({ dateFrom: "2026-06-04", dateTo: "2026-06-10" });
  });

  describe("is host-timezone independent", () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it.each([
      "UTC",
      "America/Los_Angeles",
      "Pacific/Auckland",
      "Pacific/Kiritimati",
    ])("in %s across a DST change", (tz) => {
      process.env.TZ = tz;
      expect(
        previousRange({ dateFrom: "2026-03-09", dateTo: "2026-03-15" }),
      ).toEqual({ dateFrom: "2026-03-02", dateTo: "2026-03-08" });
      expect(
        previousRange({ dateFrom: "2026-11-02", dateTo: "2026-11-08" }),
      ).toEqual({ dateFrom: "2026-10-26", dateTo: "2026-11-01" });
    });
  });
});
