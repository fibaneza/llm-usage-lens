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
| Migration marker (PERF-1b) | `SYSTEM` | `MIGRATION#ACCOUNT_REGISTRY` | — | — |
| AppTeam (management improvements D5, 2026-11-17) | `APPTEAM#{teamId}` | `META` | `APPTEAMS` | `APPTEAM#{teamId}` |
| AppTeamNameClaim | `APPTEAMNAME#{lower(trim(name))}` | `OWNER` | — | — |
| BudgetResetRequest, OpenResetRequestClaim, BudgetReset, Notification (unit M4, 2026-11-17) | `BRREQ#…`, `BRREQOPEN#…`, `BRESET#TEAM#…` (RS2 adds `BRESET#LTEAM#…`, `BRESET#LUSER#…`), `NOTIF#…` | see *Budget reset entities (unit M4)* | `BRREQS#TEAM#…`, `BRESETS#IDENT#…` | see that section |

The `SYSTEM` partition holds one-off system items: the sync status and, from PERF-1b, the account-registry migration marker that the backfill writes (*Access Patterns* — PERF-1b *Migration*). Neither item is on GSI1.

Forward note (2026-11-17): from Phase 5 unit PERF-1b the `AccountMeta` GSI1 keys become `ACCOUNTS` / `DEPT#{departmentId}#ACCT#{accountId}` (*Access Patterns* below). Until that unit ships, the row above is what the code writes.

Access-control entities (identity, member affiliation, admin scopes, role grants, group mappings, visibility, password users and their SSO reservations and references, audit records, the per-user approval, the password sign-in switch) share this table under new key prefixes — see [Access Control spec](2026-11-10-access-control.md) — *Data model additions* (decided 2026-11-10). `byUser` keys are canonical usage identities (the lower-cased email after the SSO prefix; same spec — *Canonical usage identity*), canonicalised on read until the Phase 6 collector writes them. LiteLLM entities (connection, operation toggles, team links and their claims, gateway configuration, key requests) use the `LITELLM#` prefix — see [LiteLLM spec](2026-11-10-litellm.md) — *Data model additions*; no service key or key value is ever stored.

## Entity: AppTeam (management improvements D5, 2026-11-17)

*Agent decision, 2026-11-17 (unit M2; user decision D6 for who creates). An app team can exist without an AWS account: LiteLLM limits how many LiteLLM teams exist, and people who do not use Bedrock directly still need a team for membership, a lead and LiteLLM spend.* Owned by the access-control storage boundary (Access Control — *Data model additions*, D26: `lib/data/access/app-teams.ts`), because a team is part of the membership hierarchy.

```
PK:      APPTEAM#{teamId}           e.g. APPTEAM#appteam-3f0c…
SK:      META
GSI1pk:  APPTEAMS
GSI1sk:  APPTEAM#{teamId}

Attributes:
  teamId           string           "appteam-<uuid v4>", generated on the server
  name             string           1–80 characters, trimmed
  departmentId     string           an existing registry department
  departmentName   string           the registry's department name at creation
  createdBy        string           the creator's oid
  createdAt        string           ISO8601
  version          number           optimistic concurrency
```

- **Access patterns:** list created teams `Query GSI1 gsi1pk = APPTEAMS` (loop on `LastEvaluatedKey`, Rule 20.6); one team `GetItem PK = APPTEAM#{teamId}, SK = META`; name uniqueness `AppTeamNameClaim` (`APPTEAMNAME#{lower(trim(name))}` / `OWNER`) with `attribute_not_exists(PK)` in the same `TransactWriteItems` as the team and its audit record.
- **The team list** is the registry teams (`AccountMeta`, deduplicated by `teamId`) plus the created teams, served by `GET /api/access/org-units` with `hasAwsAccount`. Rollup-based routes (`/api/teams`, `/api/teams/[id]`, Ranking) are unchanged: a created team has no `DailyRollup`, so no Bedrock row; pages that list teams show it as "No AWS account", never `$0`.
- **Ids never collide:** the reserved prefix `appteam-` is refused (`400`) for `teamId` in `CreateAccountInputSchema` (data-function input) and `UpdateAccountPatchSchema` (amended 2026-11-17; from 2026-11-23 the create body carries no id and generated ids start with `team-`, unit ST1), so a registry team can never take a created team's id, and the create route never accepts an id from the body.
- **Names never collide, both ways (agent decision, 2026-11-17, M0 review round 1):** `POST /api/teams` refuses a name equal (case-insensitively, after trimming) to a created team's or a registry team's name (`409 CONFLICT`), and `POST /api/accounts` and `PATCH /api/accounts/[id]` refuse a `teamName` equal to a created team's name (`409 CONFLICT`, no write; they read the `AppTeamNameClaim`). Reason: two teams with one name would be indistinguishable in every picker (Access Control — *Created app teams*, T-MI3).
- **Create only** in v1; rename and delete are in `docs/future-improvements.md`. No TTL. *Amended 2026-11-25 (unit TP1): name and department are editable (Access Control — Edit a created team); delete stays future.*

## Entity: AccountMeta

Maps an AWS account to the organizational hierarchy. Managed via the Settings page. From 2026-11-23 `departmentId` and `teamId` are generated by the server on create (*API Routes* — `POST /api/accounts`, which has the reuse rule). The GSI1 keys below change in Phase 5 unit PERF-1b (forward note under *Entity Map*; *Access Patterns*).

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
| All accounts in a department | `GSI1: gsi1pk = DEPT#{deptId}`. **Replaced in PERF-1b** by `gsi1pk = ACCOUNTS` with `begins_with(gsi1sk, "DEPT#{deptId}#")` (below) |
| All accounts (settings page) | Table scan with a `begins_with(PK, "ACCT#") AND SK = META` filter — other entities also use `SK = META` (Access Control spec — *Data model additions*) (v1 expects ≤100 active accounts; design headroom to ~500). **Replaced in PERF-1b** by the account registry index below |

**The account list is never an uncached Scan on a request path (agent
decision, 2026-11-17, Phase 5 *Performance and caching*).** A Scan reads the
whole table (rollups, audit records, identities), so its time and read cost
grow with the table, not with the number of accounts. Two steps:

1. **PERF-1** — every request path reads the list through the cached wrapper
   (`getAllAccountsCached`, 1 hour, tag `accounts`, invalidated on account
   writes — Design System — *Caching Strategy*), as the Phase 4R routes already
   do through `lib/api/org-lookup.ts`. The account registry is not
   authorization data (Access Control — *Enforcement* item 4 lists what is
   never cached). This holds on write paths too: a write route may resolve
   a team or department from the cached list, and it is the one exception
   to "no write-path read comes from a cache" (Design System — *Caching
   Strategy*; LiteLLM spec — *Caching*). PERF-1 adds no new staleness
   beyond this existing 1-hour cache.
   **Residual risk, accepted (agent decision, 2026-11-17).** An account
   write calls `revalidateTag("accounts")` on the task that served it only.
   The other Fargate task keeps its list for up to 1 hour, so a request it
   serves, a write included, can see an account under its old team or
   department, or miss a new one, for that long. The visible consequence:
   an account moved out of team A stays visible to team A's Lead on that
   other task for up to 1 hour, and the new team's Lead may not see it there
   yet (cross-referenced from Access Control — *Enforcement* item 4).
   Accepted because: the
   Phase 4R write routes on `main` already behave this way; account changes
   are rare and made only by an `internal-admin`; roles, grants, scopes,
   affiliations and team links are still read live on every request, so a
   stale list cannot grant a permission, it can only place an account in
   last hour's structure; and removing the window needs a shorter TTL or
   invalidation shared between tasks, which is deferred with the shared
   cache (`docs/future-improvements.md` — *Shared cache (Valkey)*, which
   names this window). The user can overturn this by asking for a shorter
   TTL on the account list.
2. **PERF-1b — account registry index.** `AccountMeta` moves to one GSI1
   partition: `gsi1pk = ACCOUNTS`, `gsi1sk = DEPT#{departmentId}#ACCT#{accountId}`.
   "All accounts" becomes one `Query` on `gsi1pk = ACCOUNTS`; "all accounts in
   a department" becomes the same `Query` with
   `begins_with(gsi1sk, "DEPT#{deptId}#")`. Both still loop on
   `LastEvaluatedKey` (Rule 20.6). `ACCOUNTS` is a new GSI1 partition value
   on the existing index. It collides with none in use (`DEPT#…`, `DATE#…`,
   `MEMBERS#…`, `ADMINS#…`, `AUDIT#…`, `LITELLM#…`, `IDENTS`, `ROLEGRANTS`,
   `GROUPMAPS`, `LOCALUSERS`; Access Control — *Data model additions*) and
   follows the bare-word pattern of the last four. No new index or IAM
   change.
   Options considered: a sparse second GSI (needs a FoundationStack change and
   deploy) and mirrored registry items (can diverge from `AccountMeta`).
   Reversible.
   **Migration (agent decision, 2026-11-17).** Account writes set the new
   keys; the seeds and `scripts/create-table.ts` follow. Accounts written
   before PERF-1b are moved by a one-off backfill, never by re-saving them
   by hand: a manual re-save silently leaves out any account nobody opens,
   and a deactivated account cannot be re-saved.
   - **Backfill script** `scripts/backfill-account-registry.ts` (the
     repo-root `scripts/` pattern): it reads every `AccountMeta`, active or
     deactivated, sets the two GSI1 keys with a conditional `UpdateItem`
     that changes nothing else, and then writes the marker item
     `PK = SYSTEM`, `SK = MIGRATION#ACCOUNT_REGISTRY`. It is idempotent: a
     second run updates nothing and leaves the marker.
   - **Dual read until the marker exists.** With the marker, both patterns
     are the `Query` above. Without it, both are served from the Scan as
     today (the department pattern filters that list in memory), so an
     account with old keys is never dropped and correctness never depends
     on the backfill having run. Both paths sit behind the cached wrapper of
     step 1, so the fallback costs at most one Scan per hour per task.
   - **Deployed environments.** Repo-root scripts refuse non-local
     endpoints (Rule 10.5). Running the backfill against a deployed table
     therefore needs an explicit, user-run mode and a recorded exception to
     that rule. That is the user's decision, taken when PERF-1b is built
     (implementation-phases — *Decision policy*); until then a deployed
     environment stays on the Scan fallback, which is correct.
   Until PERF-1b ships the entity map above stays as written.

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
  expiresAt        number           epoch seconds = lastUpdatedAt + 365 days (decided 2026-11-10; renamed from `ttl` 2026-11-17, see below)
```

> **TTL attribute `expiresAt` (agent decision, 2026-11-17, fix/rollup-ttl-attribute).** DynamoDB allows one TTL attribute per table, and the FoundationStack table's is `expiresAt` (Platform spec; the audit records use it). The rollup attribute was `ttl`, so rollups would never have expired in AWS. Rollups now write `expiresAt` (epoch seconds) instead. It is **required** in the write-side `DailyRollupItemSchema` (collector and seeds) and **optional** in `DailyRollupSchema`, so items seeded before the rename (which carry `ttl`) still parse on read, the same backward-compatibility rule as `date`; reseed local tables to drop `ttl`. A CDK test asserts the table's TTL attribute equals the attribute the rollup schema writes, so the two cannot drift again. The table and the audit records are unchanged.

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

## Budget reset entities (unit M4)

*Added 2026-11-17 (unit M4, user request items 6–8; decisions MG-D8 to
MG-D13 in the [LiteLLM spec](2026-11-10-litellm.md) — *Decisions* and
*Budget reset requests*).* Same table, no new GSI; the new prefixes collide
with no existing `PK` or `gsi1pk` prefix. Zod schemas in
`packages/shared/src/schemas/budget-reset.ts` (types via `z.infer`). Key
builders live in the pure modules `apps/dashboard/lib/data/budget-resets-keys.ts`
(requests, claims, ledger) and `apps/dashboard/lib/data/notifications-keys.ts`
(no `server-only`, no I/O), not in `lib/data/access/keys.ts`, because the
access structure test allows imports of the access keys only from
`lib/data/access/**` and `scripts/**` (agent decision, 2026-11-17: the
Storage boundary's rule is kept and the new storage modules sit outside
`access/`). Every timestamp is UTC ISO 8601 (Rule 20.1); every amount is
USD (Rule 20.2). The TTL attribute is the table's `expiresAt` (epoch
seconds).

| Entity | PK | SK | GSI1pk | GSI1sk | TTL (`expiresAt`) |
|---|---|---|---|---|---|
| BudgetResetRequest | `BRREQ#{requestId}` | `META` | `BRREQS#TEAM#{teamId}` | `{status}#{createdAt}#{requestId}` | `createdAt` + 90 days |
| OpenResetRequestClaim (one open request per person per team) | `BRREQOPEN#{teamId}#{oid}` | `OWNER` | — | — | `requestExpiresAt` |
| BudgetReset (ledger) | `BRESET#TEAM#{teamId}` (scope `member`, LiteLLM team linked to an app team; unchanged); `BRESET#LTEAM#{litellmTeamId}` (scope `member`, LiteLLM team not linked); `BRESET#LUSER#{litellmUserId}` (scope `user`) — the last two from unit RS2 | `{timestamp}#{resetId}` | `BRESETS#IDENT#{oid}` only when an `oid` exists; otherwise no GSI1 attributes | `{timestamp}#{resetId}` | `timestamp` + 400 days |
| Notification | `NOTIF#{recipientOid}` | `{createdAt}#{notificationId}` | — | — | `createdAt` + 90 days |

**BudgetResetRequest** — `requestId` (UUID, server-generated), `teamId`,
`departmentId` and `litellmTeamId` (snapshots at creation, for display; the
decision re-reads the registry and the team link), `requesterOid`, `reason`
(optional, plain text, 1–280 characters after trimming; C0 control
characters U+0000–U+001F except line feed, and U+007F, are rejected),
`status` (`open` \| `approving` \| `approved` \| `denied` \| `expired`),
`createdAt`, `requestExpiresAt` (`createdAt` + 7 days), `decidedBy`,
`decidedAt`, `resetId` (on `approved`), `version`. An **open** request
whose `requestExpiresAt` has passed reads as expired: the first read that
sees it moves it `open → expired` with a conditional write, deletes its
claim and notifies the requester once (the condition makes it once). Every
status change rewrites `gsi1sk` with the new status. Item expiry (90 days)
is not the request expiry (7 days): the decided request stays readable as
long as the notifications that point at it.

**OpenResetRequestClaim** — `requestId`, `requestExpiresAt`. Created in the
same `TransactWriteItems` as the request with
`attribute_not_exists(PK) OR requestExpiresAt < :now` (a stale claim of an
expired request does not block a new one); deleted when the request is
approved, denied or expired. A second open request fails the condition →
`409 CONFLICT`.

**BudgetReset** (MG-D8) — `resetId` (UUID), `oid` (the member), `teamId`,
`departmentId`, `litellmTeamId`, `litellmUserId`, `operation` (`spend` \|
`budget`), `amount` (USD ≥ 0, the member's membership spend read from
`getTeam` just before the reset), `budget` (the member's `max_budget_in_team`
at that time, USD, or `null` when unset), `trigger` (`direct` \| `request`;
set by the server from the route, never from the client; a bulk reset is a UI
convenience over direct resets and is recorded as `direct` — MG-D8 amended
2026-11-18, coordinator decision), `actorOid`, `requestId` (the budget reset request for
`trigger: "request"`, else the HTTP request id), `timestamp`. Append-only:
the `Put` carries `attribute_not_exists(SK)`; it is written in the same
transaction as the audit record, after LiteLLM confirmed; no update, no
delete except TTL.

*Amended 2026-11-19 (unit RS2, D-RS8; LiteLLM spec LD39).* The ledger is a
**discriminated union on `scope`**: `member` (a `resetMemberSpend`, as above,
`operation` `spend` or `budget`) or `user` (a `resetUserSpend`, the user's
spend across all of LiteLLM; `litellmTeamId` absent, `operation` `spend`).
`oid`, `teamId` and `departmentId` are present **only where they exist**: a
reset of a LiteLLM user with no app identity has no `oid`, and a reset on a
LiteLLM team not linked to an app team has no `teamId` or `departmentId`.
Agent decision (Rule 00.3): the key needs two new PK forms, both under the
`BRESET#` prefix, because a reset without an app team has no `teamId` to key on
and the LiteLLM id is the stable target id (`BRESET#LTEAM#{litellmTeamId}` for
a member reset on an unlinked team, `BRESET#LUSER#{litellmUserId}` for scope
`user`); the `BRESET#TEAM#{teamId}` form is unchanged. GSI1 `BRESETS#IDENT#{oid}`
is written only when an `oid` exists. The task role's `PutItem` condition is
`LeadingKeys BRESET#*`, which already covers the new forms, so `infra/` and its
test need no change. The pre-RS2 `oid`, `teamId` and `departmentId` fields
were required (superseded 2026-11-19, RS2: a reset by LiteLLM id may have
neither); existing items are all `scope: "member"` with all three, and the
reader treats an item with no `scope` as `member`. For `scope: "user"`, `amount` is the user's total spend across all of LiteLLM from `getUser` just before the reset, and `budget` is the user's `max_budget` from `getUser`, or `null` when LiteLLM reports none (coordinator decision, 2026-11-24, RS2 review round 2: the code records the user's max_budget).

**Notification** (MG-D13) — `notificationId` (UUID), `recipientOid`,
`kind` (`budget-reset.requested` \| `budget-reset.approved` \|
`budget-reset.denied` \| `budget-reset.expired`), `requestId`, `teamId`,
`createdAt`, `readAt` (absent until read). It holds no name, email, reason
or amount: the list route joins the request and shows its details only to a
caller who may still read it (Access Control BR8). The API id is the item's
`SK` value (`{createdAt}#{notificationId}`), so a mark-read is a `GetItem`/
`UpdateItem` on `PK = NOTIF#{session oid}` and can never reach another
person's partition. The kind list is open for L7 (key requests) to append
its own kinds; nothing in slice A is key-specific.

### Access patterns (unit M4)

| Pattern | Operation |
|---|---|
| Create a request | `TransactWriteItems`: `Put` request (`attribute_not_exists(PK)`), `Put` claim (condition above), audit `Put` (`budgetreset.request.create`); then the notifications `BatchWriteItem` (a failure is thrown, not swallowed; the request stands and stays listed on the Team page) |
| A team's requests (Team page; deciders) | `Query GSI1 gsi1pk = BRREQS#TEAM#{teamId}`, `begins_with(gsi1sk, "open#")` for the open list, newest first; paginated on `LastEvaluatedKey` (Rule 20.6) |
| The caller's own requests (*My usage*) | `GetItem` the claim `BRREQOPEN#{memberTeamId}#{oid}` for the open one, then `GetItem` the request; recent decided ones: `Query GSI1 BRREQS#TEAM#{memberTeamId}` with `FilterExpression requesterOid = :oid`, at most 10, paginated |
| Decide (approve / deny) | `GetItem BRREQ#{id}`; `UpdateItem` `status = open → approving` (approve) or `open → denied` (deny) with `ConditionExpression status = :open AND version = :v`; approve then ends with one `TransactWriteItems`: ledger `Put`, request `approving → approved`, claim `Delete`, two audit `Put`s; on a LiteLLM failure `UpdateItem approving → open` |
| A person's notifications | `Query PK = NOTIF#{oid}`, `ScanIndexForward: false`, `Limit` 20, opaque signed cursor (Access Control — *Storage boundary* item 4) |
| Unread count | `Query PK = NOTIF#{oid}`, `FilterExpression attribute_not_exists(readAt)`, `Select: COUNT`, paginated; the bell shows `99+` above 99 |
| Mark read | `UpdateItem PK = NOTIF#{session oid}, SK = {id}` `SET readAt` with `attribute_exists(PK)` (a foreign or missing id changes nothing and is not an error per id); "all" pages the unread items and updates each |
| Reset counts (slice B) | Per team: `Query PK = BRESET#TEAM#{teamId}`, `SK BETWEEN {from}T00:00:00.000Z AND {to}T23:59:59.999Z~`; per person: `Query GSI1 BRESETS#IDENT#{oid}` with the same bound; both paginated; filtered by scope after the read, never cached (Rule 60.10). *Unit RS2, 2026-11-19:* a reset with no `oid` (an unlinked LiteLLM user) has no GSI1 item and counts for nobody; a reset on an unlinked LiteLLM team sits under `BRESET#LTEAM#…` and counts for no app team, so the per-team counts and the per-person counts are unchanged by it |

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
| `CreateAccountRequestSchema` | From 2026-11-23 (unit ST1, D-ST5) the `POST /api/accounts` body: strict, `accountId`, `accountName`, `region`, `departmentName`, `teamName`, no `departmentId`/`teamId`; the route generates the ids and passes a `CreateAccountInputSchema` value to the data function (supersedes the row above as the HTTP body, 2026-11-23) |
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
| `/api/accounts` | POST | `CreateAccountRequestSchema` (from 2026-11-23; `CreateAccountInputSchema` before, still the data function's input) | Settings CRUD (`Admin`); from 2026-11-23 (unit ST1, D-ST5; user, 2026-11-18) the server generates `departmentId` and `teamId` (a slug of the name, made unique: `dept-<slug>` / `team-<slug>`, then `-2`, `-3`…; a team id never takes the `appteam-` prefix; agent decision, 2026-11-23, reason: readable ids that cannot collide with created app teams) from `departmentName` and `teamName`, or reuses an existing one; **reuse rule (coordinator decision, 2026-11-24, review round 1; reason: two departments' teams must not merge):** names are normalised `lower(trim())`; a `departmentId` is reused for the same normalised department name; a `teamId` is reused only for the same normalised team name **in the same department**, otherwise a new suffixed id is made; the create path reads the account list uncached (`getAllAccounts`, not the cached read), so a stale cache cannot give two names one id (R2); the body is **strict**, so a `departmentId` or `teamId` field is `400` (agent decision, 2026-11-23, reason: Zod `.strict()` matches "validate at the boundary", Rule 60.16, and fails loudly instead of ignoring a client-chosen id); `accountId` stays a typed 12-digit AWS account number; from 2026-11-17 a `teamName` equal to a created team's name is `409` (*Entity: AppTeam*) |
| `/api/accounts/[id]` | PATCH | `UpdateAccountPatchSchema` | Settings CRUD (`Admin`); from 2026-11-17 a `teamName` equal to a created team's name is `409` (*Entity: AppTeam*); from 2026-11-24 (unit ST1, coordinator ruling) Edit account sends the ids picked from existing departments and teams, the team limited to the picked department. **Accepted limit:** the server does not check that a sent `departmentId`/`teamId` exists or belongs together — the route is admin-only and the UI keeps the ids consistent; a server-side existence and consistency check is future work (`docs/future-improvements.md` — *Validate picked account ids on PATCH*) |
| `/api/accounts/[id]` | DELETE | — | Soft-deactivate (`active: false`; `Admin`) |
| `/api/identities/directory` | GET | `DirectoryQuerySchema`: `cursor`, `include`, `q`; from 2026-11-24 (unit US1) `sort` (`name`, `email`, `createdAt`, `lastSignInAt`, `team`) and `dir` (`asc`, `desc`) | GSI1 `IDENTS`, at most 2,000 identities, sorted in memory with a tie-break on `oid`, 25 a page; `truncated` when over the bound; the cursor carries the sort, so another sort's cursor is `400` (Access Control — *API routes*) |
| `/api/teams` | POST | `{ name, departmentId }` (management improvements D5, D6, 2026-11-17) | Create an `AppTeam` (`internal-admin`, `internal-org-admin`; Access Control — *Created app teams*); `201`, audited, revalidates the team-list tags |
| `/api/budget-reset-requests` | POST | `CreateBudgetResetRequestInputSchema` (`{ reason? }`; the team is the caller's member team, never a body field) | Create a request for the caller's own member budget (unit M4; Access Control — *Permission matrix*): `201 { data: BudgetResetRequestView }`; no member team → `403` before parsing; team not linked → `409 CONFLICT`; `requestBudgetReset` or `resetMemberSpend` off → `403 OPERATION_DISABLED`; an open request exists → `409 CONFLICT`. Notifies the deciders (MG-D13) |
| `/api/budget-reset-requests` | GET | `BudgetResetRequestListQuerySchema` (`teamId`, `status` = `open` \| `all`, default `open`; `cursor`) | A team's requests for a Lead in scope, org-admin, Admin and Auditor (read-only); out-of-scope and missing teams the same `404`; `{ data: { items: BudgetResetRequestView[], cursor? } }`. Requester names follow the management-list rule (D37); in `prod` before the per-user approval only the team's deciders see the requester's name, email and reason, and the Auditor sees counts only (LiteLLM spec MG-D12, amended 2026-11-18, Q-W2) |
| `/api/budget-reset-requests/mine` | GET | — | Any signed-in role, own data only: `{ data: MyBudgetResetRequestsSchema }` — `eligibility` (`{ canRequest, reason }`, `reason` ∈ `no-team`, `not-linked`, `disabled`, `open-request`, `null`), `open` (a view or `null`), `recent[]` (≤ 10) |
| `/api/budget-reset-requests/[id]/approve` | POST | path `id` (UUID); no body | Lead in scope, org-admin, Admin (the `member` matrix write), never the requester (`403`); out-of-scope and missing the same `404`; not `open` → `409 CONFLICT`; runs `resetMemberSpend` and writes the ledger (MG-D11, MG-D12a): `200 { data: { request: BudgetResetRequestView, resetId, amount } }`; LiteLLM failure → its error code, request open again |
| `/api/budget-reset-requests/[id]/deny` | POST | path `id`; no body | As approve; `open → denied`, no LiteLLM call: `200 { data: { request: BudgetResetRequestView } }` |
| `/api/notifications` | GET | `NotificationListQuerySchema` (`cursor`) | Any signed-in role, own notifications only: `{ data: { items: NotificationView[], unreadCount, cursor? } }`; each `budget-reset.requested` item embeds the request view and `canDecide` only while the caller may still read and decide it (re-checked per request) |
| `/api/notifications/read` | POST | `MarkNotificationsReadInputSchema` (`{ ids: string[1..50] }` or `{ all: true }`) | Own notifications only (keys from the session): `200 { data: { updated } }`; not audited (own state) |
| `/api/budget-resets` | GET | `BudgetResetCountsQuerySchema` (`DateRangeQuerySchema` + optional `teamId`) | Slice B (MG-D10): `{ data: { teams: [{ teamId, count, amount, members?: [{ oid, count, amount }] }], own: { count, amount } } }`, scoped per role; `members` only when per-user data is allowed |
| `/api/litellm/users/[litellmUserId]/reset-spend`, `/api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-spend`, `/reset-budget` | POST | path ids only (Zod); no body | Unit RS2, 2026-11-19 (LiteLLM spec LD39; roles per Access Control — *Permission matrix*): each writes one audit record (`litellm.user.reset-spend` with the spend before and after, or `litellm.member.reset-spend` / `litellm.member.reset-budget`) and one `BudgetReset` ledger item (scope `user` or `member`; no `oid`, `teamId` or `departmentId` when none exists) in one transaction after LiteLLM confirmed |
| `/api/litellm/proxy-teams/[litellmTeamId]/members` | GET | path id (Zod) | RS2: the LiteLLM team's members with email, spend, budget and the linked app person or `null`; at most 200 members |

The access-control routes (`/api/health`, `/api/me`, members, admins, moves, role grants, group mappings, visibility, identities, password users, the password sign-in switch, the per-user approval, audit, access review) and their permissions are listed in [Access Control spec](2026-11-10-access-control.md) — *API routes*. The budget reset and notification routes above (unit M4) follow Rule 10.3, set `Cache-Control: private, no-store`, register in `test/route-registry.ts`, and are never cached (Rule 60.10). The LiteLLM routes (`/api/litellm/**`, `/api/finance/statement`) and the error codes `OPERATION_DISABLED` (403), `OPERATION_UNAVAILABLE` (403), `LITELLM_UNAVAILABLE` (503) and `PRIVILEGED_TARGET` (409) are in the [LiteLLM spec](2026-11-10-litellm.md) — *API routes*. `Admin` above reads `internal-admin` from Phase 4R.

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

DailyRollup items expire 365 days after they were last updated (`expiresAt = lastUpdatedAt + 365 days`, the table's TTL attribute; decided 2026-11-10, attribute renamed 2026-11-17) via DynamoDB TTL. This is configurable per deployment. For longer retention, items can be archived to S3 before expiry. *Amended 2026-11-17 (unit CFG):* the per-deployment value is `data.retention.dailyRollupDays` in `config.yaml` (default 365; [System Architecture](2026-05-15-system-architecture.md) — *Configuration file*); the collector applies it from Phase 6. The seed scripts ignore the key and keep the 365-day default.

### Settings shadowed by the configuration file

*Added 2026-11-17 (unit CFG; System Architecture — *Configuration file*, user decision D1).* A value set in `apps/dashboard/config/config.yaml` **shadows** the stored item for the same setting: reads return the file's value as the effective value with source `file`, and the stored item is neither read for that setting's effect nor changed. A write to a shadowed setting returns `409` `CONFIG_FILE_LOCKED` and writes nothing, so the stored value survives and applies again once the key is removed from the file. In v1 the only shadowed item is `LITELLM#CONFIG` / `TOGGLES` (`OperationToggles`), per operation: only the operations the file sets are shadowed, and the item's `version` still advances only on an accepted write. No new entity or key is added; the precedence lives in one resolver per setting, so data-access functions keep trusting typed inputs (Rule 50.8).

### Service Attribution (`byService`)

**v1 source of truth:** CloudTrail Lake — the `service` name is derived from the **application inference profile** on each `InvokeModel` / `InvokeModelWithResponseStream` call (teams create one profile per service, tagged `service=<name>`). Token and invocation counts in `byService` come from CloudTrail; costs are proportional estimates (see System Architecture spec).

**Not used for `byService` in v1:** AWS Billing cost allocation tags in Cost Explorer. Those tags affect CE billing reports only and are not merged into the dashboard's `byService` map. A future enhancement could cross-check CE tags for validation.

### `_untagged` Bucket

Calls with no identifiable inference profile (or no `service` tag on the profile) are stored under `_untagged` in `byService`. **Direct `InvokeModel` calls** (model ID only, no inference profile) always count as `_untagged` for service; user attribution from CloudTrail still applies. The Settings page **tag coverage** metric (Phase 4.9b, deferred) is `1 − (untagged tokens / total tokens)` per team over the selected date range — it measures inference-profile discipline, not Cost Explorer tag activation.
