import { z } from "zod";

import { AccountMetaSchema } from "./account-meta";
import { ModelKeySchema } from "../models";
import { DailyRollupBaseSchema } from "./daily-rollup";
import { NonModelCategorySchema } from "./non-model-charge";
import { UtcDaySchema } from "./primitives";
import { RankingTabSchema } from "./queries";
import { SyncStatusSchema } from "./sync-status";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes"; Rule 20.9
// (never-synced is a handled state, returned as data).

export const SyncStatusResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("never-synced") }),
  z.object({ state: z.literal("synced"), status: SyncStatusSchema }),
]);

export type SyncStatusResult = z.infer<typeof SyncStatusResultSchema>;

export const AccountListSchema = z.array(AccountMetaSchema);

// --- Aggregation responses (Phase 3.3 U2) -----------------------------------
// Per-model pieces derive from DailyRollupBaseSchema. Non-model cost is
// account-level only and absent ≠ 0, so categories are a list that is empty
// when nothing was charged (Rule 20.12).

const RollupPieces = DailyRollupBaseSchema.pick({
  departmentId: true,
  departmentName: true,
  teamId: true,
  teamName: true,
  accountId: true,
  inputTokens: true,
  outputTokens: true,
  invocations: true,
});

const Cost = z.number().nonnegative();

const TotalsShape = {
  cost: Cost,
  modelCost: Cost,
  nonModelCost: Cost,
  inputTokens: RollupPieces.shape.inputTokens,
  outputTokens: RollupPieces.shape.outputTokens,
  invocations: RollupPieces.shape.invocations,
};

const NonModelCategoryTotalSchema = z.object({
  category: NonModelCategorySchema,
  cost: Cost,
  recurring: z.boolean(),
});

const DailyTrendPointSchema = z.object({
  date: UtcDaySchema,
  cost: Cost,
  modelCost: Cost,
  nonModelCost: Cost,
  byModel: z.partialRecord(ModelKeySchema, Cost),
});

const ModelBreakdownSchema = z.object({
  model: ModelKeySchema,
  cost: Cost,
  inputTokens: RollupPieces.shape.inputTokens,
  outputTokens: RollupPieces.shape.outputTokens,
  invocations: RollupPieces.shape.invocations,
});

const AttributionShape = {
  cost: Cost,
  costEstimated: z.literal(true),
  inputTokens: RollupPieces.shape.inputTokens,
  outputTokens: RollupPieces.shape.outputTokens,
  invocations: RollupPieces.shape.invocations,
};

const UserRowSchema = z.object({ userId: z.string(), ...AttributionShape });
const ServiceRowSchema = z.object({
  serviceName: z.string(),
  ...AttributionShape,
});

const DepartmentRowSchema = z.object({
  departmentId: RollupPieces.shape.departmentId,
  departmentName: RollupPieces.shape.departmentName,
  ...TotalsShape,
  teamCount: z.number().int().nonnegative(),
  topModel: ModelKeySchema.nullable(),
});

const TeamRowSchema = z.object({
  teamId: RollupPieces.shape.teamId,
  teamName: RollupPieces.shape.teamName,
  departmentId: z.string(),
  departmentName: z.string(),
  ...TotalsShape,
});

const RankingRowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  cost: Cost,
  costEstimated: z.boolean(),
  inputTokens: RollupPieces.shape.inputTokens,
  outputTokens: RollupPieces.shape.outputTokens,
  invocations: RollupPieces.shape.invocations,
});

export const OverviewResponseSchema = z.object({
  totalCost: Cost,
  modelCost: Cost,
  nonModelCost: Cost,
  inputTokens: RollupPieces.shape.inputTokens,
  outputTokens: RollupPieces.shape.outputTokens,
  invocations: RollupPieces.shape.invocations,
  costFinalized: z.boolean(),
  activeAccounts: z.number().int().nonnegative(),
  mostUsedModel: ModelKeySchema.nullable(),
  byModel: z.array(ModelBreakdownSchema),
  nonModelByCategory: z.array(NonModelCategoryTotalSchema),
  dailyTrend: z.array(DailyTrendPointSchema),
  topDepartments: z.array(
    z.object({
      departmentId: RollupPieces.shape.departmentId,
      departmentName: RollupPieces.shape.departmentName,
      cost: Cost,
    }),
  ),
});

export const RankingResponseSchema = z.object({
  tab: RankingTabSchema,
  rows: z.array(RankingRowSchema),
});

export const DepartmentsResponseSchema = z.object({
  departments: z.array(DepartmentRowSchema),
});

export const DepartmentDetailResponseSchema = DepartmentRowSchema.extend({
  nonModelByCategory: z.array(NonModelCategoryTotalSchema),
  teams: z.array(TeamRowSchema),
  dailyTrend: z.array(DailyTrendPointSchema),
  topUsers: z.array(UserRowSchema),
  teamTrend: z.array(
    z.object({
      date: UtcDaySchema,
      teams: z.array(z.object({ teamId: z.string(), cost: Cost })),
    }),
  ),
});

export const TeamsResponseSchema = z.object({ teams: z.array(TeamRowSchema) });

export const TeamDetailResponseSchema = TeamRowSchema.extend({
  nonModelByCategory: z.array(NonModelCategoryTotalSchema),
  accounts: z.array(
    z.object({ accountId: RollupPieces.shape.accountId, ...TotalsShape }),
  ),
  dailyTrend: z.array(DailyTrendPointSchema),
  byModel: z.array(ModelBreakdownSchema),
  services: z.array(ServiceRowSchema),
  users: z.array(UserRowSchema),
});

export const ServicesResponseSchema = z.object({
  services: z.array(ServiceRowSchema),
});

export const UsersResponseSchema = z.object({ users: z.array(UserRowSchema) });

export type Totals = z.infer<z.ZodObject<typeof TotalsShape>>;
export type NonModelCategoryTotal = z.infer<typeof NonModelCategoryTotalSchema>;
export type DailyTrendPoint = z.infer<typeof DailyTrendPointSchema>;
export type ModelBreakdown = z.infer<typeof ModelBreakdownSchema>;
export type AttributionRow = z.infer<z.ZodObject<typeof AttributionShape>>;
export type UserRow = z.infer<typeof UserRowSchema>;
export type ServiceRow = z.infer<typeof ServiceRowSchema>;
export type DepartmentRow = z.infer<typeof DepartmentRowSchema>;
export type TeamRow = z.infer<typeof TeamRowSchema>;
export type RankingRow = z.infer<typeof RankingRowSchema>;
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
export type DepartmentDetailResponse = z.infer<
  typeof DepartmentDetailResponseSchema
>;
export type TeamDetailResponse = z.infer<typeof TeamDetailResponseSchema>;
