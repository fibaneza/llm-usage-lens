import { describe, expect, it } from "vitest";

import { withDateRange } from "./date-range-search-params";

describe("withDateRange", () => {
  it("appends the active dateFrom/dateTo to the href", () => {
    const params = new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-31");

    expect(withDateRange("/dashboard/ranking", params)).toBe(
      "/dashboard/ranking?dateFrom=2026-01-01&dateTo=2026-01-31",
    );
  });

  it("returns the href unchanged when no range is present", () => {
    expect(withDateRange("/dashboard/teams", new URLSearchParams())).toBe(
      "/dashboard/teams",
    );
  });

  it("carries only the global filter keys, not page-local params", () => {
    const params = new URLSearchParams(
      "dateFrom=2026-01-01&dateTo=2026-01-31&tab=teams&sort=cost",
    );

    expect(withDateRange("/dashboard", params)).toBe(
      "/dashboard?dateFrom=2026-01-01&dateTo=2026-01-31",
    );
  });

  it("carries a partial range (only dateFrom set)", () => {
    const params = new URLSearchParams("dateFrom=2026-01-01");

    expect(withDateRange("/dashboard", params)).toBe(
      "/dashboard?dateFrom=2026-01-01",
    );
  });

  // Phase 4R.5 scoped Overview link, decision D-R5-1: an href that already has
  // a query joins the carried range with "&", not a second "?".
  it("joins the range with & when the href already has a query (D-R5-1)", () => {
    const params = new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-31");

    expect(withDateRange("/dashboard?view=overview", params)).toBe(
      "/dashboard?view=overview&dateFrom=2026-01-01&dateTo=2026-01-31",
    );
  });

  // Phase 4R.5 scoped Overview link, decision D-R5-1: a plain href takes "?".
  it("uses ? for a plain href with no query (D-R5-1)", () => {
    const params = new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-31");

    expect(withDateRange("/dashboard", params)).toBe(
      "/dashboard?dateFrom=2026-01-01&dateTo=2026-01-31",
    );
  });
});
