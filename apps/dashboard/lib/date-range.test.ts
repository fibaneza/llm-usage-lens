import { MAX_RANGE_DAYS as SHARED_MAX_RANGE_DAYS } from "@bedrock-usage/shared";
import { describe, expect, it } from "vitest";

import {
  clampCustomRange,
  defaultDateRange,
  inclusiveSpanDays,
  MAX_RANGE_DAYS,
  parseDay,
  presetForRange,
  resolvePreset,
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
