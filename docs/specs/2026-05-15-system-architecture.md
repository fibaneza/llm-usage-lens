# System Architecture Spec

**Status:** Draft
**Date:** 2026-05-15
**Scope:** AWS serverless architecture for Bedrock cost and usage data collection

---

## Overview

A serverless data pipeline that collects AWS Bedrock usage metrics and cost data across an organization with multiple AWS accounts, aggregates it hourly, and stores it in DynamoDB for consumption by a Next.js dashboard.

The collector runs in a dedicated **observability account** and reaches member accounts without per-account role assumption — CloudWatch metrics arrive via CloudWatch cross-account observability, and Bedrock API activity arrives via an organization-wide CloudTrail event data store.

## Organizational Hierarchy

```
Organization (all authenticated users see all data)
  └── Department (logical grouping, stored in DynamoDB account registry)
        └── Team (= 1 AWS member account)
              ├── Services (via tagged application inference profiles)
              └── Users   (IAM Identity Center SSO username from CloudTrail)
```

- A department contains **one or more teams**. Each team owns **exactly one** AWS member account.
- An AWS account therefore maps to exactly one team and exactly one department. This mapping lives in the DynamoDB account registry — department and team are always derivable from the account ID.
- Service-level attribution uses **application inference profiles**: a team creates one inference profile per service, tagged `service=<name>`. Calls routed through a profile are attributable to that service in CloudTrail Lake (the v1 source for `byService` in DynamoDB). Cost Explorer cost allocation tags are **not** used for dashboard service breakdown in v1.
- User-level attribution uses IAM Identity Center SSO usernames extracted from CloudTrail Lake.

## Authentication & Access

- **Dashboard users**: Auth.js (NextAuth v5) with Microsoft Entra ID as the identity provider. Open access — every authenticated member sees all data. Auth.js is the provider abstraction: switching identity providers is a config change in `auth.ts`, not an app change.
- **Next.js API routes**: Auth.js middleware protects both `/dashboard/*` and `/api/*`. Route Handlers additionally check the session to reject unauthenticated requests.
- **AWS account users**: AWS access (including Bedrock) is via IAM Identity Center — existing, unchanged, and separate from dashboard login. Bedrock access is **permission-gated** — a user can invoke Bedrock only if their permission set grants Bedrock permissions. Not every team member has access by default. Consequently the dashboard shows only users who have actually invoked Bedrock; CloudTrail records real invocations, so users with no usage never appear.
- **Lambda collector**: Dedicated IAM service role in the observability account, completely separate from SSO user roles.

## Account Layout

| Account | Role |
|---------|------|
| **Management account** | Hosts the organization CloudTrail and a single read-only Cost Explorer role. No workloads. |
| **Observability account** | Dedicated account (a Control Tower *Log Archive* account fits). Hosts the collector Lambda, DynamoDB, EventBridge, the CloudTrail Lake event data store, and is the CloudWatch cross-account observability **monitoring account**. |
| **Member accounts** | One per team. Linked as CloudWatch observability **source accounts**; Bedrock activity captured by the org CloudTrail. **No custom IAM roles deployed.** |

## Region

The collector operates in **`us-east-1` only**. Bedrock usage outside `us-east-1` is not collected. Multi-region collection is a documented future enhancement (the account registry's `region` field would become a list and the CloudWatch query would loop regions).

## Data Sources

The Lambda collector merges three AWS data sources per run:

| Source | What it provides | Cross-account method |
|--------|-----------------|----------------------|
| **AWS Cost Explorer** | Cost ($) per account and per model — exact. `GetCostAndUsage` grouped by `LINKED_ACCOUNT` and `USAGE_TYPE` (Bedrock usage types encode the model). | Collector assumes a single read-only role in the management account. |
| **Amazon CloudWatch** | Bedrock metrics: InputTokenCount, OutputTokenCount, Invocations, InvocationLatency per ModelId. | CloudWatch cross-account observability — the monitoring account queries all linked source accounts directly. **No role assumption.** |
| **CloudTrail Lake** | Per-user and per-service Bedrock API calls — SSO username from `userIdentity`, service from the application inference profile in the request, grouped by model. | Org-wide event data store, queried locally in the observability account (CloudTrail delegated administrator). |

## Architecture Diagram

```
AWS Organization
│
├── Management Account
│     ├── Organization CloudTrail (org-wide trail → CloudTrail Lake event data store)
│     └── CostExplorerReadRole  ← assumed by the collector (Cost Explorer only)
│
├── Observability Account  (dedicated; e.g. Control Tower Log Archive)
│     ├── CloudTrail Lake — org event data store (CloudTrail delegated administrator)
│     ├── CloudWatch cross-account observability — MONITORING account
│     ├── DynamoDB table: bedrock-usage
│     ├── EventBridge Rule (cron: every 1 hour)
│     └── Lambda: bedrock-cost-collector (BedrockCollectorLambdaRole)
│           │
│           ├── Cost Explorer (assume CostExplorerReadRole in management account)
│           │     └── GetCostAndUsage
│           │           ├── Filter: Service = AmazonBedrock
│           │           └── GroupBy: [LINKED_ACCOUNT, USAGE_TYPE]
│           │                 → per-account + per-model cost (exact)
│           │
│           ├── CloudTrail Lake (local — org event data store)
│           │     └── StartQuery → poll GetQueryResults (async SQL)
│           │           └── Bedrock calls grouped by account, SSO username,
│           │               inference profile (service), model
│           │
│           ├── CloudWatch GetMetricData (cross-account observability)
│           │     └── Account-scoped queries for all source accounts in one call
│           │           ├── InputTokenCount per ModelId
│           │           ├── OutputTokenCount per ModelId
│           │           ├── Invocations per ModelId
│           │           └── InvocationLatency per ModelId
│           │
│           └── Merge all three → write DailyRollup to DynamoDB (BatchWriteItem)
│                 ├── Today's rollup (tokens exact, cost estimated)
│                 └── Yesterday's rollup (tokens exact, cost finalized)
│
└── Member Accounts (one per team)
      ├── CloudWatch metrics → linked as observability SOURCE accounts
      └── Bedrock API calls → captured by the organization CloudTrail
      (no custom IAM roles deployed)

Next.js App (local dev / future deployment)
  └── Route Handlers → DynamoDB via AWS SDK, protected by Auth.js middleware
```

## Lambda Collector Flow

Each hourly run performs these steps:

1. Read the account registry from DynamoDB (all `AccountMeta` items with `active: true`). Only registered accounts receive rollups. Member accounts with Bedrock usage but **no** registry entry are ignored until an admin adds them in Settings. Registry accounts with no data for a day are **skipped** (no empty rollup item).
2. Assume `CostExplorerReadRole` in the management account and query **Cost Explorer**:
   - `GetCostAndUsage` for yesterday (finalized) and today (partial).
   - Filtered to `AmazonBedrock` service.
   - Grouped by `LINKED_ACCOUNT` and `USAGE_TYPE`. Usage types are parsed to extract the model — this yields exact per-account and per-model cost.
3. Query **CloudTrail Lake** locally (org-wide event data store):
   - `StartQuery` (SQL), then poll `GetQueryResults` until the query completes (async).
   - Bedrock `InvokeModel`/`InvokeModelWithResponseStream` calls grouped by account, SSO username, application inference profile (→ service), and model ID.
   - Time range: yesterday + today.
4. Query **CloudWatch** via cross-account observability:
   - `GetMetricData` with account-scoped queries covering all linked source accounts — issued from the monitoring account, no role assumption.
   - Per `ModelId` dimension: InputTokenCount, OutputTokenCount, Invocations, InvocationLatency.
   - Time range: yesterday + today.
5. Normalize raw Bedrock model IDs to canonical keys (see Data Model spec — Model ID Normalization), then merge all three data sources per account per day (see **Three-source merge rules** below). Per-user and per-service costs are proportional estimates.
6. Write/overwrite DailyRollup items to DynamoDB using `BatchWriteItem` (25 items/batch) — yesterday = finalized, today = estimated (see Today's cost fallback below when Cost Explorer returns zero for today).
7. Update the SyncStatus item (`lastRunAt`, `nextScheduledAt` = next hour boundary, status, counts, errors).

### Two-Day Refresh Strategy

All date bucketing uses **UTC**. "Today" and "yesterday" are UTC calendar days, matching the native time zones of Cost Explorer and CloudWatch. The dashboard labels date ranges as UTC.

Cost Explorer data lags 8-24 hours. Each Lambda run refreshes two days:

| Target day | Cost data | Token/invocation data | costFinalized flag |
|---|---|---|---|
| Yesterday | Complete (Cost Explorer caught up) | Complete (CloudWatch + CloudTrail) | `true` |
| Today | Partial or zero | Complete up to current hour | `false` |

The dashboard shows a subtle indicator on today's data: "Cost data finalizes within 24h."

### Per-User and Per-Service Cost Estimation

CloudTrail Lake provides per-user and per-service invocations and token counts (exact). Cost Explorer provides per-account and per-model cost (exact). Per-user and per-service cost are proportional estimates:

```
userCost = (userTokensForModel / cloudWatchModelTokens) × accountModelCost
```

`cloudWatchModelTokens` is the CloudWatch token total for that model on that account-day (see **Three-source merge rules** — do not use CloudTrail sums as the denominator). The same ratio formula applies to per-service cost. All per-user and per-service cost values carry a `costEstimated: true` flag. Only account-level and model-level costs from Cost Explorer are exact.

## IAM Architecture

### Lambda Execution Role (Observability Account)

**Role name:** `BedrockCollectorLambdaRole`

Permissions:
- `cloudwatch:GetMetricData`, `cloudwatch:ListMetrics` — cross-account observability queries (the observability account is the monitoring account)
- `cloudtrail:StartQuery`, `cloudtrail:GetQueryResults` — local CloudTrail Lake queries
- `bedrock:ListTagsForResource` (and/or `tag:GetResources` if using Resource Groups Tagging API) — resolve `service=<name>` on inference profile ARNs when tags are not present on CloudTrail events; validate required APIs against a sample event in Phase 6
- `sts:AssumeRole` on `arn:aws:iam::{managementAccountId}:role/CostExplorerReadRole`
- `dynamodb:PutItem`, `dynamodb:BatchWriteItem`, `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:Scan` on the `bedrock-usage` table
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` — CloudWatch Logs

### Cost Explorer Role (Management Account)

**Role name:** `CostExplorerReadRole`

Permissions:
- `ce:GetCostAndUsage`

Trust policy:
- Allows `arn:aws:iam::{observabilityAccountId}:role/BedrockCollectorLambdaRole`

This is the **only** cross-account role assumption in the design — a single hop, independent of the number of member accounts.

### Member Accounts

**No custom IAM roles are deployed to member accounts.** Member accounts participate as CloudWatch observability source accounts and send Bedrock activity to the organization CloudTrail. Both are configured at the organization level.

## Deployment / Setup

| Item | Setup |
|------|-------|
| **CloudWatch cross-account observability** | Observability account configured as the monitoring account. Source links enabled organization-wide via the AWS Organizations integration, so current and future member accounts link automatically. |
| **CloudTrail** | Organization trail in the management account. CloudTrail delegated administrator set to the observability account so the CloudTrail Lake event data store can be queried locally. |
| **`CostExplorerReadRole`** | Single CloudFormation stack in the management account (not a StackSet — one account only). |
| **Application inference profiles** | Teams create one tagged inference profile per service (`service=<name>`). Operational responsibility of each team. |

When a new team account joins the organization, it auto-links for CloudWatch observability and is covered by the org CloudTrail — no per-account deployment step.

## AWS Services Summary

| Service | Role | Account | Runtime/Setup |
|---|---|---|---|
| **AWS Organizations** | Multi-account structure | Management | Existing |
| **IAM Identity Center** | User SSO login (existing, no changes) | Management | Existing |
| **Organization CloudTrail** | Org-wide Bedrock API activity capture | Management | Setup |
| **CloudTrail Lake** | Org event data store, user/service attribution SQL queries | Observability | Runtime |
| **CloudWatch cross-account observability** | Cross-account metric access without role assumption | Observability (monitoring) + members (source) | Setup |
| **Amazon EventBridge** | Hourly cron trigger | Observability | Runtime |
| **AWS Lambda** | `bedrock-cost-collector` | Observability | Runtime |
| **AWS Cost Explorer** | Cost data per account and per model | Management (via assumed role) | Runtime |
| **Amazon CloudWatch** | Bedrock metrics (tokens, invocations, latency per model) | Each member (source) | Runtime |
| **Amazon DynamoDB** | Single table: rollups, account registry, sync status | Observability | Runtime |
| **AWS STS** | Single cross-account hop for Cost Explorer | Observability → Management | Runtime |
| **AWS IAM** | Collector role + Cost Explorer role | Observability + Management | Setup |
| **AWS CloudFormation** | `CostExplorerReadRole` stack (plain CFN) | Management | Setup (one-time) |
| **AWS SAM** | `bedrock-cost-collector` stack — Lambda, EventBridge rule, IAM role, alarm, DynamoDB table | Observability | CD (see Infrastructure as Code) |

## Future / Optional Services

| Service | Use | Status |
|---|---|---|
| **Amazon S3** | Archive `DailyRollup` items past the 365-day TTL; optional Cost & Usage Report / Data Exports delivery | Optional, not in v1 |
| **Amazon Athena** | Ad-hoc analytical queries over archived rollups (DynamoDB → S3 → Athena) | Future |

Not used: **Amazon Security Lake** — a security-operations data lake in OCSF format; overkill for a cost/usage dashboard, and CloudTrail Lake is the direct fit. **AWS Control Tower** is contextual governance, not a project dependency — if the organization runs it, the observability account is its existing *Log Archive* account.

## Lambda Configuration

- **Runtime:** Node.js 22.x
- **Timeout:** 5 minutes (CloudTrail Lake SQL polling plus CloudWatch and Cost Explorer queries can take 2-3 minutes for large orgs)
- **Memory:** 512 MB (sufficient for in-memory merge of all account data)
- **Concurrency:** Reserved concurrency 1 (single instance, no parallel invocations needed — hourly cron)

## Infrastructure as Code

Two IaC artifacts, both deployed through the CloudFormation control plane to different accounts:

| Stack | Tool | Account | Resources |
|-------|------|---------|-----------|
| `cost-explorer-read-role` | Plain CloudFormation (YAML) | Management | `CostExplorerReadRole` only — trust policy to `BedrockCollectorLambdaRole` |
| `bedrock-cost-collector` | AWS SAM (`apps/collector/template.yaml`) | Observability | Lambda function, execution role, log group, EventBridge hourly rule, CloudWatch failure alarm, `bedrock-usage` DynamoDB table |

**Why SAM for the collector.** The collector is a pure serverless workload — `AWS::Serverless::Function` collapses the function, its IAM role, log group, and the EventBridge schedule into one resource with an inline `Events:` block. `sam build` bundles the TypeScript; `sam local invoke` exercises the handler against DynamoDB Local before deploy. A SAM template *is* a CloudFormation template (the `Serverless` transform), so it deploys through the same control plane as the plain-CFN role stack — one paradigm, no second IaC tool.

**Why plain CFN for `CostExplorerReadRole`.** A single IAM role in a different account, deployed once. The SAM transform adds nothing — keep it a minimal standalone template.

**DynamoDB table ownership.** The production `bedrock-usage` table is defined in the SAM template (`AWS::DynamoDB::Table`) and owned by the collector stack — PK/SK + GSI1, TTL on `DailyRollup`. `scripts/create-table.ts` is **DynamoDB-Local-only** and never touches AWS. The SAM template is the source of truth for the production schema; the two must be kept in sync by hand.

**Monorepo bundling.** The collector imports `@bedrock-usage/shared` as a `workspace:*` dependency, which cannot be resolved at Lambda runtime. SAM's `BuildMethod: esbuild` must inline the shared package into the artifact — configure `esbuild` with the shared package source on its resolve path, or run `pnpm --filter collector deploy` to produce a flattened `node_modules` before `sam build`. Verify the built bundle contains the shared code in Phase 6.

**Credentials.** Both stacks deploy from GitHub Actions using an OIDC-assumed IAM role — no static AWS keys in CI, consistent with the AWS SDK default credential chain rule. The deploy role itself is created once during one-time setup.

## Known Limitations

1. **Single region**: Only `us-east-1` Bedrock usage is collected. Usage in other regions is not captured.
2. **Cost Explorer lag**: Cost data is 8-24h behind. Today's cost is estimated from token counts and model pricing. Yesterday's cost is finalized.
3. **Per-user/per-service cost is approximate**: Calculated proportionally from token usage ratio. Only account-level and model-level cost from Cost Explorer is exact.
4. **Service tagging dependency**: `byService` data quality depends on teams routing calls through tagged **application inference profiles** (`service=<name>`). Usage not routed through a tagged profile falls into the `_untagged` bucket. Billing cost allocation tags in the AWS console do not populate `byService` in v1.
5. **CloudTrail Lake query cost**: CloudTrail Lake charges per query scan. At high Bedrock call volumes, this cost should be monitored.
6. **Cost Explorer API cost**: Each `GetCostAndUsage` call costs $0.01. Cost Explorer is queried once per day per run (yesterday + today) — 2 calls per hourly run, roughly $1.50/month regardless of the number of accounts.
7. **Lambda overrun**: With reserved concurrency of 1 and an hourly trigger, a run exceeding 60 minutes would collide with the next invocation. The 5-minute timeout makes this effectively impossible, but EventBridge invocation failures are surfaced via a CloudWatch alarm.

---

## Collector Appendices

### Cost Explorer `USAGE_TYPE` → model (parsing)

`GetCostAndUsage` is grouped by `USAGE_TYPE`. Bedrock usage types embed the model family. Parse with prefix rules (align with `packages/shared/src/models.ts`):

| Usage type pattern (examples) | Canonical key |
|-------------------------------|---------------|
| `*ClaudeOpus*`, `*claude-opus*` | `claude-opus` |
| `*ClaudeSonnet*`, `*claude-sonnet*`, `*Claude3-5-Sonnet*` | `claude-sonnet` |
| `*ClaudeHaiku*`, `*claude-haiku*`, `*Claude3-5-Haiku*` | `claude-haiku` |
| Anything else for `AmazonBedrock` | `other` |

Log unrecognized usage types to CloudWatch Logs so operators can extend the mapping. Costs without a parseable model roll into account-level totals and `other` as appropriate.

### CloudTrail Lake — sample query (illustrative)

Event data store holds org-wide management events. Filter Bedrock invocations for yesterday + today (UTC), then aggregate in SQL or post-process `GetQueryResults` rows:

```sql
SELECT
  recipientAccountId AS accountId,
  userIdentity.userName AS ssoUsername,
  COALESCE(
    requestParameters.inferenceProfileArn,
    requestParameters.modelId
  ) AS profileOrModel,
  requestParameters.modelId AS modelId,
  COUNT(*) AS invocations
FROM {event_data_store_id}
WHERE eventSource = 'bedrock.amazonaws.com'
  AND eventName IN ('InvokeModel', 'InvokeModelWithResponseStream')
  AND eventTime BETWEEN '{yesterdayStart}' AND '{todayEnd}'
GROUP BY 1, 2, 3, 4
```

**Service name extraction (application code, not SQL):** resolve `inferenceProfileArn` → resource tags (`service=<name>`). If missing, use `_untagged`. Map `modelId` through shared normalization.

**SSO username:** use `userIdentity.type = 'AssumedRole'` session issuer / `userName` per org CloudTrail field layout; validate against a sample event in your org during Phase 6.

**Tokens:** the sample query counts invocations only. Phase 6 must also extract `inputTokenCount` / `outputTokenCount` from event fields (or aggregate from CloudWatch for totals and CloudTrail for attribution splits) — confirm field names on a real `InvokeModel` event.

### Today's cost fallback

When Cost Explorer returns **zero or no rows** for today's UTC day (common due to 8–24h lag):

1. Use **CloudWatch token counts** per model for today (exact).
2. Estimate model cost: `(modelInputTokens × inputPricePer1K + modelOutputTokens × outputPricePer1K) / 1000` using a **static price table** in `packages/shared` (updated manually when AWS publishes new list prices).
3. Set `costFinalized: false` and `costEstimated: true` at model and account level for today.
4. When yesterday's CE data arrives, overwrite with exact costs (`costFinalized: true`).

Yesterday's rollup must **never** use token-based pricing if Cost Explorer returned data for that day.

### Three-source merge rules

When CloudWatch, CloudTrail, and Cost Explorer disagree, use this precedence for v1:

| Field | Source of truth |
|-------|-----------------|
| Account/model **cost** (yesterday) | Cost Explorer when rows exist; never token-priced; set `costEstimated: false` on model entries |
| Account/model **cost** (today) | Cost Explorer when rows exist; else token-based estimate (Today's cost fallback); `costFinalized: false`, `costEstimated: true` when token-priced |
| Account/model **tokens & invocations** (totals) | **CloudWatch** — authoritative for rollup-level metrics |
| `byUser` / `byService` token & invocation counts | **CloudTrail Lake** — only source with attribution |
| Per-user / per-service **cost** | Proportional split: `(entity tokens for model ÷ CloudWatch model tokens) × model cost` |

CloudTrail user/service token sums may not equal CloudWatch model totals (sampling, timing, or untracked calls). Do not rebalance CloudWatch totals to match CloudTrail; keep breakdowns as recorded and accept small drift.

### Inference profile tag resolution

Resolve `inferenceProfileArn` → service name in application code:

1. Prefer **tags on the CloudTrail event** if `service` is already present in `requestParameters` or resource tags in the event payload.
2. Else call **`bedrock:ListTagsForResource`** on the profile ARN (add to Lambda role; may require resource-based policies on member accounts for cross-account ARNs — validate in Phase 6).
3. Else derive from profile **name/ARN convention** only if your org standardizes names (document the convention in Settings onboarding).
4. If none apply → `_untagged`.

Direct `InvokeModel` / `InvokeModelWithResponseStream` without an inference profile → `_untagged` for service; SSO user still attributed when present in `userIdentity`.

### Shared code layout (monorepo)

The Next.js app and Lambda collector share schemas and model normalization without copy-paste:

```
/
├── apps/
│   ├── dashboard/              # Next.js (Phases 1–5)
│   │   ├── app/                # App Router pages + app/api/* Route Handlers
│   │   └── lib/
│   │       ├── data/           # server-only DynamoDB access
│   │       └── dynamodb.ts
│   └── collector/              # Lambda bedrock-cost-collector (Phase 6)
├── packages/
│   └── shared/                 # Zod schemas, models.ts, price table
│       ├── src/models.ts
│       ├── src/schemas/
│       └── package.json
├── scripts/                    # create-table, seed-* (run from repo root via pnpm)
├── docker-compose.yml          # DynamoDB Local
├── pnpm-workspace.yaml
└── ...
```

Both apps depend on `@bedrock-usage/shared` (workspace package). Phase 1 scaffolds the workspace; Phase 3 implements schemas in `packages/shared`; Phase 6 imports the same package in the collector bundle.
