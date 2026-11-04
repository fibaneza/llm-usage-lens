import { describe, expect, it } from "vitest";

import { departmentHeaderStats } from "./department-header";

// Source: implementation-phases Phase 4.4 ("Tests: header stats calculation";
// header = name, total cost, tokens, invocations with DeltaBadge); Rule 20.3
// (total cost = model + non-model, i.e. the row's `cost`), Rule 20 (no previous
// or previous 0 -> no delta, never 0). Contract:
// `departmentHeaderStats(current, previous)` where both are
// Pick<DepartmentRow, "cost"|"inputTokens"|"outputTokens"|"invocations">
// and `previous` may be null/undefined. Returns
// `{ totalCost, totalTokens, invocations,
//    previous: { totalCost, totalTokens, invocations } | null,
//    deltaPercent: { totalCost, totalTokens, invocations } }`
// with each delta a number rounded to 1 decimal (percent) or null.
const CURRENT = {
  cost: 600,
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  invocations: 1_200,
};

describe("departmentHeaderStats", () => {
  it("reports total cost, tokens (input + output) and invocations", () => {
    const stats = departmentHeaderStats(CURRENT, null);

    expect(stats.totalCost).toBe(600);
    expect(stats.totalTokens).toBe(1_500_000);
    expect(stats.invocations).toBe(1_200);
  });

  it("computes the percent change of each stat vs the previous period", () => {
    const stats = departmentHeaderStats(CURRENT, {
      cost: 500,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      invocations: 1_000,
    });

    expect(stats.previous).toEqual({
      totalCost: 500,
      totalTokens: 2_000_000,
      invocations: 1_000,
    });
    expect(stats.deltaPercent).toEqual({
      totalCost: 20,
      totalTokens: -25,
      invocations: 20,
    });
  });

  it("rounds the delta to one decimal", () => {
    const stats = departmentHeaderStats(
      { ...CURRENT, cost: 100 },
      { cost: 300, inputTokens: 0, outputTokens: 0, invocations: 0 },
    );

    expect(stats.deltaPercent.totalCost).toBe(-66.7);
  });

  it("gives null previous and null deltas when there is no previous period", () => {
    for (const none of [null, undefined]) {
      const stats = departmentHeaderStats(CURRENT, none);

      expect(stats.previous).toBeNull();
      expect(stats.deltaPercent).toEqual({
        totalCost: null,
        totalTokens: null,
        invocations: null,
      });
    }
  });

  it("gives a null delta, not Infinity or 0, for a stat whose previous value is 0", () => {
    const stats = departmentHeaderStats(CURRENT, {
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      invocations: 10,
    });

    expect(stats.deltaPercent.totalCost).toBeNull();
    expect(stats.deltaPercent.totalTokens).toBeNull();
    expect(stats.deltaPercent.invocations).toBe(11_900);
  });

  it("reports a 0 change as 0 when both periods are equal and non-zero", () => {
    const stats = departmentHeaderStats(CURRENT, CURRENT);

    expect(stats.deltaPercent.totalCost).toBe(0);
  });

  it("handles an all-zero current period", () => {
    const stats = departmentHeaderStats(
      { cost: 0, inputTokens: 0, outputTokens: 0, invocations: 0 },
      CURRENT,
    );

    expect(stats.totalTokens).toBe(0);
    expect(stats.deltaPercent.totalCost).toBe(-100);
  });
});
