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
- **Charge categories**: The optional `nonModel` map is keyed by canonical charge-category keys — see Non-Model Charges below.

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

Access-control entities (identity, member affiliation, admin scopes, role grants, group mappings, visibility, password users and their SSO reservations and references, audit records, the per-user approval, the password sign-in switch) share this table under new key prefixes — see [Access Control spec](2026-11-10-access-control.md) — *Data model additions* (decided 2026-11-10). `byUser` keys are canonical usage identities (the lower-cased email after the SSO prefix; same spec — *Canonical usage identity*), canonicalised on read until the Phase 6 collector writes them. LiteLLM entities (connection, operation toggles, team links and their claims, gateway configuration, key requests) use the `LITELLM#` prefix — see [LiteLLM spec](2026-11-10-litellm.md) — *Data model additions*; no service key or key value is ever stored.

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
  region           string           "ap-southeast-2"   -- must equal COLLECTOR_REGION (System Architecture — Region; decided 2026-11-10)
  active           boolean          true
  createdAt        string           ISO8601
  updatedAt        string           ISO8601
```

### Access Patterns

| Pattern | Key condition |
|---------|---------------|
| Get one account | `PK = ACCT#{id}`, `SK = META` |
| All accounts in a department | `GSI1: gsi1pk = DEPT#{deptId}` |
| All accounts (settings page) | Table scan with a `begins_with(PK, "ACCT#") AND SK = META` filter — other entities also use `SK = META` (Access Control spec — *Data model additions*) (v1 expects ≤100 active accounts; design headroom to ~500) |

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
  date             string           (optional) YYYY-MM-DD (UTC) — adopted 2026-10-28 (audit A2), see note below
  departmentId     string
  departmentName   string           (historical snapshot, see Design Decisions)
  teamId           string
  teamName         string           (historical snapshot, see Design Decisions)

  -- Totals --
  cost             number           USD, 6 decimal places — Σ models[*].cost + Σ nonModel[*].cost
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
      priceEffectiveFrom list       (only when token-priced: the price-table `effectiveFrom` values used; amended 2026-11-14)
      priceMissing     boolean      (only on today's rollup: no list price in effect, so `cost` is omitted until Cost Explorer reports; amended 2026-11-14)

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

  -- Non-model charges (optional; see Non-Model Charges) --
  nonModel         map {            (absent on items written before this field existed)
    "<charge-category>": {          e.g. "guardrails", "provisioned-throughput"
      cost             number       USD, ≥ 0 (exact from Cost Explorer in v1)
      costEstimated    boolean      (false in v1 by convention — Cost Explorer is the only source)
      recurring        boolean      true = accrues with time, not with requests (set per category)
      usageQuantity    number       (optional, ≥ 0) Cost Explorer UsageQuantity, summed
      usageUnit        string       (optional, independent of usageQuantity)
      rawUsageTypes    list         non-empty; raw Cost Explorer USAGE_TYPE values folded into this entry
    }
  }

  -- Metadata --
  lastUpdatedAt    string           ISO8601
  ttl              number           epoch seconds = lastUpdatedAt + 365 days (decided 2026-11-10)
```

> **`date` attribute (audit A2; adopted 2026-10-28).** Without it, the day exists only in `SK` (`DAILY#…`) and `gsi1pk` (`DATE#…`). Those key attributes are not in `DailyRollupSchema`, so a Zod parse strips them, and range or trend consumers lose the day. Add `date` (`YYYY-MM-DD`, UTC, Rule 20.1) as a plain attribute that the collector and seed scripts write. It is **optional** in `DailyRollupSchema`, so items written before it existed still parse. The check that `date` matches `SK` (`DAILY#…`) and `gsi1pk` (`DATE#…`) belongs in a **write-side item schema**, `DailyRollupItemSchema` in `packages/shared/src/schemas/` (the full DynamoDB item including key attributes, used by the collector and seed scripts), not in `DailyRollupSchema`, which never sees the key attributes. Data-access functions return `date` on every rollup, deriving it from `SK` for items written without it, so no backfill is needed. When an item has a stored `date` that disagrees with the day in its `SK`, the read **fails** (Rule 60.17): the item is corrupt, because every writer validates with `DailyRollupItemSchema`. The read never silently picks one of the two days (decided 2026-10-28). Lands in Phase 3.1a.

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

Worst case: 10 models x (20 users + 10 services) = 300 nested entries at ~200 bytes each = ~60KB. Well within DynamoDB's 400KB item limit. Safe up to ~50 users and ~30 services per model (~180KB). The `nonModel` map adds at most one entry per charge category (~12), each a few hundred bytes plus its `rawUsageTypes` list — negligible against the limit.

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

The mapping table lives in `@llm-usage-lens/shared` (`packages/shared`) used by both `apps/collector` and `apps/dashboard`, so the two never drift.

> **Proposal (audit A2, 2026-10-23; not yet adopted).** ARN-form model IDs currently fall through to `other`. These include application inference profile ARNs, which carry the v1 `byService` mechanism, and provisioned-model ARNs. Proposed rule: `normalizeModelId` accepts only foundation-model IDs. The **collector** first resolves an inference-profile ARN (via `bedrock:GetInferenceProfile`) or a provisioned-model ARN (via `bedrock:GetProvisionedModelThroughput`) to its underlying foundation model ID, caches the result per run, and only then normalizes. An ARN that cannot be resolved stays `other`, with the ARN in `rawModelIds`. See System Architecture spec — *Proposed collector amendments (audit A2)*.

## Non-Model Charges

**Amendment 2026-10-23.** Amazon Bedrock bills more than per-model token usage. Charges that do not come from a model's input/output tokens are recorded in the optional `nonModel` map on `DailyRollup`, never in `models`. Without this, they would be misfiled under the `other` model or dropped, and account totals would no longer be exact (Rule 20.3). The collector side is in System Architecture spec — *Cost Explorer `USAGE_TYPE` classification*.

### Charge categories

Billing units below come from the [Amazon Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) and the user guide pages cited, as read on 2026-10-23. This spec deliberately records no prices.

| Category key | Covers | Billing basis | `recurring` |
|---|---|---|---|
| `guardrails` | Guardrail policies: content filters, denied topics, sensitive-information filters, contextual grounding checks, image content filters, Automated Reasoning checks | Per 1,000 text units per policy; images per image processed; Automated Reasoning per 1,000 text units per policy. Billed **even when the guardrail blocks the input and the model is never invoked** ([How charges are calculated for Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-how.html#guardrails-charges)) | `false` |
| `provisioned-throughput` | Provisioned Throughput for base or custom models: no-commitment, 1-month, or 6-month term | Hourly per model unit. **Accrues while idle.** "Billing continues until you delete the Provisioned Throughput" ([Provisioned Throughput](https://docs.aws.amazon.com/bedrock/latest/userguide/prov-throughput.html)) | `true` |
| `custom-model-storage` | Monthly storage of fine-tuned or customized models | Per custom model per month | `true` |
| `custom-model-import` | Custom Model Import: active model copies plus storage | Per Custom Model Unit per minute (5-minute windows) while copies are active, plus monthly storage per Custom Model Unit | `true` |
| `model-customization` | Fine-tuning, continued pre-training, and reinforcement fine-tuning jobs | Per training tokens or training hours | `false` |
| `knowledge-bases` | Managed Knowledge Base index storage, retrieval, agentic retrieval, structured-data SQL generation, rerank | Storage per GB-month (recurring part); retrieval per 1,000 API calls | `true` if any included usage type contains `Storage` (unverified marker), else `false` |
| `agents` | Bedrock Agents and AgentCore charges billed under the Bedrock Cost Explorer service | Unverified. The pricing page shows no Agents/AgentCore unit, and AgentCore may bill under its own Cost Explorer service (see *Adjacent services*) | `false` |
| `flows` | Bedrock Flows | Per node transition | `false` |
| `data-automation` | Bedrock Data Automation (BDA) | Per page (documents), per image, per minute (audio/video) | `false` |
| `model-evaluation` | Automatic and human model evaluation jobs | Evaluator tokens; per human task | `false` |
| `other-features` | Known, minor Bedrock features with no category of their own: Intelligent Prompt Routing, Prompt Optimization, Web Search | Per 1,000 requests, per 1,000 tokens, per query | `false` |
| `unclassified` | Any Bedrock usage type that matches neither a model nor a category above | Unknown | `false` |

The key list is closed. It lives in `packages/shared` next to the model table, as `NonModelCategorySchema`, so the collector and dashboard share one list (Rule 20.5). Adding a key is a spec change first.

### Token-based charges that stay model cost

Some charges are token usage of a specific model but are **priced differently** from standard on-demand tokens:

- batch inference (discounted against on-demand)
- prompt caching (cache read and cache write)
- cross-Region inference (Global and geographic inference profiles)
- service tiers (Priority, Flex)

These are **model** cost. They go in `models[<canonical-key>].cost`, not in `nonModel`, because they are a model's tokens. Consequences:

- The collector must still extract the model from these usage types, even though their names carry extra batch, cache, or cross-Region markers (System Architecture spec — *Cost Explorer `USAGE_TYPE` classification*).
- *Today's cost fallback* prices tokens at the Sydney **Geo and In-region** list prices in effect at each hour, including cache read and write where the table has them (System Architecture spec — *Price table (effective-dated)*, amended 2026-11-14). Batch, Global inference, Priority and Flex tokens are not list-priced, so today's estimate is less accurate for accounts that use them. Yesterday's Cost Explorer figure corrects it.
- Batch inference may not appear in CloudTrail `InvokeModel` events or CloudWatch per-invocation metrics. Proportional `byUser`/`byService` splits then spread batch cost across real-time callers. This must be verified in Phase 6. A per-pricing-mode breakdown of model cost is deferred (see [`docs/future-improvements.md`](../future-improvements.md) — *Per-pricing-mode model cost breakdown*).

### Rules

1. **Invariant.** `cost = Σ models[*].cost + Σ nonModel[*].cost` on every rollup, within `|Δ| ≤ 1e-6`. When `nonModel` is absent, the second term is 0.
2. **Never fold a non-model charge into a model's cost**, including `other`. A Provisioned Throughput charge for a Claude Sonnet model unit goes in `provisioned-throughput`, not `claude-sonnet`. The model name may appear in its `rawUsageTypes`.
3. **Never present non-model charges as tokens.** `nonModel` entries carry no `inputTokens`, `outputTokens`, `invocations`, `byUser`, or `byService`. Rollup token and invocation totals count model usage only. `usageQuantity`/`usageUnit` are Cost Explorer's own units (text units, model-unit hours, GB-months) and are never summed across categories.
4. **Never coerce missing to 0.** A category is present only when Cost Explorer returned rows for it. A real zero-cost row may be recorded as `cost: 0`. An absent key means "no charge reported", and the dashboard shows it as absent, not as `$0.00`.
5. **Idle recurring cost must appear.** A `recurring: true` charge on a day with no invocations still produces a `DailyRollup` for that account, with `models: {}` and zero token totals. This overrides the "skip accounts with no data" rule in System Architecture spec — *Lambda Collector Flow* step 1. In that rule, "data" now includes any Cost Explorer Bedrock cost.
6. **No proportional split.** Non-model cost is never attributed to users or services in v1. CloudTrail token ratios say nothing about who caused a guardrail or provisioned-capacity charge. The Users and Services pages therefore sum model cost only, and their totals can be less than the account total (see Design Decisions — *Non-model cost is account-level only*).
7. **Unclassified preserves evidence.** `nonModel.unclassified.rawUsageTypes` keeps every unmatched usage type, mirroring `models.other.rawModelIds`, so operators can extend the classification table.
8. **Today vs. yesterday.** `nonModel` comes only from Cost Explorer. It is never token-estimated. On today's rollup (`costFinalized: false`), when Cost Explorer has not reported yet, `nonModel` is omitted. Absence then means "not yet reported", which the existing "Cost data finalizes within 24h" indicator already covers. Yesterday's rollup carries the full exact map.

### Schema decisions (settled 2026-10-23)

These settle the open `NonModelChargeSchema` / `DailyRollupSchema` choices for Phase 3.1a:

- **`cost`** is a nonnegative number. Cost Explorer can return negative amounts (credits, refunds), but these are out of scope in v1: the collector requests usage records only. The exact Cost Explorer `RECORD_TYPE` handling is unverified and is confirmed in Phase 6.
- **`costEstimated`** is a `boolean`. It is `false` in v1 **by convention** (Cost Explorer is the only source), not a literal in the schema.
- **`recurring`** is a `boolean`, derived by the **collector** from the category after classification. `classifyUsageType` returns only `{ kind, key | category }` and does not return `recurring` (System Architecture spec — *Cost Explorer `USAGE_TYPE` classification*, Recurring flag). `knowledge-bases` is recurring only when one of its usage types contains `Storage` (unverified marker; confirm in Phase 6).
- **`usageQuantity`** is an optional nonnegative number and **`usageUnit`** an optional string. They are independent in the schema; the "same unit or omit both" rule is collector policy (System Architecture spec — Units).
- **`rawUsageTypes`** is a non-empty array of non-empty strings.
- **Entry schema is strict.** `NonModelChargeSchema` is a strict object. This deliberately trades forward compatibility of entries for rejecting token fields (Rule 3): an older reader rejects, rather than strips, an unknown entry field. Adding an entry field therefore requires a schema version bump. The rollup object itself stays non-strict (see Backward compatibility).
- **Invariant tolerance** is `|cost − (Σ models[*].cost + Σ nonModel[*].cost)| ≤ 1e-6` (Rule 1). Entries are 6-dp; the rollup total is their sum. Writers compute the rollup `cost` as the sum of the already-stored, 6-decimal-rounded entry values, never as a separately rounded total (System Architecture spec — *Lambda Collector Flow* step 5).
- **Base + refined export.** `packages/shared` exports an unrefined `DailyRollupBaseSchema` plus the refined `DailyRollupSchema` (the base with the invariant refinement). Zod 4 forbids `.pick`/`.omit`/`.partial`/`.merge` on refined objects, so Phase 3.3 response schemas derive from `DailyRollupBaseSchema`.

### Backward compatibility

`nonModel` is additive and optional. Items written before this amendment, and seed data that predates it, have no `nonModel` and are read as "no non-model charges recorded". No migration or backfill is required. Older items whose `cost` equals the model sum (within `|Δ| ≤ 1e-6`) stay valid under the invariant. An older item or fixture whose `cost` differs from its model sum (for example a cost with an empty `models` map) fails the refined `DailyRollupSchema` and must be corrected; it still parses under `DailyRollupBaseSchema`. `DailyRollupSchema` stays non-strict, so a reader built before this change strips the field instead of rejecting the item. Only the `nonModel` entry schema is strict (see Schema decisions).

### Dashboard impact (v1)

No new page and no new route. `/api/overview` (and `/api/departments/[id]` and `/api/teams/[id]` where they report totals) adds a model vs. non-model split to its response, plus per-category totals with their `recurring` flag. The Overview page (Phase 4.1):

- shows **Total Cost** with a model / non-model split;
- marks recurring categories (Provisioned Throughput, custom model storage and import, Knowledge Base storage) with a "recurring" indicator, so idle capacity cost is visible on days with no invocations;
- shows non-model cost as its own series or segment in the cost trend and model distribution charts. It is never merged into `other`. Non-model series use a dedicated semantic chart token, not a model token (Rule 40.2);
- carries a scope note, "Bedrock service charges only", because adjacent-service charges are excluded (System Architecture spec — *Adjacent services*).

The Department Detail (Phase 4.4) and Team Detail (Phase 4.6) headers carry the same scope note, because they also show totals (decided 2026-11-06).

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

`SyncCountdown` in the UI counts down to `nextScheduledAt`. If the item is missing (never synced), show a neutral message instead of a countdown.

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
| `DailyRollupBaseSchema` / `DailyRollupSchema` | Lambda writes, API route responses. Optional `nonModel`, validated with `NonModelCategorySchema` keys and `NonModelChargeSchema` entries. `DailyRollupSchema` refines the base with the cost invariant (Non-Model Charges, Rule 1) within `\|Δ\| ≤ 1e-6`; derived schemas (`.pick`/`.omit`/`.partial`/`.merge`) start from the unrefined base (Non-Model Charges — *Schema decisions*) |
| `NonModelCategorySchema` / `NonModelChargeSchema` | Charge-category key enum + entry shape (Non-Model Charges) |
| `DatedDailyRollupSchema` | Read side: `DailyRollupBaseSchema` with a required `date` plus the cost invariant; the return shape of the `lib/data/**` rollup functions (*`date` attribute*) |
| `DailyRollupItemSchema` | Write side: the full DynamoDB item (key attributes + required `date`, checked against `SK`/`gsi1pk`) plus the cost invariant; used by the seed scripts and the Phase 6 collector |
| `SyncStatusSchema` | Sync status display, Lambda writes |
| `RankingQuerySchema` | API query params: dateFrom, dateTo, `tab` (`departments` \| `teams` \| `services` \| `users`), model, sortBy, order, limit |
| `DateRangeQuerySchema` | API query params: dateFrom, dateTo, accountId (max 90-day span) |
| `TeamsQuerySchema` | Extends date range with optional `departmentId` filter (`GET /api/teams`) |
| `CreateAccountInputSchema` | `POST /api/accounts` body: `AccountMetaSchema` without `active`, `createdAt`, `updatedAt` (server sets `active: true` and both timestamps) |
| `UpdateAccountPatchSchema` | `PATCH /api/accounts/[id]` body: `AccountMetaSchema` without `accountId`, `active`, `createdAt`, `updatedAt`, every field optional; `accountId` is immutable, deactivation is `DELETE` only |
| `ApiErrorBodySchema` / `apiSuccessSchema(T)` / `apiResponseSchema(T)` | Standard `{ error: { code, message } }` / `{ data: T }` envelope; route handlers emit `code` ∈ `UNAUTHORIZED` \| `FORBIDDEN` \| `BAD_REQUEST` \| `NOT_FOUND` \| `INTERNAL` (`ApiErrorCodeSchema`) |
| `SyncStatusResultSchema` | `GET /api/sync-status` data: `{ state: "never-synced" }` \| `{ state: "synced", status: SyncStatus }` (a missing item is a handled state) |
| `AccountListSchema` | `GET /api/accounts` data: `AccountMeta[]` |
| `OverviewResponseSchema` | `GET /api/overview` data: `totalCost`, `modelCost`, `nonModelCost`, `inputTokens`, `outputTokens`, `invocations`, `costFinalized`, `activeAccounts`, `mostUsedModel` (model key or `null`), `byModel[]` (`model`, `cost`, tokens, `invocations`), `nonModelByCategory[]` (`category`, `cost`, `recurring`; empty when no charge reported), `dailyTrend[]` (`date`, `cost`, `modelCost`, `nonModelCost`, `byModel` partial record), `topDepartments[]` (`departmentId`, `departmentName`, `cost`) |
| `RankingResponseSchema` | `GET /api/ranking` data: `tab`, `rows[]` (`id`, `name`, `cost`, `costEstimated`, tokens, `invocations`) |
| `DepartmentsResponseSchema` / `TeamsResponseSchema` | `GET /api/departments` / `GET /api/teams` data: `departments[]` / `teams[]` rows with ids, names (teams add `departmentId`, `departmentName`) and totals `cost`, `modelCost`, `nonModelCost`, tokens, `invocations`. Department rows also carry `teamCount` (distinct `teamId`s among the department's rollups in the range; a team that moved departments counts under each department its rollups name — *Historical Snapshots for Department/Team Names*) and `topModel` (the model with the most invocations in the range, an invocation tie going to the higher-cost model, or `null` when no model has invocations — the same rule as the Overview's `mostUsedModel`), for the Departments cards (Phase 4.3; decided 2026-11-04). `DepartmentDetailResponseSchema` inherits both fields from the row. Team rows also carry `serviceCount` (distinct `byService` keys across every model entry of the team's rollups in the range, excluding `_untagged` — it is the no-service-tag bucket, *`_untagged` Bucket*; no other reserved key is excluded, because none is adopted — if audit A2's `_unattributed` key is adopted, this rule is revisited with it, decided 2026-11-06) and `userCount` (distinct `byUser` keys across every model entry of the team's rollups in the range; no key is excluded, and the same `_unattributed` revisit applies); both are `0` when the team has no attributed usage in the range, which is a real count, not missing data. For the Teams table (Phase 4.5; decided 2026-11-05). With `departmentId`, the rows, their totals and both counts cover only the rollups that name that department, so a team that moved departments appears under each department its rollups name (*Historical Snapshots for Department/Team Names*; decided 2026-11-06). `TeamDetailResponseSchema` inherits both fields from the row |
| `DepartmentDetailResponseSchema` | `GET /api/departments/[id]` data: department row plus `nonModelByCategory[]`, `teams[]`, `dailyTrend[]`, `topUsers[]`, `teamTrend[]` (`date`, `teams[]` of `teamId`, `cost`) |
| `TeamDetailResponseSchema` | `GET /api/teams/[id]` data: team row plus `nonModelByCategory[]`, `accounts[]` (`accountId` and totals), `dailyTrend[]`, `byModel[]`, `services[]`, `users[]`. `services[]` lists every `byService` key including `_untagged`, so `services.length` can exceed `serviceCount` by one (decided 2026-11-06) |
| `ServicesResponseSchema` / `UsersResponseSchema` | `GET /api/services` / `GET /api/users` data: `services[]` (`serviceName`) / `users[]` (`userId`), each with `cost`, `costEstimated: true`, tokens (`inputTokens`, `outputTokens`), `invocations`; model cost only, non-model excluded. A `services[]` row (`ServiceListRowSchema`: the `ServiceRowSchema` fields plus `teamId`, `teamName`, `departmentId`, `departmentName`) is one team's service: one row per (`teamId`, `serviceName`) pair, merging that team's `byService` entries across its accounts, every model and the range, grouped by each rollup's own `teamId` snapshot (an account remapped mid-range contributes to each team its rollups name), and adding `teamId`, `teamName`, `departmentId`, `departmentName` from the team's latest rollup in the range (the same rule as the Teams row). Two teams with the same service name give two rows. Each team's `_untagged` bucket is its own row. Rows sort by `cost` descending, then `serviceName`, then `teamId` ascending. For the Services table's Team and Department columns and its team link (Phase 4.7; decided 2026-11-06). Team Detail's `services[]` keeps `ServiceRowSchema`. The Ranking `services` tab keeps its name-merged rows (Access Patterns — *Ranking: top services by cost*), so a service name shared by two teams is one Ranking row but two Services rows. A `users[]` row follows the same rule (decided 2026-11-06, Phase 4.8): `UserListRowSchema` (the `UserRowSchema` fields plus `teamId`, `teamName`, `departmentId`, `departmentName`), one row per (`teamId`, `userId`) pair, merging that team's `byUser` entries across its accounts, every model and the range, grouped by each rollup's own `teamId` snapshot, with names from the team's latest rollup in the range; rows sort by `cost` descending, then `userId`, then `teamId` ascending. Team Detail's `users[]` and Department Detail's `topUsers[]` keep `UserRowSchema`, and the Ranking `users` tab keeps its name-merged rows |

## API Routes

All routes live under `apps/dashboard/app/api/`, require an Auth.js session, validate query/body with Zod, and return `{ data: T }` or `{ error: { code, message } }`. Date params use `YYYY-MM-DD` (UTC).

**HTTP status codes (amended 2026-11-10):** reads are scope-filtered and an out-of-scope detail returns the same `404` body as a missing one; every write route checks its permission (not only `Admin`) before parsing; a write whose `Origin` host differs from `Host` (or is missing) gets `403 FORBIDDEN` after the permission check and before parsing, and a write body that is not `application/json` gets `400`; `409` (`CONFLICT`, `MANAGED_BY_SSO`, `ALREADY_AFFILIATED`) is a stale `version` or a uniqueness/ownership conflict; `403 REAUTH_REQUIRED` guards global-role grants; `/api/health` is the one unauthenticated route; every `/api/*` Route Handler response sets `Cache-Control: private, no-store` (Access Control spec — *Enforcement*, *API routes*, *Error-code registry*). Original text: `200` success · `400` request parsing or validation error (malformed JSON body, or a failed Zod parse of query, path or body; also `POST /api/accounts` for an account that already exists) · `401` no session · `403` signed in without the `Admin` role on a write route (`POST`/`PUT`/`PATCH`/`DELETE` under `/api` except Auth.js's `/api/auth/[...nextauth]`; today `POST /api/accounts`, `PATCH`/`DELETE /api/accounts/[id]`), checked after the session and before input parsing, so a non-admin gets `403`, never `400`/`404` (System Architecture — *Authentication & Access*) · `404` account/department/team not found — for department and team detail, "found" means present in `AccountMeta` **or** in any rollup in the requested range (historical departments/teams keep their snapshot names; see *Historical Snapshots for Department/Team Names*), so a historical id queried for a range with no rollups is `404` · `500` unexpected server error, including a stored item or a response that fails its Zod schema (a server-side defect, not bad input).

| Route | Method | Schema / params | Data access |
|-------|--------|-----------------|-------------|
| `/api/overview` | GET | `DateRangeQuerySchema` | GSI1 rollups for range → KPIs, trends, top departments |
| `/api/ranking` | GET | `RankingQuerySchema` | GSI1 rollups for range → in-memory group/sort by tab |
| `/api/departments` | GET | `DateRangeQuerySchema` | Rollups for the range → department aggregates; a department appears only when it has rollups in the range, and `AccountMeta` is not read (names come from the rollup snapshots — *Historical Snapshots for Department/Team Names*; decided 2026-11-06) |
| `/api/departments/[id]` | GET | `DateRangeQuerySchema` | Department rollups, teams, top users. The `id` path parameter is validated before any read (1–128 characters, none of the C0 control characters U+0000–U+001F or U+007F; `400` otherwise — security review 2026-11-11). This is a read-side bound: `AccountMeta` keeps `z.string().min(1)` for `teamId`/`departmentId`, and an id outside the bound is not reachable by its detail route |
| `/api/teams` | GET | `TeamsQuerySchema` | All accounts / optional `departmentId` filter → team list |
| `/api/teams/[id]` | GET | `DateRangeQuerySchema` | Account rollups → services, users, models. The `id` path parameter is validated as for `/api/departments/[id]` |
| `/api/services` | GET | `DateRangeQuerySchema` | Rollups → group by team, merge each team's `byService` across its accounts |
| `/api/users` | GET | `DateRangeQuerySchema` | Rollups → group by team, merge each team's `byUser` across its accounts |
| `/api/sync-status` | GET | — | `getSyncStatus()` |
| `/api/accounts` | GET | — | `getAllAccounts()` |
| `/api/accounts` | POST | `CreateAccountInputSchema` | Settings CRUD (`Admin`) |
| `/api/accounts/[id]` | PATCH | `UpdateAccountPatchSchema` | Settings CRUD (`Admin`) |
| `/api/accounts/[id]` | DELETE | — | Soft-deactivate (`active: false`; `Admin`) |

The access-control routes (`/api/health`, `/api/me`, members, admins, moves, role grants, group mappings, visibility, identities, password users, the password sign-in switch, the per-user approval, audit, access review) and their permissions are listed in [Access Control spec](2026-11-10-access-control.md) — *API routes*. The LiteLLM routes (`/api/litellm/**`, `/api/finance/statement`) and the error codes `OPERATION_DISABLED` (403), `OPERATION_UNAVAILABLE` (403), `LITELLM_UNAVAILABLE` (503) and `PRIVILEGED_TARGET` (409) are in the [LiteLLM spec](2026-11-10-litellm.md) — *API routes*. `Admin` above reads `internal-admin` from Phase 4R.

## Design Decisions

### Model as Primary Breakdown Dimension

All metrics (cost, tokens, invocations) are broken down by model first. User and service are nested inside each model. This matches how the raw data sources group data (CloudWatch and CloudTrail both report per-model) and avoids reshuffling in the Lambda. Cost that no model's tokens produced sits beside `models` in `nonModel` (see Non-Model Charges). It is not forced into the model dimension.

### Non-model cost is account-level only

`nonModel` has no `byUser`/`byService` breakdown. Department, team, and account totals (Overview, Ranking departments/teams tabs, Departments, Teams) use rollup `cost`, which includes `nonModel`. User and service views use per-model attribution, which excludes it. Such a view shows a "model usage only" note so the gap is not mistaken for missing data. Attributing guardrail or provisioned-capacity charges to callers would need per-request guardrail metadata or resource tags. That is out of scope for v1.

### Historical Snapshots for Department/Team Names

`departmentName` and `teamName` are duplicated from AccountMeta into every DailyRollup. If a team moves departments, old rollups retain the historical assignment. This is intentional: financial reporting should reflect where costs were attributed at the time they occurred. When an id was renamed inside a requested range, its aggregate row (list and detail routes) shows the latest name in that range (decided 2026-10-29).

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

DailyRollup items expire 365 days after they were last updated (`ttl = lastUpdatedAt + 365 days`; decided 2026-11-10) via DynamoDB TTL. This is configurable per deployment. For longer retention, items can be archived to S3 before expiry.

### Service Attribution (`byService`)

**v1 source of truth:** CloudTrail Lake — the `service` name is derived from the **application inference profile** on each `InvokeModel` / `InvokeModelWithResponseStream` call (teams create one profile per service, tagged `service=<name>`). Token and invocation counts in `byService` come from CloudTrail; costs are proportional estimates (see System Architecture spec).

**Not used for `byService` in v1:** AWS Billing cost allocation tags in Cost Explorer. Those tags affect CE billing reports only and are not merged into the dashboard's `byService` map. A future enhancement could cross-check CE tags for validation.

### `_untagged` Bucket

Calls with no identifiable inference profile (or no `service` tag on the profile) are stored under `_untagged` in `byService`. **Direct `InvokeModel` calls** (model ID only, no inference profile) always count as `_untagged` for service; user attribution from CloudTrail still applies. The Settings page **tag coverage** metric (Phase 4.9b, deferred) is `1 − (untagged tokens / total tokens)` per team over the selected date range — it measures inference-profile discipline, not Cost Explorer tag activation.
