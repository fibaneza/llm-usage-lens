import { describe, expect, it } from "vitest";

import {
  LiteLLMAuditResponseSchema,
  LiteLLMKeysResponseSchema,
  LiteLLMMeResponseSchema,
  LiteLLMMembersResponseSchema,
  LiteLLMModelsResponseSchema,
  LiteLLMOrgResponseSchema,
  LiteLLMSpendLogsResponseSchema,
  LiteLLMTeamDetailResponseSchema,
  MemberSumCoverageSchema,
  MemberSumSchema,
  SpendSourceSchema,
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

// L4b - docs/specs/2026-11-17-app-teams.md: "Spend source", "Member sum",
// "API changes" (GET /api/litellm/teams/[teamId] always returns spendSource;
// unlinked: connected false + daily + memberSum; linked: as before plus an
// optional memberSum), Rule 60.22 (valid and invalid cases).
const coverage = { members: 3, matched: 2, unmatched: 1, pending: 1 };
const memberSum = {
  total: 4,
  daily: [{ date: "2026-11-02", spend: 4 }],
  coverage,
  members: [
    { oid: "oid-1", name: "Una One", matched: true, spend: 3.5 },
    { oid: "oid-2", matched: true, spend: 0.5 },
    { oid: "oid-3", name: "Tres Three", matched: false },
  ],
};
const linkedTeam = {
  alias: null,
  spend: 1,
  maxBudget: null,
  softBudget: null,
  budgetDuration: null,
  models: [],
  rpmLimit: null,
  tpmLimit: null,
};
const linkedDetail = {
  connected: true,
  spendSource: "litellm-team",
  team: linkedTeam,
  daily,
  enabledOperations,
};
const unlinkedDetail = {
  connected: false,
  spendSource: "member-sum",
  daily: memberSum.daily,
  memberSum,
};

describe("SpendSourceSchema", () => {
  it("accepts litellm-team and member-sum only", () => {
    for (const v of ["litellm-team", "member-sum"]) {
      expect(SpendSourceSchema.safeParse(v).success).toBe(true);
    }
    for (const v of ["team", "LiteLLM team", "", null, 1]) {
      expect(SpendSourceSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe("MemberSumCoverageSchema", () => {
  it("accepts four non-negative integers", () => {
    expect(MemberSumCoverageSchema.safeParse(coverage).success).toBe(true);
    expect(
      MemberSumCoverageSchema.safeParse({
        members: 0,
        matched: 0,
        unmatched: 0,
        pending: 0,
      }).success,
    ).toBe(true);
  });
  it.each([
    ["a missing count", { members: 1, matched: 1, unmatched: 0 }],
    ["a negative count", { ...coverage, pending: -1 }],
    ["a fractional count", { ...coverage, matched: 1.5 }],
    ["a string count", { ...coverage, unmatched: "1" }],
  ])("rejects %s", (_n, value) => {
    expect(MemberSumCoverageSchema.safeParse(value).success).toBe(false);
  });
});

describe("MemberSumSchema", () => {
  it("accepts a sum with matched members (spend), unmatched ones (none) and no members at all", () => {
    expect(MemberSumSchema.safeParse(memberSum).success).toBe(true);
    expect(
      MemberSumSchema.safeParse({
        total: 0,
        daily: [],
        coverage: { members: 0, matched: 0, unmatched: 0, pending: 0 },
        members: [],
      }).success,
    ).toBe(true);
  });
  it("accepts member rows without spend when the Organisation cap hides it (AT3)", () => {
    expect(
      MemberSumSchema.safeParse({
        ...memberSum,
        members: memberSum.members.map(({ oid, matched }) => ({
          oid,
          matched,
        })),
      }).success,
    ).toBe(true);
  });
  it.each([
    ["no total", { ...memberSum, total: undefined }],
    ["a string total", { ...memberSum, total: "4" }],
    ["no coverage", { ...memberSum, coverage: undefined }],
    ["a day without spend", { ...memberSum, daily: [{ date: "2026-11-02" }] }],
    ["a member without an oid", { ...memberSum, members: [{ matched: true }] }],
    [
      "a member without matched",
      { ...memberSum, members: [{ oid: "oid-1", spend: 1 }] },
    ],
    [
      "a non-numeric member spend",
      { ...memberSum, members: [{ oid: "oid-1", matched: true, spend: "1" }] },
    ],
  ])("rejects %s", (_n, value) => {
    expect(MemberSumSchema.safeParse(value).success).toBe(false);
  });
  it("does not let an email or a LiteLLM user id through a member row (ATT1; identities only by oid and name)", () => {
    const parsed = MemberSumSchema.parse({
      ...memberSum,
      members: [
        {
          oid: "oid-1",
          matched: true,
          spend: 1,
          email: "u1@company.com",
          litellmUserId: "luser-u1",
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("u1@company.com");
    expect(JSON.stringify(parsed)).not.toContain("luser-u1");
  });
});

describe("LiteLLMTeamDetailResponseSchema", () => {
  it("accepts a linked team and an unlinked one with its member sum (teams/[teamId] route)", () => {
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse(linkedDetail).success,
    ).toBe(true);
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse(unlinkedDetail).success,
    ).toBe(true);
  });
  it("accepts a linked team with a member sum, for Admin, org-admin and Auditor on request", () => {
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse({ ...linkedDetail, memberSum })
        .success,
    ).toBe(true);
  });
  // LD37: the not-configured team response; the marker is sent only when false.
  it.each([
    ["an unlinked team", { connected: false, spendSource: "member-sum" }],
    ["a linked team", { connected: true, spendSource: "litellm-team" }],
  ])("accepts the not-configured shape for %s (LD37)", (_n, base) => {
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse({
        configured: false,
        daily: [],
        ...base,
      }).success,
    ).toBe(true);
  });
  it("rejects a not-configured team response without connected or with a non-boolean marker (LD37)", () => {
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse({
        configured: false,
        spendSource: "member-sum",
        daily: [],
      }).success,
    ).toBe(false);
    expect(
      LiteLLMTeamDetailResponseSchema.safeParse({
        ...unlinkedDetail,
        configured: "no",
      }).success,
    ).toBe(false);
  });
  it.each([
    ["connected only (spendSource is always returned)", { connected: false }],
    [
      "a linked team without spendSource",
      { ...linkedDetail, spendSource: undefined },
    ],
    [
      "a linked team claiming the member-sum source",
      { ...linkedDetail, spendSource: "member-sum" },
    ],
    [
      "an unlinked team claiming the litellm-team source",
      { ...unlinkedDetail, spendSource: "litellm-team" },
    ],
    [
      "an unlinked team without its member sum",
      { ...unlinkedDetail, memberSum: undefined },
    ],
    ["a non-boolean connected", { connected: "yes" }],
  ])("rejects %s", (_n, value) => {
    expect(LiteLLMTeamDetailResponseSchema.safeParse(value).success).toBe(
      false,
    );
  });
});

// Organisation view: two tables, LiteLLM teams and app teams (spec -
// "Organisation view", AT5, AT6); `teams[]` is removed.
describe("LiteLLMOrgResponseSchema", () => {
  const litellmTeam = {
    litellmTeamId: "ll-1",
    alias: "Alpha",
    spend: 12.5,
    maxBudget: 100,
    memberCount: 3,
    linkedAppTeam: { teamId: "t1", teamName: "Payments" },
  };
  const org = {
    configured: true,
    totals: { spend: 1.5 },
    daily,
    enabledOperations,
    litellmTeams: [
      litellmTeam,
      {
        ...litellmTeam,
        litellmTeamId: "ll-2",
        alias: null,
        maxBudget: null,
        linkedAppTeam: null,
      },
    ],
    appTeams: [
      {
        teamId: "t1",
        teamName: "Payments",
        spendSource: "litellm-team",
        spend: 12.5,
      },
      {
        teamId: "t2",
        teamName: "Risk",
        spendSource: "member-sum",
        spend: 4,
        coverage,
      },
      {
        teamId: "t3",
        teamName: "Ops",
        spendSource: "member-sum",
        spend: null,
        reason: "open-team",
      },
    ],
  };

  it("accepts linked and unlinked LiteLLM teams, member-sum app teams with coverage and an open-team row", () => {
    expect(LiteLLMOrgResponseSchema.safeParse(org).success).toBe(true);
    expect(
      LiteLLMOrgResponseSchema.safeParse({
        ...org,
        litellmTeams: [],
        appTeams: [],
      }).success,
    ).toBe(true);
  });
  // LD37 (docs/specs/2026-11-10-litellm.md, Decisions): `configured` is always
  // present on the Organisation response; false means no LiteLLM teams.
  it("accepts the not-configured shape: configured false, no LiteLLM teams, app teams with spend null (LD37)", () => {
    expect(
      LiteLLMOrgResponseSchema.safeParse({
        ...org,
        configured: false,
        totals: { spend: 0 },
        daily: [],
        litellmTeams: [],
        appTeams: [
          {
            teamId: "t1",
            teamName: "Payments",
            spendSource: "litellm-team",
            spend: null,
          },
          {
            teamId: "t2",
            teamName: "Risk",
            spendSource: "member-sum",
            spend: null,
          },
        ],
      }).success,
    ).toBe(true);
  });
  it("rejects configured false with LiteLLM team rows, and a missing or non-boolean configured (LD37)", () => {
    expect(
      LiteLLMOrgResponseSchema.safeParse({ ...org, configured: false }).success,
    ).toBe(false);
    expect(
      LiteLLMOrgResponseSchema.safeParse({ ...org, configured: undefined })
        .success,
    ).toBe(false);
    expect(
      LiteLLMOrgResponseSchema.safeParse({ ...org, configured: "no" }).success,
    ).toBe(false);
  });
  it("has no teams[] any more: a leftover one is stripped from the output", () => {
    const parsed = LiteLLMOrgResponseSchema.parse({
      ...org,
      teams: [{ teamId: "t1" }],
    });
    expect(parsed).not.toHaveProperty("teams");
  });
  it.each([
    [
      "the old shape (teams[] only)",
      { totals: { spend: 1 }, daily, teams: [] },
    ],
    ["no litellmTeams", { ...org, litellmTeams: undefined }],
    ["no appTeams", { ...org, appTeams: undefined }],
    [
      "an app team with an unknown spendSource",
      {
        ...org,
        appTeams: [{ teamId: "t", teamName: "T", spendSource: "x", spend: 1 }],
      },
    ],
    [
      "an app team with an unknown reason",
      {
        ...org,
        appTeams: [
          {
            teamId: "t",
            teamName: "T",
            spendSource: "member-sum",
            spend: null,
            reason: "later",
          },
        ],
      },
    ],
    [
      "an app team with no spend field",
      {
        ...org,
        appTeams: [{ teamId: "t", teamName: "T", spendSource: "member-sum" }],
      },
    ],
    [
      "a LiteLLM team without its member count",
      { ...org, litellmTeams: [{ ...litellmTeam, memberCount: undefined }] },
    ],
  ])("rejects %s", (_n, value) => {
    expect(LiteLLMOrgResponseSchema.safeParse(value).success).toBe(false);
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
