// Public entry for @llm-usage-lens/shared — the package.json "exports" map
// points here. Explicit named re-exports of the public API, not a directory
// barrel (Rule 60.28). Imported by both apps/dashboard and apps/collector.
// See docs/specs/2026-05-15-system-architecture.md — "Shared code layout".

export {
  MODEL_KEYS,
  MODEL_META,
  ModelKeySchema,
  normalizeModelId,
} from "./models";
export type { ModelKey, ModelMeta } from "./models";

export { IdentityRecordSchema } from "./identity";
export type { IdentityRecord } from "./identity";

export { COLLECTOR_REGION } from "./region";

export { runBounded } from "./run-bounded";

export {
  AccountIdSchema,
  Iso8601Schema,
  UtcDaySchema,
} from "./schemas/primitives";

export {
  AccountMetaSchema,
  CreateAccountInputSchema,
  UpdateAccountPatchSchema,
} from "./schemas/account-meta";
export type {
  AccountMeta,
  CreateAccountInput,
  UpdateAccountPatch,
} from "./schemas/account-meta";

export {
  AttributionEntrySchema,
  DailyRollupBaseSchema,
  DailyRollupSchema,
  DatedDailyRollupSchema,
  ModelUsageSchema,
} from "./schemas/daily-rollup";
export type {
  AttributionEntry,
  DailyRollup,
  DatedDailyRollup,
  ModelUsage,
} from "./schemas/daily-rollup";

export { DailyRollupItemSchema } from "./schemas/daily-rollup-item";
export type { DailyRollupItem } from "./schemas/daily-rollup-item";

export {
  NON_MODEL_CATEGORIES,
  NonModelCategorySchema,
  NonModelChargeSchema,
} from "./schemas/non-model-charge";
export type {
  NonModelCategory,
  NonModelCharge,
} from "./schemas/non-model-charge";

export {
  API_ERROR_CODES,
  ApiErrorBodySchema,
  ApiErrorCodeSchema,
  apiResponseSchema,
  apiSuccessSchema,
} from "./schemas/api";
export type { ApiErrorBody, ApiErrorCode } from "./schemas/api";

export {
  AccountListSchema,
  DepartmentDetailResponseSchema,
  DepartmentsResponseSchema,
  OverviewResponseSchema,
  RankingResponseSchema,
  ServiceListRowSchema,
  UserListRowSchema,
  ServicesResponseSchema,
  SyncStatusResultSchema,
  TeamDetailResponseSchema,
  TeamsResponseSchema,
  UsersResponseSchema,
} from "./schemas/api-responses";
export type {
  AttributionRow,
  DailyTrendPoint,
  DepartmentDetailResponse,
  DepartmentRow,
  ModelBreakdown,
  NonModelCategoryTotal,
  OverviewResponse,
  RankingRow,
  ServiceListRow,
  UserListRow,
  ServiceRow,
  SyncStatusResult,
  TeamDetailResponse,
  TeamRow,
  Totals,
  UserRow,
} from "./schemas/api-responses";

export { HealthResponseSchema } from "./schemas/health";
export type { HealthResponse } from "./schemas/health";

export {
  SYNC_STATUSES,
  SyncErrorSchema,
  SyncStatusSchema,
} from "./schemas/sync-status";
export type { SyncError, SyncStatus } from "./schemas/sync-status";

export {
  DEFAULT_RANKING_LIMIT,
  MAX_RANGE_DAYS,
  MAX_RANKING_LIMIT,
  RANKING_SORT_FIELDS,
  RANKING_TABS,
  DateRangeQuerySchema,
  RankingQuerySchema,
  RankingTabSchema,
  TeamsQuerySchema,
} from "./schemas/queries";
export type {
  DateRangeQuery,
  RankingQuery,
  RankingTab,
  TeamsQuery,
} from "./schemas/queries";

export {
  GSI1_NAME,
  META_SK,
  SYNC_SK,
  SYSTEM_PK,
  TABLE_NAME_DEFAULT,
  accountPk,
  dailySk,
  datePk,
  deptPk,
} from "./table";
export { classifyUsageType } from "./usage-type";
export type { UsageTypeClassification } from "./usage-type";
export { GroupMappingInputSchema } from "./group-mapping";
export type { GroupMappingInput } from "./group-mapping";
export { GroupMappingBaseSchema, GroupMappingSchema } from "./group-mapping";
export type { GroupMapping } from "./group-mapping";
export { canonicalUsageIdentity, canonicaliseByUser } from "./usage-identity";
export type { CanonicalUsageIdentity } from "./usage-identity";

export {
  AUDIT_ACTIONS,
  AccessSourceSchema,
  AdminScopeSchema,
  AuditActionSchema,
  AuditItemSchema,
  AuditRecordSchema,
  AuditSnapshotSchema,
  DEFAULT_DEPARTMENT_VISIBILITY,
  DEFAULT_TEAM_VISIBILITY,
  DepartmentVisibilitySchema,
  GrantableRoleSchema,
  IdentityLinkSchema,
  LocalUserSchema,
  MemberAffiliationSchema,
  PasswordUserSchema,
  PendingItemSchema,
  RoleGrantSchema,
  ScopeTypeSchema,
  TeamVisibilitySchema,
  UsageKeyClaimSchema,
  auditCategory,
  PerUserApprovalSchema,
  isAdminScopeSuspended,
  sanitizeAuditSnapshot,
} from "./schemas/access-control";
export type {
  AccessSource,
  AdminScope,
  AuditAction,
  AuditRecord,
  AuditSnapshot,
  DepartmentVisibility,
  GrantableRole,
  IdentityLink,
  LocalUser,
  MemberAffiliation,
  PasswordUser,
  PendingItem,
  PerUserApproval,
  RoleGrant,
  TeamVisibility,
  UsageKeyClaim,
} from "./schemas/access-control";

export {
  AFFILIATION_SK,
  GROUPMAPS_GSI1PK,
  IDENTS_GSI1PK,
  LINK_SK,
  LOCALUSERS_GSI1PK,
  OWNER_SK,
  ROLEGRANTS_GSI1PK,
  adminScopeSk,
  adminsGsi1pk,
  auditPk,
  auditSk,
  groupMapPk,
  localUserPk,
  membersGsi1pk,
  pendingPk,
  roleGrantGsi1sk,
  roleGrantSk,
  usageKeyPk,
  visibilityPk,
} from "./table";
export type { ScopeType } from "./table";

export {
  ConnectionTestResultSchema,
  LiteLLMConnectionSchema,
  LiteLLMConnectionStatusSchema,
  liteLLMEdition,
} from "./schemas/litellm";
export type {
  ConnectionTestResult,
  LiteLLMConnection,
  LiteLLMConnectionStatus,
} from "./schemas/litellm";

export {
  LITELLM_OPERATION_NAMES,
  LiteLLMGatewayConfigSchema,
  LiteLLMOperationNameSchema,
  OperationTogglesSchema,
  OperationTogglesViewSchema,
  TeamLinkSchema,
} from "./schemas/litellm-gateway";
export type {
  LiteLLMGatewayConfig,
  LiteLLMOperationName,
  OperationToggles,
  OperationTogglesView,
  TeamLink,
} from "./schemas/litellm-gateway";
