import { describe, expect, it } from "vitest";

import {
  LiteLLMAuditResponseSchema,
  LiteLLMKeysResponseSchema,
  LiteLLMMeResponseSchema,
  LiteLLMMembersResponseSchema,
  LiteLLMModelsResponseSchema,
  LiteLLMSpendLogsResponseSchema,
  LiteLLMTeamDetailResponseSchema,
} from "./litellm-views";

// Source: docs/specs/2026-11-10-litellm.md - "API routes" (read routes and
// their shapes), Rule 20.11 (response shapes validated on both ends), threats
// LT8/LT-key (key values never reach a response or the DOM). Shapes mirror
// app/api/litellm/**/route.ts and lib/litellm/read-views.ts (keyView,
// reduceDaily, reduceMembers, reduceSpendLogs).
const daily = [{ date: "2026-11-01", spend: 1.5 }];
const key = {
  tokenId: "tok-1",
  userId: "u-1",
  keyAlias: null,
  blocked: false,
  expires: null,
  models: ["claude-sonnet"],
  spend: 0.5,
  maxBudget: null,
  budgetDuration: null,
  rpmLimit: null,
  tpmLimit: null,
  maxParallelRequests: null,
};
const teams = [{ teamId: "team-a", teamName: "A", linked: true }];
const enabledOperations = ["getUser"];

// A schema that must not let a key value through: either it rejects the
// payload or the parsed output has no `key` anywhere in the item.
function dropsKey(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
  payload: unknown,
) {
  const r = schema.safeParse(payload);
  return !r.success || !JSON.stringify(r.data).includes("sk-secret");
}

describe("LiteLLMMeResponseSchema", () => {
  it("accepts a linked user and an unlinked one (me route)", () => {
    const linked = {
      linked: true,
      spend: 1,
      maxBudget: null,
      daily,
      keys: [key],
      teams,
      enabledOperations,
    };
    expect(LiteLLMMeResponseSchema.safeParse(linked).success).toBe(true);
    expect(
      LiteLLMMeResponseSchema.safeParse({
        linked: false,
        teams,
        enabledOperations,
      }).success,
    ).toBe(true);
  });
  it("rejects a response without teams (me route)", () => {
    expect(
      LiteLLMMeResponseSchema.safeParse({ linked: false, enabledOperations })
        .success,
    ).toBe(false);
  });
  it("never lets a key value through (LT, key values never)", () => {
    const payload = {
      linked: true,
      spend: 1,
      maxBudget: null,
      daily,
      keys: [{ ...key, key: "sk-secret" }],
      teams,
      enabledOperations,
    };
    expect(dropsKey(LiteLLMMeResponseSchema, payload)).toBe(true);
  });
});

describe("LiteLLMTeamDetailResponseSchema", () => {
  it("accepts connected:false and a full team (teams/[teamId] route)", () => {
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse({ connected: false }).success,
    ).toBe(true);
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse({
        connected: true,
        team: {
          alias: null,
          spend: 1,
          maxBudget: null,
          softBudget: null,
          budgetDuration: null,
          models: [],
          rpmLimit: null,
          tpmLimit: null,
        },
        daily,
        enabledOperations,
      }).success,
    ).toBe(true);
  });
  it("rejects a non-boolean connected (teams/[teamId] route)", () => {
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse({ connected: "yes" }).success,
    ).toBe(false);
  });
});

describe("LiteLLMMembersResponseSchema", () => {
  it("accepts members with and without a dashboard identity (members route)", () => {
    const base = {
      userId: "u-1",
      email: "a@company.com",
      spend: 1,
      maxBudget: null,
      budgetDuration: null,
      rpmLimit: null,
      tpmLimit: null,
    };
    expect(
      LiteLLMMembersResponseSchema.safeParse({
        connected: true,
        items: [base, { ...base, oid: "oid-1", name: "A" }],
      }).success,
    ).toBe(true);
  });
  it("rejects a member without a userId (members route)", () => {
    expect(
      LiteLLMMembersResponseSchema.safeParse({
        connected: true,
        items: [{ email: "a@company.com", spend: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("LiteLLMKeysResponseSchema", () => {
  it("accepts key metadata (keys route)", () => {
    expect(
      LiteLLMKeysResponseSchema.safeParse({ connected: true, items: [key] })
        .success,
    ).toBe(true);
  });
  it("accepts a key row with keyAlias absent (LD27, Organisation cap)", () => {
    const capped = {
      tokenId: "tok-1",
      blocked: false,
      expires: null,
      models: ["claude-sonnet"],
      spend: 0.5,
      maxBudget: null,
    };
    const parsed = LiteLLMKeysResponseSchema.safeParse({
      connected: true,
      items: [capped],
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects an item without a tokenId (keys route)", () => {
    const rest = Object.fromEntries(
      Object.entries(key).filter(([k]) => k !== "tokenId"),
    );
    expect(
      LiteLLMKeysResponseSchema.safeParse({ connected: true, items: [rest] })
        .success,
    ).toBe(false);
  });
  it("never lets a key value through (LT, key values never)", () => {
    expect(
      dropsKey(LiteLLMKeysResponseSchema, {
        connected: true,
        items: [{ ...key, key: "sk-secret" }],
      }),
    ).toBe(true);
  });
});

describe("LiteLLMSpendLogsResponseSchema", () => {
  it("accepts a page of rows (spend-logs route)", () => {
    expect(
      LiteLLMSpendLogsResponseSchema.safeParse({
        connected: true,
        items: [
          {
            requestId: "r-1",
            startTime: null,
            model: "claude-sonnet",
            spend: 0.1,
            promptTokens: 1,
            completionTokens: 2,
            totalTokens: 3,
            user: null,
            status: "success",
          },
        ],
        page: 1,
        totalPages: 1,
        total: 1,
      }).success,
    ).toBe(true);
  });
  it("rejects a missing paging field (spend-logs route)", () => {
    expect(
      LiteLLMSpendLogsResponseSchema.safeParse({ connected: true, items: [] })
        .success,
    ).toBe(false);
  });
});

describe("LiteLLMModelsResponseSchema", () => {
  it("accepts model names; rejects non-strings (models route)", () => {
    expect(
      LiteLLMModelsResponseSchema.safeParse({ items: ["claude-sonnet"] })
        .success,
    ).toBe(true);
    expect(LiteLLMModelsResponseSchema.safeParse({ items: [1] }).success).toBe(
      false,
    );
  });
});

describe("LiteLLMAuditResponseSchema", () => {
  const row = {
    id: "audit-1",
    updatedAt: "2026-11-14T10:00:00Z",
    changedBy: "ops@litellm.test",
    action: "updated",
    tableName: "LiteLLM_TeamTable",
    objectId: "team-1",
    changedFields: ["max_budget"],
    viaDashboard: false,
  };
  it("accepts a page of audit rows (audit route, LD15)", () => {
    expect(
      LiteLLMAuditResponseSchema.safeParse({
        items: [row],
        page: 1,
        totalPages: 1,
        total: 1,
      }).success,
    ).toBe(true);
  });
  it("rejects a row without viaDashboard (audit route)", () => {
    const rest = Object.fromEntries(
      Object.entries(row).filter(([k]) => k !== "viaDashboard"),
    );
    expect(
      LiteLLMAuditResponseSchema.safeParse({
        items: [rest],
        page: 1,
        totalPages: 1,
        total: 1,
      }).success,
    ).toBe(false);
  });
  it("never lets before/after values through (LD15)", () => {
    const r = LiteLLMAuditResponseSchema.safeParse({
      items: [{ ...row, before_value: { k: "sk-secret" } }],
      page: 1,
      totalPages: 1,
      total: 1,
    });
    expect(!r.success || !JSON.stringify(r.data).includes("sk-secret")).toBe(
      true,
    );
  });
});
