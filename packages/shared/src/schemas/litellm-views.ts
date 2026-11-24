import { z } from "zod";

import { PersonStateSchema } from "./access-control";
import { CombinedMeResponseSchema } from "./combined";

// Source: docs/specs/2026-11-10-litellm.md - "API routes" (read routes) and
// Rule 20.11 (response shapes validated on both ends). Object schemas strip
// unknown fields, so a key value or an audit before/after value can never
// pass through even if a route returned one (threat LT8, LD15).

const DailySchema = z.array(z.object({ date: z.string(), spend: z.number() }));
const EnabledOperations = z.array(z.string());

const KeyMetadataSchema = z.object({
  tokenId: z.string(),
  userId: z.string().nullish(),
  keyAlias: z.string().nullish(),
  blocked: z.boolean(),
  expires: z.string().nullable(),
  models: z.array(z.string()),
  spend: z.number(),
  maxBudget: z.number().nullable(),
  budgetDuration: z.string().nullish(),
  rpmLimit: z.number().nullish(),
  tpmLimit: z.number().nullish(),
  maxParallelRequests: z.number().nullish(),
});

const TeamRefSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  linked: z.boolean(),
  configurable: z.boolean().optional(),
});

export const LiteLLMMeResponseSchema = z.discriminatedUnion("linked", [
  z.object({
    linked: z.literal(true),
    spend: z.number(),
    maxBudget: z.number().nullable(),
    daily: DailySchema,
    keys: z.array(KeyMetadataSchema),
    teams: z.array(TeamRefSchema),
    enabledOperations: EnabledOperations,
  }),
  z.object({
    linked: z.literal(false),
    teams: z.array(TeamRefSchema),
    enabledOperations: EnabledOperations,
  }),
]);

// App Teams spec - "Spend source", "Member sum", "API changes".
export const SpendSourceSchema = z.enum(["litellm-team", "member-sum"]);

const Count = z.number().int().min(0);

export const MemberSumCoverageSchema = z.object({
  members: Count,
  matched: Count,
  unmatched: Count,
  pending: Count,
});

export const MemberSumSchema = z.object({
  total: z.number(),
  daily: DailySchema,
  coverage: MemberSumCoverageSchema,
  members: z.array(
    z.object({
      oid: z.string(),
      name: z.string().optional(),
      matched: z.boolean(),
      // Absent for an unmatched member and while the Organisation cap hides
      // per-user cost (LD23, AT3).
      spend: z.number().optional(),
    }),
  ),
});

// LD37: LiteLLM not configured. The marker is sent only when false.
const TeamDetailUnconfiguredSchema = z.object({
  configured: z.literal(false),
  connected: z.boolean(),
  spendSource: SpendSourceSchema,
  daily: DailySchema,
});

const TeamDetailConfiguredSchema = z.discriminatedUnion("connected", [
  z.object({
    configured: z.undefined().optional(),
    connected: z.literal(true),
    spendSource: z.literal("litellm-team"),
    team: z.object({
      alias: z.string().nullable(),
      spend: z.number(),
      maxBudget: z.number().nullable(),
      softBudget: z.number().nullable(),
      budgetDuration: z.string().nullable(),
      models: z.array(z.string()),
      rpmLimit: z.number().nullable(),
      tpmLimit: z.number().nullable(),
    }),
    daily: DailySchema,
    enabledOperations: EnabledOperations,
    memberSum: MemberSumSchema.optional(),
  }),
  z.object({
    configured: z.undefined().optional(),
    connected: z.literal(false),
    spendSource: z.literal("member-sum"),
    daily: DailySchema,
    memberSum: MemberSumSchema,
  }),
]);

export const LiteLLMTeamDetailResponseSchema = z.union([
  TeamDetailUnconfiguredSchema,
  TeamDetailConfiguredSchema,
]);

const MemberStateSchema = z.union([PersonStateSchema, z.literal("unknown")]);

const MemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  // Absent while the Organisation cap hides per-user cost (LD23).
  spend: z.number().optional(),
  maxBudget: z.number().nullable().optional(),
  budgetDuration: z.string().nullish(),
  rpmLimit: z.number().nullable(),
  tpmLimit: z.number().nullable(),
  oid: z.string().optional(),
  name: z.string().optional(),
  // Unit INV2 (Access Control - Placing a person by hand): for callers who may
  // write members only; `identityOid` is a signed-in person who is not a member.
  state: MemberStateSchema.optional(),
  identityOid: z.string().optional(),
  identityName: z.string().optional(),
  identityEmail: z.string().optional(),
});

const MemberCandidateSchema = z.object({
  oid: z.string(),
  name: z.string(),
  email: z.string(),
  state: MemberStateSchema.optional(),
});

export const LiteLLMMembersResponseSchema = z.discriminatedUnion("connected", [
  z.object({
    connected: z.literal(true),
    litellmTeamId: z.string().optional(),
    items: z.array(MemberSchema),
    candidates: z.array(MemberCandidateSchema).optional(),
    truncated: z.boolean().optional(),
  }),
  z.object({ connected: z.literal(false), items: z.array(z.never()) }),
]);

// RS2, D-RS6: the LiteLLM team's members by LiteLLM id; spend and maxBudget are
// absent while the Organisation cap hides per-user cost (LD23).
export const LiteLLMProxyTeamMembersResponseSchema = z.object({
  litellmTeamId: z.string(),
  enabledOperations: z.array(z.string()),
  truncated: z.boolean().optional(),
  items: z.array(
    z.object({
      userId: z.string(),
      email: z.string(),
      spend: z.number().optional(),
      maxBudget: z.number().nullable().optional(),
      person: z.object({ oid: z.string(), name: z.string() }).nullable(),
    }),
  ),
});

export const LiteLLMKeysResponseSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(true), items: z.array(KeyMetadataSchema) }),
  z.object({ connected: z.literal(false), items: z.array(z.never()) }),
]);

const SpendLogSchema = z.object({
  requestId: z.string(),
  startTime: z.string().nullable(),
  model: z.string().nullable(),
  spend: z.number(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  user: z.string().nullable().optional(),
  status: z.string().nullable(),
});

export const LiteLLMSpendLogsResponseSchema = z.discriminatedUnion(
  "connected",
  [
    z.object({
      connected: z.literal(true),
      items: z.array(SpendLogSchema),
      page: z.number(),
      totalPages: z.number(),
      total: z.number(),
    }),
    z.object({ connected: z.literal(false), items: z.array(z.never()) }),
  ],
);

export const LiteLLMModelsResponseSchema = z.object({
  items: z.array(z.string()),
});

export const LiteLLMAuditResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      updatedAt: z.string(),
      changedBy: z.string().nullable(),
      action: z.string(),
      tableName: z.string(),
      objectId: z.string().nullable(),
      changedFields: z.array(z.string()),
      viaDashboard: z.boolean(),
    }),
  ),
  page: z.number().optional(),
  totalPages: z.number().optional(),
  total: z.number().optional(),
});

// L3b: Views by role (Organisation, Users tabs).
export const LiteLLMOrgResponseSchema = z
  .object({
    configured: z.boolean(),
    totals: z.object({ spend: z.number() }),
    daily: DailySchema,
    litellmTeams: z.array(
      z.object({
        litellmTeamId: z.string(),
        alias: z.string().nullable(),
        spend: z.number(),
        maxBudget: z.number().nullable(),
        memberCount: z.number(),
        linkedAppTeam: z
          .object({ teamId: z.string(), teamName: z.string() })
          .nullable(),
      }),
    ),
    appTeams: z.array(
      z.object({
        teamId: z.string(),
        teamName: z.string(),
        spendSource: SpendSourceSchema,
        spend: z.number().nullable(),
        reason: z.literal("open-team").optional(),
        coverage: MemberSumCoverageSchema.optional(),
      }),
    ),
    enabledOperations: EnabledOperations,
  })
  .refine((org) => org.configured || org.litellmTeams.length === 0, {
    message: "LiteLLM teams require a configured LiteLLM",
    path: ["litellmTeams"],
  });

export const LiteLLMUserSearchResponseSchema = z.object({
  users: z.array(
    z.object({
      userId: z.string(),
      email: z.string(),
      // Absent while the Organisation cap hides per-user cost (LD23).
      spend: z.number().optional(),
      maxBudget: z.number().nullable().optional(),
      teams: z.array(z.object({ teamId: z.string(), teamName: z.string() })),
    }),
  ),
  page: z.number(),
  pageSize: z.number(),
  enabledOperations: EnabledOperations,
  // The caller may write LiteLLM user links and resets (RS2); false for a
  // Lead and the auditor, and when an older answer omits it.
  mayLink: z.boolean().default(false),
  // The caller's own stored LiteLLM user link, so the search can hide a reset
  // on the caller's row (LF1 D-LF1 d); null when unlinked. The server decides.
  callerLitellmUserId: z.string().nullable().default(null),
});

export const LiteLLMUserDetailResponseSchema = z.object({
  userId: z.string(),
  email: z.string(),
  // Absent while the Organisation cap hides per-user cost (LD23); null when
  // LiteLLM reports no spend for the user (LF1 D-LF1).
  spend: z.number().nullable().optional(),
  maxBudget: z.number().nullable().optional(),
  daily: DailySchema.optional(),
  // L6: the person's combined figure, absent while the cap hides per-user cost.
  combined: CombinedMeResponseSchema.optional(),
  enabledOperations: EnabledOperations,
});
