// Public entry for @bedrock-usage/shared — the package.json "exports" map
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

export {
  AccountIdSchema,
  Iso8601Schema,
  UtcDaySchema,
} from "./schemas/primitives";

export { AccountMetaSchema } from "./schemas/account-meta";
export type { AccountMeta } from "./schemas/account-meta";

export {
  AttributionEntrySchema,
  DailyRollupSchema,
  ModelUsageSchema,
} from "./schemas/daily-rollup";
export type {
  AttributionEntry,
  DailyRollup,
  ModelUsage,
} from "./schemas/daily-rollup";

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
