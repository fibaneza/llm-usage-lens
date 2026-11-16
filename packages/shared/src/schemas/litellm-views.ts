import { z } from "zod";

// Source: docs/specs/2026-11-10-litellm.md - "API routes" (read routes) and
// Rule 20.11 (response shapes validated on both ends). Object schemas strip
// unknown fields, so a key value or an audit before/after value can never
// pass through even if a route returned one (threat LT8, LD15).

const DailySchema = z.array(z.object({ date: z.string(), spend: z.number() }));
const EnabledOperations = z.array(z.string());

const KeyMetadataSchema = z.object({
  tokenId: z.string(),
  userId: z.string().nullish(),
  keyAlias: z.string().nullable(),
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

export const LiteLLMTeamDetailResponseSchema = z.discriminatedUnion(
  "connected",
  [
    z.object({
      connected: z.literal(true),
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
    }),
    z.object({ connected: z.literal(false) }),
  ],
);

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
});

export const LiteLLMMembersResponseSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(true), items: z.array(MemberSchema) }),
  z.object({ connected: z.literal(false), items: z.array(z.never()) }),
]);

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
export const LiteLLMOrgResponseSchema = z.object({
  totals: z.object({ spend: z.number() }),
  daily: DailySchema,
  teams: z.array(
    z.object({
      teamId: z.string(),
      teamName: z.string(),
      spend: z.number(),
      maxBudget: z.number().nullable(),
      memberCount: z.number(),
    }),
  ),
  enabledOperations: EnabledOperations,
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
});

export const LiteLLMUserDetailResponseSchema = z.object({
  userId: z.string(),
  email: z.string(),
  // Absent while the Organisation cap hides per-user cost (LD23).
  spend: z.number().optional(),
  maxBudget: z.number().nullable().optional(),
  daily: DailySchema.optional(),
  enabledOperations: EnabledOperations,
});
