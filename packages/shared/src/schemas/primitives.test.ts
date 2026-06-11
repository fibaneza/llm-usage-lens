import { describe, expect, it } from "vitest";

import {
  AccountIdSchema,
  Iso8601Schema,
  UtcDaySchema,
  parseUtcDayMs,
} from "./primitives";

describe("AccountIdSchema", () => {
  it("accepts a 12-digit account ID", () => {
    expect(AccountIdSchema.safeParse("123456789012").success).toBe(true);
    expect(AccountIdSchema.safeParse("000000000000").success).toBe(true);
  });

  it.each([
    "12345678901", // 11 digits
    "1234567890123", // 13 digits
    "12345678901a",
    " 123456789012",
    "123456789012 ",
    "",
  ])("rejects %j", (value) => {
    expect(AccountIdSchema.safeParse(value).success).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(AccountIdSchema.safeParse(123456789012).success).toBe(false);
  });
});

describe("Iso8601Schema", () => {
  it.each([
    "2026-05-15T13:00:00Z",
    "2026-05-15T13:00:00.000Z",
    "2026-05-15T13:00:00+02:00",
    "2026-05-15T13:00:00-05:00",
  ])("accepts %j", (value) => {
    expect(Iso8601Schema.safeParse(value).success).toBe(true);
  });

  it.each([
    "2026-05-15T13:00:00", // no zone designator
    "2026-05-15", // calendar day, not a datetime
    "2026-05-15 13:00:00Z", // space separator
    "not-a-timestamp",
    "",
  ])("rejects %j", (value) => {
    expect(Iso8601Schema.safeParse(value).success).toBe(false);
  });

  it("rejects epoch numbers", () => {
    expect(Iso8601Schema.safeParse(1747314000000).success).toBe(false);
  });
});

describe("parseUtcDayMs", () => {
  it("parses the epoch day to 0", () => {
    expect(parseUtcDayMs("1970-01-01")).toBe(0);
  });

  it("parses as UTC midnight regardless of host timezone", () => {
    expect(parseUtcDayMs("2026-05-15")).toBe(Date.UTC(2026, 4, 15));
  });

  it("returns null for calendar dates that would roll over", () => {
    // new Date("2026-02-31") would silently become March 3rd.
    expect(parseUtcDayMs("2026-02-31")).toBeNull();
    expect(parseUtcDayMs("2026-04-31")).toBeNull();
    expect(parseUtcDayMs("2026-02-29")).toBeNull(); // 2026 is not a leap year
  });

  it("accepts the leap day in a leap year", () => {
    expect(parseUtcDayMs("2028-02-29")).toBe(Date.UTC(2028, 1, 29));
  });

  it.each([
    "2026-1-5", // unpadded
    "20260105", // compact
    "2026-05-15T00:00:00Z", // datetime, not a day
    "2026/05/15",
    "",
  ])("returns null for malformed input %j", (value) => {
    expect(parseUtcDayMs(value)).toBeNull();
  });
});

describe("UtcDaySchema", () => {
  it("accepts a valid UTC calendar day", () => {
    expect(UtcDaySchema.safeParse("2026-05-15").success).toBe(true);
  });

  it.each(["2026-02-30", "2026-1-5", "20260105", "2026-05-15T00:00:00Z"])(
    "rejects %j",
    (value) => {
      expect(UtcDaySchema.safeParse(value).success).toBe(false);
    },
  );
});
