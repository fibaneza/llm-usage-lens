import { describe, expect, it } from "vitest";

import {
  DateRangeQuerySchema,
  DEFAULT_RANKING_LIMIT,
  MAX_RANKING_LIMIT,
  RankingQuerySchema,
  TeamsQuerySchema,
} from "./queries";

// 2026 is not a leap year: 2026-01-01 → 2026-03-31 is exactly 90 inclusive
// days; 2026-04-01 makes it 91.
const RANGE_90_DAYS = { dateFrom: "2026-01-01", dateTo: "2026-03-31" };
const RANGE_91_DAYS = { dateFrom: "2026-01-01", dateTo: "2026-04-01" };

describe("DateRangeQuerySchema", () => {
  it("accepts a valid range without accountId", () => {
    const result = DateRangeQuerySchema.safeParse({
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a single-day range", () => {
    expect(
      DateRangeQuerySchema.safeParse({
        dateFrom: "2026-05-15",
        dateTo: "2026-05-15",
      }).success,
    ).toBe(true);
  });

  it("accepts a 12-digit accountId and rejects anything else", () => {
    expect(
      DateRangeQuerySchema.safeParse({
        ...RANGE_90_DAYS,
        accountId: "123456789012",
      }).success,
    ).toBe(true);
    expect(
      DateRangeQuerySchema.safeParse({
        ...RANGE_90_DAYS,
        accountId: "not-an-account",
      }).success,
    ).toBe(false);
  });

  it("accepts exactly the 90-day inclusive span", () => {
    expect(DateRangeQuerySchema.safeParse(RANGE_90_DAYS).success).toBe(true);
  });

  it("rejects a 91-day inclusive span", () => {
    const result = DateRangeQuerySchema.safeParse(RANGE_91_DAYS);
    expect(result.success).toBe(false);
  });

  it("rejects a reversed range", () => {
    expect(
      DateRangeQuerySchema.safeParse({
        dateFrom: "2026-05-31",
        dateTo: "2026-05-01",
      }).success,
    ).toBe(false);
  });

  it.each([
    "2026-02-31", // rolls over in naive Date parsing
    "2026-02-29", // 2026 is not a leap year
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-1-1",
    "2026-1-5",
    "20260105",
    "05-15-2026",
    "2026/05/15",
    "2026-05-15T00:00:00Z", // ISO datetime, not a calendar day
    "not-a-date",
  ])("rejects invalid calendar date %j", (dateFrom) => {
    expect(
      DateRangeQuerySchema.safeParse({ dateFrom, dateTo: "2026-05-15" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing dateFrom or dateTo", () => {
    expect(
      DateRangeQuerySchema.safeParse({ dateTo: "2026-05-15" }).success,
    ).toBe(false);
    expect(
      DateRangeQuerySchema.safeParse({ dateFrom: "2026-05-15" }).success,
    ).toBe(false);
    expect(DateRangeQuerySchema.safeParse({}).success).toBe(false);
  });

  it("accepts the leap day in a real leap year", () => {
    expect(
      DateRangeQuerySchema.safeParse({
        dateFrom: "2028-02-29",
        dateTo: "2028-03-01",
      }).success,
    ).toBe(true);
  });
});

describe("RankingQuerySchema", () => {
  const base = { ...RANGE_90_DAYS, tab: "departments" };

  it("accepts each valid tab", () => {
    for (const tab of ["departments", "teams", "services", "users"]) {
      expect(
        RankingQuerySchema.safeParse({ ...RANGE_90_DAYS, tab }).success,
      ).toBe(true);
    }
  });

  it("rejects an unknown tab", () => {
    expect(
      RankingQuerySchema.safeParse({ ...RANGE_90_DAYS, tab: "models" }).success,
    ).toBe(false);
  });

  it("rejects a missing tab", () => {
    expect(RankingQuerySchema.safeParse(RANGE_90_DAYS).success).toBe(false);
  });

  it("defaults order and limit", () => {
    const result = RankingQuerySchema.parse(base);
    expect(result.order).toBe("desc");
    expect(result.limit).toBe(DEFAULT_RANKING_LIMIT);
  });

  it("coerces a string limit from query params", () => {
    expect(RankingQuerySchema.parse({ ...base, limit: "25" }).limit).toBe(25);
  });

  it("accepts the inclusive limit bounds 1 and MAX_RANKING_LIMIT", () => {
    expect(RankingQuerySchema.parse({ ...base, limit: 1 }).limit).toBe(1);
    expect(
      RankingQuerySchema.parse({ ...base, limit: String(MAX_RANKING_LIMIT) })
        .limit,
    ).toBe(MAX_RANKING_LIMIT);
  });

  it("rejects out-of-bounds or fractional limits", () => {
    expect(RankingQuerySchema.safeParse({ ...base, limit: 0 }).success).toBe(
      false,
    );
    expect(RankingQuerySchema.safeParse({ ...base, limit: -5 }).success).toBe(
      false,
    );
    expect(
      RankingQuerySchema.safeParse({ ...base, limit: MAX_RANKING_LIMIT + 1 })
        .success,
    ).toBe(false);
    expect(
      RankingQuerySchema.safeParse({
        ...base,
        limit: String(MAX_RANKING_LIMIT + 1),
      }).success,
    ).toBe(false);
    expect(RankingQuerySchema.safeParse({ ...base, limit: 2.5 }).success).toBe(
      false,
    );
  });

  it("rejects a non-numeric limit string", () => {
    expect(
      RankingQuerySchema.safeParse({ ...base, limit: "ten" }).success,
    ).toBe(false);
  });

  it("accepts both sort orders and rejects unknown ones", () => {
    expect(RankingQuerySchema.parse({ ...base, order: "asc" }).order).toBe(
      "asc",
    );
    expect(RankingQuerySchema.parse({ ...base, order: "desc" }).order).toBe(
      "desc",
    );
    expect(
      RankingQuerySchema.safeParse({ ...base, order: "descending" }).success,
    ).toBe(false);
  });

  it("accepts only canonical model keys", () => {
    expect(
      RankingQuerySchema.safeParse({ ...base, model: "claude-opus" }).success,
    ).toBe(true);
    expect(
      RankingQuerySchema.safeParse({ ...base, model: "gpt-4" }).success,
    ).toBe(false);
  });

  it("accepts an optional sortBy metric and rejects unknown fields", () => {
    expect(
      RankingQuerySchema.safeParse({ ...base, sortBy: "invocations" }).success,
    ).toBe(true);
    expect(
      RankingQuerySchema.safeParse({ ...base, sortBy: "name" }).success,
    ).toBe(false);
  });

  it("enforces the 90-day cap and ordering like the date-range schema", () => {
    expect(
      RankingQuerySchema.safeParse({ ...RANGE_91_DAYS, tab: "teams" }).success,
    ).toBe(false);
    expect(
      RankingQuerySchema.safeParse({
        dateFrom: "2026-05-31",
        dateTo: "2026-05-01",
        tab: "teams",
      }).success,
    ).toBe(false);
  });
});

describe("TeamsQuerySchema", () => {
  it("accepts a range with and without departmentId", () => {
    expect(TeamsQuerySchema.safeParse(RANGE_90_DAYS).success).toBe(true);
    expect(
      TeamsQuerySchema.safeParse({
        ...RANGE_90_DAYS,
        departmentId: "dept-engineering",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty departmentId", () => {
    expect(
      TeamsQuerySchema.safeParse({ ...RANGE_90_DAYS, departmentId: "" })
        .success,
    ).toBe(false);
  });

  it("enforces the 90-day cap", () => {
    expect(TeamsQuerySchema.safeParse(RANGE_91_DAYS).success).toBe(false);
  });
});
