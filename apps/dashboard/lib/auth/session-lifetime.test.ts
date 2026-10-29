import { describe, expect, it } from "vitest";

import {
  SESSION_CLOCK_SKEW_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  isWithinSessionLifetime,
} from "./session-lifetime";

// Source: docs/specs/2026-05-15-system-architecture.md — "Authentication &
// Access" → "Account-mutation role": a session ends 8 hours after sign-in; a
// token with no valid sign-in time is rejected, and so is one whose sign-in
// time is more than 60 seconds in the future (clock-skew allowance), because a
// future stamp would otherwise outlive the 8-hour cap. Phase 3.3 amendment —
// "Hardening". `isWithinSessionLifetime` is pure: `now` is a parameter, so no
// clock is faked here (Rule 60.24).

const NOW = 1_793_000_000;
const HOUR = 60 * 60;
const SKEW_ALLOWANCE_SECONDS = 60;

describe("SESSION_MAX_AGE_SECONDS", () => {
  it("is 8 hours", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(8 * HOUR);
  });
});

describe("SESSION_CLOCK_SKEW_SECONDS", () => {
  it("is 60 seconds", () => {
    expect(SESSION_CLOCK_SKEW_SECONDS).toBe(60);
  });
});

describe("isWithinSessionLifetime", () => {
  describe("a sign-in time in the past", () => {
    it.each([
      ["right now", 0],
      ["1 second ago", 1],
      ["1 hour ago", HOUR],
      ["7 hours 59 minutes ago", 7 * HOUR + 59 * 60],
      ["exactly 8 hours ago (the cap is inclusive)", 8 * HOUR],
    ])("is within the lifetime when signed in %s", (_n, ago) => {
      expect(isWithinSessionLifetime(NOW - ago, NOW)).toBe(true);
    });

    it.each([
      ["1 second past 8 hours", 8 * HOUR + 1],
      ["9 hours", 9 * HOUR],
      ["3 days", 72 * HOUR],
    ])("is outside the lifetime when signed in %s ago", (_n, ago) => {
      expect(isWithinSessionLifetime(NOW - ago, NOW)).toBe(false);
    });
  });

  describe("a sign-in time in the future (clock-skew allowance of 60 seconds)", () => {
    it.each([
      ["1 second ahead", 1],
      ["30 seconds ahead", 30],
      [
        "exactly 60 seconds ahead (the allowance is inclusive)",
        SKEW_ALLOWANCE_SECONDS,
      ],
    ])("is within the lifetime when signed in %s", (_n, ahead) => {
      expect(isWithinSessionLifetime(NOW + ahead, NOW)).toBe(true);
    });

    it.each([
      ["61 seconds ahead", 61],
      ["5 minutes ahead", 5 * 60],
      ["1 hour ahead", HOUR],
      ["8 hours ahead", 8 * HOUR],
      ["1 year ahead", 365 * 24 * HOUR],
      ["the year 2100", 4_102_444_800 - NOW],
    ])("is outside the lifetime when signed in %s", (_n, ahead) => {
      expect(isWithinSessionLifetime(NOW + ahead, NOW)).toBe(false);
    });

    it("measures the allowance against the supplied now, not the wall clock", () => {
      const signedInAt = 1_000_000;
      expect(isWithinSessionLifetime(signedInAt, signedInAt - 60)).toBe(true);
      expect(isWithinSessionLifetime(signedInAt, signedInAt - 61)).toBe(false);
    });
  });

  describe("a malformed sign-in time (fail closed)", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a numeric string", String(NOW)],
      ["an ISO date string", new Date(NOW * 1000).toISOString()],
      ["a boolean", true],
      ["an object", {}],
      ["an array", [NOW]],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
    ])("is outside the lifetime when it is %s", (_n, signedInAt) => {
      expect(isWithinSessionLifetime(signedInAt, NOW)).toBe(false);
    });
  });
});
