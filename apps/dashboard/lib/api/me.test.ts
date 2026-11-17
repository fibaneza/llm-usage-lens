import { describe, expect, it } from "vitest";

import { MeUsageResponseSchema } from "@llm-usage-lens/shared";

import { buildRollup } from "@/test/fixtures/rollup-builder";

import { aggregateOwnUsage } from "./me";

// Source: Design System - Management pages, My usage ("a spend-by-day chart
// and a spend-by-model breakdown of the caller's own data ... series coloured
// by the model token from packages/shared"; the 4R.5 own Bedrock usage,
// /api/me/usage); Access Control - Canonical usage identity ("own usage is
// matched by canonical key only", T6); Data Model - model-first rollups
// (DailyRollup.models keyed by canonical model ID, Rule 20.4); slice B2 brief
// B2-11. The response gains `byModel`, derived from the same own-key matching
// as `daily`, so the chart needs no new route and exposes no other person's
// data.
//
// Contract: aggregateOwnUsage(...) also returns
//   byModel: { model: ModelKey; cost; inputTokens; outputTokens; invocations }[]
// (one entry per canonical model the caller used in the range) and
// MeUsageResponseSchema (packages/shared/src/schemas/me.ts) accepts it.
const KEYS = new Set(["a1@company.com"]);

const rollups = [
  buildRollup({
    date: "2026-10-01",
    models: {
      "claude-sonnet": {
        cost: 30,
        byUser: { "a1@company.com": 7, "b1@company.com": 23 },
      },
      "claude-haiku": { cost: 3, byUser: { "a1@company.com": 3 } },
    },
  }),
  buildRollup({
    date: "2026-10-02",
    models: {
      "claude-sonnet": { cost: 4, byUser: { "a1@company.com": 4 } },
    },
  }),
];

describe("aggregateOwnUsage byModel (My usage spend-by-model)", () => {
  it("sums the caller's own cost and tokens per canonical model, across days", () => {
    const { byModel } = aggregateOwnUsage(rollups, KEYS);

    expect([...byModel].sort((a, b) => a.model.localeCompare(b.model))).toEqual(
      [
        {
          model: "claude-haiku",
          cost: 3,
          inputTokens: 100,
          outputTokens: 50,
          invocations: 1,
        },
        {
          model: "claude-sonnet",
          cost: 11,
          inputTokens: 200,
          outputTokens: 100,
          invocations: 2,
        },
      ],
    );
  });

  it("never includes another person's usage (T6)", () => {
    const { byModel } = aggregateOwnUsage(
      rollups,
      new Set(["nobody@company.com"]),
    );

    expect(byModel).toEqual([]);
  });

  it("agrees with the totals", () => {
    const { byModel, totals } = aggregateOwnUsage(rollups, KEYS);

    expect(byModel.reduce((sum, m) => sum + m.cost, 0)).toBeCloseTo(
      totals.cost,
      6,
    );
  });

  it("the response schema accepts and keeps byModel", () => {
    const parsed = MeUsageResponseSchema.parse(
      aggregateOwnUsage(rollups, KEYS),
    );

    expect(parsed.byModel).toHaveLength(2);
  });
});
