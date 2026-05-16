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
| All accounts (settings page) | Table scan with `SK = META` filter (~500 items max) |

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
| All accounts for date range | N parallel GSI1 queries (one per day) |
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

Normalization rules:
- Match by prefix on the model family, ignoring version/date suffixes and the `:N` inference profile suffix.
- Region-prefixed IDs (e.g. `us.anthropic.claude-...`) strip the region prefix before matching.
- Unrecognized model IDs fall into the `other` canonical key. The raw IDs are preserved in a `rawModelIds` list inside that entry so new models can be identified and added to the mapping.

The mapping table lives in shared code (`lib/models.ts`) used by both the Lambda and the Next.js app, so the two never drift.

## Entity: SyncStatus

Tracks the last Lambda collector run. Single item, always overwritten.

```
PK:      SYSTEM
SK:      SYNC#LATEST

Attributes:
  lastRunAt        string           ISO8601
  status           string           "success" | "partial" | "error"
  accountsTotal    number
  accountsSuccess  number
  accountsFailed   number
  errors           list             [ { accountId: string, message: string } ]
  durationMs       number
```

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
| `RankingQuerySchema` | API query params: dateFrom, dateTo, tab, model, sortBy, order, limit |
| `DateRangeQuerySchema` | API query params: dateFrom, dateTo, accountId |

## Design Decisions

### Model as Primary Breakdown Dimension

All metrics (cost, tokens, invocations) are broken down by model first. User and service are nested inside each model. This matches how the raw data sources group data (CloudWatch and CloudTrail both report per-model) and avoids reshuffling in the Lambda.

### Historical Snapshots for Department/Team Names

`departmentName` and `teamName` are duplicated from AccountMeta into every DailyRollup. If a team moves departments, old rollups retain the historical assignment. This is intentional: financial reporting should reflect where costs were attributed at the time they occurred.

### DynamoDB over a Relational Database

The store is DynamoDB, not RDS/Aurora. An analytics dashboard is aggregation-heavy and SQL `GROUP BY` would be a natural fit, but at this scale (<500 accounts) the tradeoffs favor DynamoDB: in-memory aggregation is proven fast (<1500 items, <100ms — see below), DynamoDB on-demand costs roughly 10× less than Aurora Serverless v2 at this volume, and it avoids VPC and connection-pooling complexity. A relational database would be the better choice for ad-hoc analytical queries or 10,000+ accounts. If heavy ad-hoc reporting is needed later, the path is DynamoDB → S3 export → Athena, not a migration to Aurora.

### User Attribution Reflects Actual Usage

Bedrock access is permission-gated in IAM Identity Center — only users whose permission set grants Bedrock permissions can invoke it. The `byUser` map is built from CloudTrail invocation records, so it contains only users who actually called Bedrock. Users with permissions but no usage, and users without permissions, never appear. The Users page therefore lists active Bedrock users only.

### Server-Only Data Access

DynamoDB and the AWS SDK are accessed **only from server code** — Route Handlers and Server Components, via data-access functions in `lib/data/` that import `server-only`. Client Components never touch the table; they receive data as props from Server Components or fetch it from same-origin Route Handlers over HTTP. AWS credentials never reach the browser.

### In-Memory Aggregation for Rankings

Department, service, and user rankings are computed in the Next.js API route by fetching all DailyRollup items for the date range and aggregating in memory. For an organization with <500 accounts, this is <1500 items for a 30-day range. DynamoDB returns this in <100ms and JavaScript sorts it in <10ms. No pre-aggregated ranking entities needed.

### No HourlySnapshot Entity

Lambda collects hourly but always writes the full current day's total as a DailyRollup (overwrite). Daily granularity is sufficient for cost dashboard display. If intra-day drill-down is needed in the future, an HourlySnapshot entity (SK: SNAP#{ISO_HOUR}) can be added without changing existing schema.

### No DepartmentDailyRollup Entity

Department totals are computed on-the-fly from account DailyRollups grouped by departmentId. Eliminates write amplification in the Lambda. If account count exceeds ~1000, a pre-aggregated entity can be added later.

### TTL and Data Retention

DailyRollup items expire after 365 days via DynamoDB TTL. This is configurable per deployment. For longer retention, items can be archived to S3 before expiry.

### _untagged Bucket

Usage without a service cost allocation tag is captured under the `_untagged` key in byService. The Settings page displays a tag coverage metric per team to motivate tagging discipline.
