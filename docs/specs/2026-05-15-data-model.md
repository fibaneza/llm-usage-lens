# Data Model Spec

**Status:** Draft
**Date:** 2026-05-15
**Scope:** DynamoDB single-table design for Bedrock usage and cost data

---

## Overview

All data is stored in a single DynamoDB table (`bedrock-usage`) with one GSI. Three entity types cover all dashboard access patterns.

## Conventions

- **Dates**: All date bucketing uses **UTC**. `DAILY#{YYYY-MM-DD}` keys are UTC calendar days, matching the native time zones of Cost Explorer and CloudWatch.
- **Currency**: All cost values are USD.
- **Model keys**: The `models` map is keyed by canonical model IDs — see Model ID Normalization below.

## Table Definition

- **Table name:** `bedrock-usage`
- **Primary key:** `PK` (String, partition) + `SK` (String, sort)
- **GSI1:** `gsi1pk` (String, partition) + `gsi1sk` (String, sort)
- **GSI1 projection:** `ALL` — ranking queries read the full `models` map from every rollup via GSI1, so all attributes must be projected (a `KEYS_ONLY`/`INCLUDE` projection would force a `GetItem` per row).
- **Billing mode:** On-demand (pay-per-request)

## Entity Map

| Entity | PK | SK | GSI1pk | GSI1sk |
|--------|----|----|--------|--------|
| AccountMeta | `ACCT#{accountId}` | `META` | `DEPT#{departmentId}` | `ACCT#{accountId}` |
| DailyRollup | `ACCT#{accountId}` | `DAILY#{YYYY-MM-DD}` | `DATE#{YYYY-MM-DD}` | `ACCT#{accountId}` |
| SyncStatus | `SYSTEM` | `SYNC#LATEST` | — | — |

## Entity: AccountMeta

Maps an AWS account to the organizational hierarchy. Managed via the Settings page.

```
PK:      ACCT#{accountId}           e.g. ACCT#123456789012
SK:      META
GSI1pk:  DEPT#{departmentId}        e.g. DEPT#dept-engineering
GSI1sk:  ACCT#{accountId}           e.g. ACCT#123456789012

Attributes:
  accountId        string           "123456789012"
  accountName      string           "payments-team-prod"
  departmentId     string           "dept-engineering"
  departmentName   string           "Engineering"
  teamId           string           "team-payments"
  teamName         string           "Payments"
  region           string           "us-east-1"
  active           boolean          true
  createdAt        string           ISO8601
  updatedAt        string           ISO8601
```

### Access Patterns

| Pattern | Key condition |
|---------|---------------|
| Get one account | `PK = ACCT#{id}`, `SK = META` |
| All accounts in a department | `GSI1: gsi1pk = DEPT#{deptId}` |
| All accounts (settings page) | Table scan with `SK = META` filter (v1 expects ≤100 active accounts; design headroom to ~500) |

## Entity: DailyRollup

Core data entity. One item per account per day. Written/overwritten by the Lambda collector each hour. Model is the primary breakdown dimension; user and service are nested inside each model.

```
PK:      ACCT#{accountId}           e.g. ACCT#123456789012
SK:      DAILY#{YYYY-MM-DD}         e.g. DAILY#2026-05-15
GSI1pk:  DATE#{YYYY-MM-DD}          e.g. DATE#2026-05-15
GSI1sk:  ACCT#{accountId}           e.g. ACCT#123456789012

Attributes:

  -- Identity --
  accountId        string
  departmentId     string
  departmentName   string           (historical snapshot, see Design Decisions)
  teamId           string
  teamName         string           (historical snapshot, see Design Decisions)

  -- Totals (sum across all models) --
  cost             number           USD, 6 decimal places
  costFinalized    boolean          false = estimated from tokens, true = Cost Explorer data
  inputTokens      number
  outputTokens     number
  invocations      number

  -- Per-model breakdown (primary data structure) --
  models           map {
    "<canonical-key>": {            e.g. "claude-sonnet" (see Model ID Normalization)
      cost             number
      costEstimated    boolean
      inputTokens      number
      outputTokens     number
      invocations      number
      rawModelIds      list         (only on the "other" entry — raw IDs not yet mapped)

      byUser           map {
        "<sso-username>": {         e.g. "john.doe@company.com"
          cost             number   (proportional estimate)
          costEstimated    boolean  (always true)
          inputTokens      number   (exact from CloudTrail)
          outputTokens     number   (exact from CloudTrail)
          invocations      number   (exact from CloudTrail)
        }
      }

      byService        map {
        "<service-tag>": {          e.g. "payments-api"
          cost             number   (proportional estimate)
          costEstimated    boolean  (always true)
          inputTokens      number
          outputTokens     number
          invocations      number
        }
        "_untagged": { ... }        (captures untagged usage)
      }
    }
  }

  -- Metadata --
  lastUpdatedAt    string           ISO8601
  ttl              number           Unix epoch + 365 days
```

### Access Patterns

| Pattern | Key condition |
|---------|---------------|
| Date range for one account | `PK = ACCT#{id}`, `SK between DAILY#start and DAILY#end` |
| All accounts for one date | `GSI1: gsi1pk = DATE#{date}` |
| All accounts for date range | N parallel GSI1 queries (one per day); cap custom ranges at 90 days in API validation to bound query count and payload size |
| Ranking: top depts by cost | Fetch all rollups for date range via GSI1, group by departmentId, sort in memory |
| Ranking: top teams by cost | Same, group by teamId, sort |
| Ranking: top users by cost | Same, extract byUser from each model, merge across accounts, sort |
| Ranking: top services by cost | Same, extract byService from each model, merge, sort |
| Ranking filtered by model | Same as above but only read specific model key from models map |

### Item Size Estimate

Worst case: 10 models x (20 users + 10 services) = 300 nested entries at ~200 bytes each = ~60KB. Well within DynamoDB's 400KB item limit. Safe up to ~50 users and ~30 services per model (~180KB).

### Query Pagination

DynamoDB returns a maximum of 1MB per query. The GSI1 query "all accounts for one date" can exceed this at large account counts (~500+ accounts). All data access functions that query the GSI must loop on `LastEvaluatedKey` until the full result set is retrieved.

## Model ID Normalization

CloudWatch and CloudTrail Lake return raw Bedrock model IDs (e.g. `anthropic.claude-3-5-sonnet-20241022-v2:0`). The Lambda collector normalizes these to canonical keys before writing the `models` map. The dashboard maps canonical keys to display names and chart colors.

| Raw Bedrock model ID (example) | Canonical key | Display name | Chart color |
|---|---|---|---|
| `anthropic.claude-opus-4-*` | `claude-opus` | Claude Opus | `#7C3AED` |
| `anthropic.claude-sonnet-4-*`, `anthropic.claude-3-5-sonnet-*` | `claude-sonnet` | Claude Sonnet | `#3B82F6` |
| `anthropic.claude-3-5-haiku-*`, `anthropic.claude-haiku-*` | `claude-haiku` | Claude Haiku | `#14B8A6` |
| Any other model ID | `other` | Other models | `#D97706` |

Chart colors in this table are reference values for `packages/shared/src/models.ts`. The dashboard maps each canonical key to a **semantic CSS variable** (e.g. `--chart-claude-sonnet`); components never use raw hex.

Normalization rules:
- Match by prefix on the model family, ignoring version/date suffixes and the `:N` inference profile suffix.
- Region-prefixed IDs (e.g. `us.anthropic.claude-...`) strip the region prefix before matching.
- Unrecognized model IDs fall into the `other` canonical key. The raw IDs are preserved in a `rawModelIds` list inside that entry so new models can be identified and added to the mapping.

The mapping table lives in `@bedrock-usage/shared` (`packages/shared`) used by both `apps/collector` and `apps/dashboard`, so the two never drift.

## Entity: SyncStatus

Tracks the last Lambda collector run. Single item, always overwritten.

```
PK:      SYSTEM
SK:      SYNC#LATEST

Attributes:
  lastRunAt        string           ISO8601 — when the last run finished
  nextScheduledAt  string           ISO8601 — next EventBridge cron fire (lastRunAt + 1h, aligned to hour boundary); written by Lambda after each run
  status           string           "success" | "partial" | "error"
  accountsTotal    number
  accountsSuccess  number
  accountsFailed   number
  errors           list             [ { accountId: string, message: string } ]
  durationMs       number
```

`SyncCountdown` in the UI prefers `nextScheduledAt`. If the item is missing (never synced), show a neutral message instead of a countdown.

### Access Pattern

| Pattern | Key condition |
|---------|---------------|
| Get sync status | `PK = SYSTEM`, `SK = SYNC#LATEST` |

Before the Lambda's first run, no SyncStatus item exists. Consumers must treat a missing item as a valid "never synced" state, not an error.

## Zod Validation Schemas

All data written to DynamoDB and returned from Next.js Route Handlers is validated with Zod v4. One schema per entity and per API query:

| Schema | Used by |
|--------|---------|
| `AccountMetaSchema` | Settings page CRUD, Lambda registry reads |
| `DailyRollupSchema` | Lambda writes, API route responses |
| `SyncStatusSchema` | Sync status display, Lambda writes |
| `RankingQuerySchema` | API query params: dateFrom, dateTo, `tab` (`departments` \| `teams` \| `services` \| `users`), model, sortBy, order, limit |
| `DateRangeQuerySchema` | API query params: dateFrom, dateTo, accountId (max 90-day span) |
| `TeamsQuerySchema` | Extends date range with optional `departmentId` filter (`GET /api/teams`) |

## API Routes

All routes live under `apps/dashboard/app/api/`, require an Auth.js session, validate query/body with Zod, and return `{ data: T }` or `{ error: { code, message } }`. Date params use `YYYY-MM-DD` (UTC).

**HTTP status codes:** `200` success · `400` validation error (Zod) · `401` no session · `404` account/department/team not found · `500` unexpected server error.

| Route | Method | Schema / params | Data access |
|-------|--------|-----------------|-------------|
| `/api/overview` | GET | `DateRangeQuerySchema` | GSI1 rollups for range → KPIs, trends, top departments |
| `/api/ranking` | GET | `RankingQuerySchema` | GSI1 rollups for range → in-memory group/sort by tab |
| `/api/departments` | GET | `DateRangeQuerySchema` | Rollups + `AccountMeta` → department aggregates |
| `/api/departments/[id]` | GET | `DateRangeQuerySchema` | Department rollups, teams, top users |
| `/api/teams` | GET | `TeamsQuerySchema` | All accounts / optional `departmentId` filter → team list |
| `/api/teams/[id]` | GET | `DateRangeQuerySchema` | Account rollups → services, users, models |
| `/api/services` | GET | `DateRangeQuerySchema` | Rollups → merge `byService` across accounts |
| `/api/users` | GET | `DateRangeQuerySchema` | Rollups → merge `byUser` across accounts |
| `/api/sync-status` | GET | — | `getSyncStatus()` |
| `/api/accounts` | GET | — | `getAllAccounts()` |
| `/api/accounts` | POST | `AccountMetaSchema` (create) | Settings CRUD |
| `/api/accounts/[id]` | PATCH | `AccountMetaSchema` (partial) | Settings CRUD |
| `/api/accounts/[id]` | DELETE | — | Soft-deactivate (`active: false`) |

## Design Decisions

### Model as Primary Breakdown Dimension

All metrics (cost, tokens, invocations) are broken down by model first. User and service are nested inside each model. This matches how the raw data sources group data (CloudWatch and CloudTrail both report per-model) and avoids reshuffling in the Lambda.

### Historical Snapshots for Department/Team Names

`departmentName` and `teamName` are duplicated from AccountMeta into every DailyRollup. If a team moves departments, old rollups retain the historical assignment. This is intentional: financial reporting should reflect where costs were attributed at the time they occurred.

### DynamoDB over a Relational Database

The store is DynamoDB, not RDS/Aurora. An analytics dashboard is aggregation-heavy and SQL `GROUP BY` would be a natural fit. DynamoDB fits organizations from small teams up to hundreds of accounts; **in-memory ranking in v1 is tuned for ≤100 accounts** (see In-Memory Aggregation below). At that scale, on-demand DynamoDB costs roughly 10× less than Aurora Serverless v2 and avoids VPC and connection-pooling complexity. A relational database would be the better choice for ad-hoc analytical queries or 10,000+ accounts. If heavy ad-hoc reporting is needed later, the path is DynamoDB → S3 export → Athena, not a migration to Aurora.

### User Attribution Reflects Actual Usage

Bedrock access is permission-gated in IAM Identity Center — only users whose permission set grants Bedrock permissions can invoke it. The `byUser` map is built from CloudTrail invocation records, so it contains only users who actually called Bedrock. Users with permissions but no usage, and users without permissions, never appear. The Users page therefore lists active Bedrock users only.

### Server-Only Data Access

DynamoDB and the AWS SDK are accessed **only from server code** — Route Handlers and Server Components, via data-access functions in `apps/dashboard/lib/data/` that import `server-only`. Client Components never touch the table; they receive data as props from Server Components or fetch it from same-origin Route Handlers over HTTP. AWS credentials never reach the browser.

### In-Memory Aggregation for Rankings

Department, service, and user rankings are computed in the Next.js API route by fetching all `DailyRollup` items for the date range (one GSI1 query per day in range, paginated) and aggregating in memory.

**Scale math:** one rollup per account per day → `accounts × days` items (e.g. 500 accounts × 30 days = **15,000** items). v1 targets **≤100 accounts** for snappy ranking at the default 30-day range (~3,000 items). Organizations above ~100 accounts should use shorter date presets, rely on the 90-day API cap, or add pre-aggregated entities later (see No DepartmentDailyRollup Entity).

At ≤3,000 items, DynamoDB fetch plus in-memory sort typically completes in well under a second. No pre-aggregated ranking entities needed for v1.

### No HourlySnapshot Entity

Lambda collects hourly but always writes the full current day's total as a DailyRollup (overwrite). Daily granularity is sufficient for cost dashboard display. If intra-day drill-down is needed in the future, an HourlySnapshot entity (SK: SNAP#{ISO_HOUR}) can be added without changing existing schema.

### No DepartmentDailyRollup Entity

Department totals are computed on-the-fly from account DailyRollups grouped by departmentId. Eliminates write amplification in the Lambda. If account count exceeds ~1000, a pre-aggregated entity can be added later.

### TTL and Data Retention

DailyRollup items expire after 365 days via DynamoDB TTL. This is configurable per deployment. For longer retention, items can be archived to S3 before expiry.

### Service Attribution (`byService`)

**v1 source of truth:** CloudTrail Lake — the `service` name is derived from the **application inference profile** on each `InvokeModel` / `InvokeModelWithResponseStream` call (teams create one profile per service, tagged `service=<name>`). Token and invocation counts in `byService` come from CloudTrail; costs are proportional estimates (see System Architecture spec).

**Not used for `byService` in v1:** AWS Billing cost allocation tags in Cost Explorer. Those tags affect CE billing reports only and are not merged into the dashboard's `byService` map. A future enhancement could cross-check CE tags for validation.

### `_untagged` Bucket

Calls with no identifiable inference profile (or no `service` tag on the profile) are stored under `_untagged` in `byService`. **Direct `InvokeModel` calls** (model ID only, no inference profile) always count as `_untagged` for service; user attribution from CloudTrail still applies. The Settings page **tag coverage** metric is `1 − (untagged tokens / total tokens)` per team over the selected date range — it measures inference-profile discipline, not Cost Explorer tag activation.
