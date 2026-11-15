import { describe, expect, it } from "vitest";

import { REAUTH_MAX_AGE_SECONDS, hasRecentAuth } from "./recent-auth";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication"
// (D28): hasRecentAuth is true only for a finite number with
// now - 900 <= authTime <= now + 60 (the session clock-skew allowance);
// threat T30 (unit `hasRecentAuth` boundaries). `now` is a parameter, so no
// clock is faked (Rule 60.24).
const NOW = 1_793_000_000;

describe("REAUTH_MAX_AGE_SECONDS", () => {
  it("is 900 (15 minutes)", () => {
    expect(REAUTH_MAX_AGE_SECONDS).toBe(900);
  });
});

describe("hasRecentAuth", () => {
  it("is true for a sign-in at exactly now", () => {
    expect(hasRecentAuth(NOW, NOW)).toBe(true);
  });

  it("is true 900 seconds ago and false 901 seconds ago", () => {
    expect(hasRecentAuth(NOW - 900, NOW)).toBe(true);
    expect(hasRecentAuth(NOW - 901, NOW)).toBe(false);
  });

  it("allows 60 seconds of clock skew into the future and no more", () => {
    expect(hasRecentAuth(NOW + 60, NOW)).toBe(true);
    expect(hasRecentAuth(NOW + 61, NOW)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("is false for %s (no authTime: a step-up is needed)", (_n, value) => {
    expect(hasRecentAuth(value, NOW)).toBe(false);
  });

  it.each([
    ["a numeric string", String(NOW)],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["an object", { valueOf: () => NOW }],
    ["an array", [NOW]],
    ["a boolean", true],
    ["a bigint", BigInt(NOW)],
  ])("is false for %s", (_n, value) => {
    expect(hasRecentAuth(value, NOW)).toBe(false);
  });

  it("is false for a very old sign-in", () => {
    expect(hasRecentAuth(0, NOW)).toBe(false);
  });
});
