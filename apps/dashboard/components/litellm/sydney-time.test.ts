import { describe, expect, it } from "vitest";

import { formatSydneyTime } from "./sydney-time";

// Source: docs/specs/2026-11-10-litellm.md -- LD20: LiteLLM timestamps are
// rendered in Australia/Sydney (AEDT in summer, AEST in winter) with the zone
// label. Fixed ISO inputs, so no clock is involved (Rule 60.24).
describe("formatSydneyTime", () => {
  it("renders a summer instant in AEDT (UTC+11) with the zone label", () => {
    expect(formatSydneyTime("2026-11-15T13:00:00Z")).toMatch(
      /16 Nov 2026,? 00:00 AEDT/,
    );
  });

  it("renders a winter instant in AEST (UTC+10) with the zone label", () => {
    expect(formatSydneyTime("2026-07-01T00:00:00Z")).toMatch(
      /1 Jul 2026,? 10:00 AEST/,
    );
  });

  it("returns a neutral dash for a missing timestamp", () => {
    expect(formatSydneyTime(null)).toBe("-");
  });
});
