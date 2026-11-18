import { describe, expect, it } from "vitest";

import { LiteLLMUserMembershipsResponseSchema } from "./litellm-user-memberships";

// Source: docs/specs/2026-11-10-litellm.md - `resetMemberSpend` row (RS1) and
// LD37 (`configured: false` only when not configured), LD23 (spend and budget
// omitted under the Organisation cap); Design System - "Reset spend from the
// LiteLLM users tab and the Users page" (D2 spend and budget per team, D5 a
// null budget is unlimited), Rule 20.11 (shape validated on both ends).
// Contract: packages/shared/src/schemas/litellm-user-memberships.ts exports
// LiteLLMUserMembershipsResponseSchema (re-exported from the package index):
//   { configured?: false, items: [{ teamId, teamName, spend?, maxBudget? }] }
// `teamId` is the dashboard team id; `maxBudget: null` means unlimited.
const full = { teamId: "team-a", teamName: "A", spend: 6, maxBudget: 10 };

describe("LiteLLMUserMembershipsResponseSchema", () => {
  it.each([
    ["a team with spend and a budget", { items: [full] }],
    ["an unlimited budget (null)", { items: [{ ...full, maxBudget: null }] }],
    [
      "the Organisation cap (spend and budget omitted)",
      { items: [{ teamId: "team-a", teamName: "A" }] },
    ],
    ["no resettable team", { items: [] }],
    ["not configured (LD37)", { configured: false, items: [] }],
  ])("accepts %s", (_name, body) => {
    expect(LiteLLMUserMembershipsResponseSchema.safeParse(body).success).toBe(
      true,
    );
  });

  it.each([
    ["no items", {}],
    [
      "configured: true (a configured response omits the marker)",
      {
        configured: true,
        items: [],
      },
    ],
    ["a missing team id", { items: [{ teamName: "A", spend: 1 }] }],
    ["a missing team name", { items: [{ teamId: "team-a", spend: 1 }] }],
    ["negative spend", { items: [{ ...full, spend: -1 }] }],
    ["a string spend", { items: [{ ...full, spend: "6" }] }],
  ])("rejects %s", (_name, body) => {
    expect(LiteLLMUserMembershipsResponseSchema.safeParse(body).success).toBe(
      false,
    );
  });
});
