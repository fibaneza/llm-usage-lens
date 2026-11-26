import { afterEach, describe, expect, it } from "vitest";

import { weeklyBuckets } from "./format";

// Sources: Design System -- LiteLLM Organisation spend chart, the 2026-11-26
// comparison (T-OC9): a week is Monday to Sunday in UTC and is labelled by its
// first day ("Week of 17 Nov"); a first or last bucket that covers fewer than
// seven of the range's days is a part week; Rule 20.1 (UTC, never local time).
// Contract: weeklyBuckets(days: string[]) -> { key, label, days, part }[]; key
// is the week's Monday even when that Monday is before the range.
const range = (from: string, to: string) => {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("weeklyBuckets (T-OC9)", () => {
  it("T-OC9: a range starting mid-week gives a part first bucket keyed by its Monday, whole weeks, and a part last bucket", () => {
    // 2026-11-14 is a Saturday, 2026-11-25 a Wednesday.
    const buckets = weeklyBuckets(range("2026-11-14", "2026-11-25"));
    expect(buckets.map((b) => b.key)).toEqual([
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
    ]);
    expect(buckets.map((b) => b.label)).toEqual([
      "Week of 9 Nov",
      "Week of 16 Nov",
      "Week of 23 Nov",
    ]);
    expect(buckets.map((b) => b.part)).toEqual([true, false, true]);
    expect(buckets[0]?.days).toEqual(["2026-11-14", "2026-11-15"]);
    expect(buckets[1]?.days).toHaveLength(7);
    expect(buckets[2]?.days).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
  });

  it("T-OC9: a range of whole Monday-to-Sunday weeks has no part bucket", () => {
    const buckets = weeklyBuckets(range("2026-11-02", "2026-11-22"));
    expect(buckets.map((b) => b.key)).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
    expect(buckets.every((b) => !b.part)).toBe(true);
  });

  it("T-OC9: a week that crosses a month keeps its days together under the Monday in the earlier month", () => {
    // 2026-10-28 is a Wednesday; the week of Mon 26 Oct ends Sun 1 Nov.
    const buckets = weeklyBuckets(range("2026-10-28", "2026-11-09"));
    expect(buckets.map((b) => b.key)).toEqual([
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
    expect(buckets[0]?.label).toBe("Week of 26 Oct");
    expect(buckets[0]?.days).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(buckets.map((b) => b.part)).toEqual([true, false, true]);
  });

  it("T-OC9: every day of the range lands in exactly one bucket, in order; no days gives no buckets", () => {
    const days = range("2026-09-30", "2026-11-12");
    expect(weeklyBuckets(days).flatMap((b) => b.days)).toEqual(days);
    expect(weeklyBuckets([])).toEqual([]);
  });

  it.each(["Pacific/Kiritimati", "America/Los_Angeles"])(
    "T-OC9 / Rule 20.1: the buckets do not depend on the local time zone (%s)",
    (tz) => {
      process.env.TZ = tz;
      const buckets = weeklyBuckets(range("2026-11-14", "2026-11-25"));
      expect(buckets.map((b) => b.key)).toEqual([
        "2026-11-09",
        "2026-11-16",
        "2026-11-23",
      ]);
      expect(buckets.map((b) => b.label)).toEqual([
        "Week of 9 Nov",
        "Week of 16 Nov",
        "Week of 23 Nov",
      ]);
    },
  );
});
