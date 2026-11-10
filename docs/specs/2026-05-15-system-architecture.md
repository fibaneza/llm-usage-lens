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
Organization (access is role-based and scope-limited — Access Control spec)
  └── Department (logical grouping, stored in DynamoDB account registry)
        └── Team (= 1 AWS member account)
              ├── Services (via tagged application inference profiles)
              └── Users   (IAM Identity Center SSO username from CloudTrail)
```

- A department contains **one or more teams**. Each team owns **exactly one** AWS member account.
- An AWS account therefore maps to exactly one team and exactly one department. This mapping lives in the DynamoDB account registry — department and team are always derivable from the account ID.
- Service-level attribution uses **application inference profiles**: a team creates one inference profile per service, tagged `service=<name>`. Calls routed through a profile are attributable to that service in CloudTrail Lake (the v1 source for `byService` in DynamoDB). Cost Explorer cost allocation tags are **not** used for dashboard service breakdown in v1.
- User-level attribution uses IAM Identity Center SSO usernames extracted from CloudTrail Lake, canonicalised to the lower-cased email after the SSO prefix ([Access Control spec](2026-11-10-access-control.md) — *Canonical usage identity*; the dashboard applies it on read until Phase 6).

## Authentication & Access

- **Dashboard users**: Auth.js (NextAuth v5) with Microsoft Entra ID as the production identity provider (see *Sign-in providers* below). **Role-based, scope-limited access (decided 2026-11-10)** — global `internal-*` roles from Entra app roles, scoped `internal-team-admin`, explicit team membership, SSO group mapping, visibility with inheritance, and an audit log; defined in the [Access Control spec](2026-11-10-access-control.md), which supersedes v1's open read access. Auth.js is the provider abstraction: switching identity providers is a config change in `auth.ts` (and its variables in `env.ts`), not an app change.
- **Sign-in providers (decided 2026-10-29)**: Entra ID is optional *as a group* — the three `AUTH_MICROSOFT_ENTRA_ID_*` variables are all set or all unset. The issuer must be tenant-specific (`https://login.microsoftonline.com/<tenant GUID>/v2.0`, lowercase as Entra publishes it, since Auth.js compares the issuer exactly); the multi-tenant `common`, `organizations` and `consumers` issuers fail env validation, because an app role grants writes, and `auth.ts` repeats the issuer check at runtime with the other provider checks. Outside production a **dev-only local login** may be enabled with an explicit `AUTH_DEV_LOGIN=true` flag (only the value `"true"` enables it): an Auth.js Credentials provider that signs in a local identity without a password, for working without an Entra tenant. The sign-in page lists only the configured providers. **Fail closed:** with no provider configured, env validation fails in every environment. When `NODE_ENV === "production"`, at least one production provider (currently Entra ID) must be configured and `AUTH_DEV_LOGIN` must be unset (any non-empty value is rejected; an empty string counts as unset), otherwise env validation fails; `auth.ts` repeats the check at runtime so a skipped validation (`SKIP_ENV_VALIDATION`) never opens access — every sign-in and session request fails instead. Only `next build` skips the runtime check, and it never enables the dev login in production. Because `env.ts` owns these checks, switching providers changes `env.ts` alongside `auth.ts`. A production password login (Auth.js Credentials against a user store) is adopted only through an amendment to this section. **Amendment (2026-11-10):** the one adopted password login is the break-glass **master user** — a single username/password identity that is always `internal-admin`, with an Argon2id hash in SSM, TOTP in production, lockout and a 1-hour session ([Access Control spec](2026-11-10-access-control.md) — *Sign-in methods*). Local users for the dev-only login are in the same section, and from Phase 4R the dev-only login is rejected when Entra ID is configured (it no longer runs alongside it). Email magic links are not adopted.
- **Account-mutation role (decided 2026-10-29; amended 2026-11-10)**: *Amended by the [Access Control spec](2026-11-10-access-control.md): reads are scope-limited, the role value `Admin` becomes `internal-admin` (accepted as a legacy alias until enforcement), and session caps are 8 h / 4 h for global admin roles / 1 h for the master user. The 403-before-parsing order, the structural write-route test and the sign-in-time cap mechanics below still apply.* Originally: reading stays open to every authenticated member. Creating, editing and deactivating accounts (`POST /api/accounts`, `PATCH`/`DELETE /api/accounts/[id]`, and any Phase 4.9 Server Action) requires the **`Admin` app role**. With Entra ID this is an Entra *app role* (value `Admin`) defined on the app registration and assigned to users (or, on Entra ID P1/P2, groups) on its enterprise application; Entra emits it in the ID token's `roles` claim, which `auth.ts` Zod-parses (a missing or non-array claim means no roles; non-string entries are dropped) and copies into the JWT and `session.user.roles`. App roles are used rather than group claims because they need no group-ID mapping and are not subject to the group-overage limit. The dev-only local login signs in with `["Admin"]` so Settings can be exercised locally. Every write Route Handler (`POST`/`PUT`/`PATCH`/`DELETE`) under `/api`, except Auth.js's own `/api/auth/[...nextauth]` handler, requires `Admin` — today these are the account routes — and a structural test enumerates them so a new write route cannot ship ungated. A write route checks the role **after the session check and before input parsing or any DynamoDB call**, so a signed-in non-admin always gets `403 FORBIDDEN` (never `400`/`404`). Roles are read at sign-in, so removing `Admin` in Entra takes effect at the next sign-in. To bound that delay, a session ends **8 hours after sign-in regardless of activity**: the `jwt` callback records the sign-in time in the token and rejects the token once it is older than 8 hours, when it has no valid sign-in time (so sessions issued before this change end at deploy), or when its sign-in time is more than 60 seconds in the future (clock-skew allowance); Auth.js re-issues the JWT on every request, so `maxAge` alone is only an idle timeout (it is also 8 hours). Roles and the sign-in time change only at sign-in: the `jwt` callback never merges the `session` payload of an `update`. `auth.ts` maps the claim; the role name and the check live in `apps/dashboard/lib/auth/` (Rule 50.3).
- **Next.js API routes**: Auth.js in the Next.js proxy (`proxy.ts`) protects both `/dashboard/*` and `/api/*`, except `/api/health`, which the proxy matcher excludes (Platform spec — *Runtime*). Route Handlers additionally check the session to reject unauthenticated requests; every write route except Auth.js's own `/api/auth/[...nextauth]` handler (today the account routes) also checks the `Admin` role (`403`; see *Account-mutation role*).
- **AWS account users**: AWS access (including Bedrock) is via IAM Identity Center — existing, unchanged, and separate from dashboard login. Bedrock access is **permission-gated** — a user can invoke Bedrock only if their permission set grants Bedrock permissions. Not every team member has access by default. Consequently the dashboard shows only users who have actually invoked Bedrock; CloudTrail records real invocations, so users with no usage never appear.
- **Lambda collector**: Dedicated IAM service role in the observability account, completely separate from SSO user roles.

## LiteLLM Integration

*Added 2026-11-10 (unit L0); the [LiteLLM spec](2026-11-10-litellm.md) is authoritative.*

- **What:** the dashboard administers an **existing** LiteLLM proxy (teams, team members, users, keys, budgets, rate limits) and reads LiteLLM-reported spend. LiteLLM is never deployed, configured globally or hosted here (Platform spec — *Assumed to exist*).
- **Boundary:** only `apps/dashboard/lib/litellm/**` (`server-only`) and Route Handlers call LiteLLM, through a deny-by-default allowlist of typed operations with Zod-built bodies; the browser never talks to LiteLLM (Rule 10).
- **Credential:** a scoped **service key** (a key owned by a dedicated service user, limited by `allowed_routes` to exactly the allowlist), never the master key. It lives in the hand-managed SSM `SecureString` `/llm-usage-lens/<env>/litellm/service-key` (project CMK) and reaches the container only through the task definition's `secrets` at task start (the execution role reads it); application code never calls SSM, and the value never appears in responses, logs, telemetry, DynamoDB or the audit log. Rotation: [LiteLLM runbook](../guides/litellm-admin.md).
- **Connection:** an Admin-set `https` base URL that must match the deploy-time `LITELLM_ALLOWED_HOSTS` (prevents SSRF and key exfiltration); reached over the existing internal network.
- **Edition:** `oss` in `dev`, `enterprise` in `prod`, derived from `APP_ENV`; Enterprise-only operations are gated.
- **Cost provenance:** LiteLLM spend is LiteLLM's own price calculation, labelled "LiteLLM-reported" and never presented as Cost Explorer cost; combined totals exclude the gateway principals' Bedrock usage so LiteLLM-to-Bedrock traffic counts once.

## Account Layout

| Account | Role |
|---------|------|
| **Management account** | Hosts the organization CloudTrail and a single read-only Cost Explorer role. No workloads. |
| **Observability account** | Dedicated account (a Control Tower *Log Archive* account fits). Hosts the collector Lambda, DynamoDB, EventBridge, the CloudTrail Lake event data store, and is the CloudWatch cross-account observability **monitoring account**. |
| **Member accounts** | One per team. Linked as CloudWatch observability **source accounts**; Bedrock activity captured by the org CloudTrail. **No custom IAM roles deployed.** |

## Region

The collector operates in **`ap-southeast-2` (Sydney) only** (decided 2026-11-10; previously `us-east-1`). The collector stack, DynamoDB table, CloudWatch queries and the CloudTrail Lake event data store all live in `ap-southeast-2`, and Bedrock usage outside it is not collected. Sydney traffic that uses `apac.` / `au.` cross-Region inference profiles is still recorded against the source Region, and model normalization strips the profile prefix (`packages/shared/src/models.ts`). **Exception:** the Cost Explorer API is served only from `us-east-1`, so the Cost Explorer client is configured with `us-east-1` while it reads organization-wide billing; that is an endpoint detail, not a second collection Region. The value lives in one place, `COLLECTOR_REGION` (`packages/shared/src/region.ts`), and `AccountMeta.region` must equal it. Multi-region collection is a documented future enhancement (the account registry's `region` field would become a list and the CloudWatch query would loop regions).

## Data Sources

The Lambda collector merges three AWS data sources per run:

| Source | What it provides | Cross-account method |
|--------|-----------------|----------------------|
| **AWS Cost Explorer** | Cost ($) per account, per model, and per non-model charge category — exact. `GetCostAndUsage` grouped by `LINKED_ACCOUNT` and `USAGE_TYPE`. Each usage type is classified as model token usage, a non-model charge category, or unclassified (see *Cost Explorer `USAGE_TYPE` classification*). Not every usage type encodes a model. | Collector assumes a single read-only role in the management account. |
| **Amazon CloudWatch** | Bedrock metrics: InputTokenCount, OutputTokenCount, Invocations, InvocationLatency per ModelId. | CloudWatch cross-account observability — the monitoring account queries all linked source accounts directly. **No role assumption.** |
| **CloudTrail Lake** | Per-user and per-service Bedrock API calls — SSO username from `userIdentity`, service from the application inference profile in the request, grouped by model. | Org-wide event data store, queried locally in the observability account (CloudTrail delegated administrator). |

### Alternative usage source: OpenTelemetry (optional, post-v1)

The three sources above are AWS's own metering of Bedrock and require **no
cooperation** from the applications that call Bedrock. An organization that
instruments its Bedrock-calling applications with OpenTelemetry can use that
telemetry as an **alternative source for tokens and attribution** — but not
for cost.

- **OpenTelemetry provides tokens and attribution only — never cost.** Cost
  Explorer remains the authoritative cost source in every configuration.
  OTel-sourced rollups still derive cost from Cost Explorer (and from the
  static price table for today, per *Today's cost fallback*).
- **It only sees instrumented callers.** CloudWatch and CloudTrail capture
  every Bedrock call org-wide; OTel sees a call only if the calling
  application emits it. The OTel source is therefore valid only when **every**
  Bedrock caller in the organization is instrumented.
- It is **complementary, not a replacement** — a v1 deployment uses
  CloudWatch + CloudTrail. The OTel source is a documented post-v1 option.

**`UsageProvider` abstraction.** The Phase 6 collector is built around a
`UsageProvider` interface that isolates token/attribution acquisition from the
rest of the pipeline. Given the active account list and a UTC date range, a
provider returns — per account, per canonical model — token and invocation
totals plus the `byUser` and `byService` attribution breakdowns (i.e. exactly
the non-cost half of a `DailyRollup`). The Cost Explorer query, the
three-source merge, and the DynamoDB `BatchWriteItem` write are
provider-agnostic. Two implementations are envisaged:

| Provider | Source | Status |
|---|---|---|
| `CloudWatchCloudTrailProvider` | CloudWatch `GetMetricData` + CloudTrail Lake | v1 default (`USAGE_SOURCE=cloudwatch`) |
| `OtelPrometheusProvider` | PromQL against Prometheus / Grafana Mimir | post-v1 option (`USAGE_SOURCE=otel`) |

Because the provider only swaps the token/attribution half, the `bedrock-usage`
table, the `DailyRollup` schema, the dashboard data-access layer, and every API
route are unchanged by the choice of source.

**Instrumentation contract (OTel path).** For `OtelPrometheusProvider` to fill
`byUser` and `byService`, every Bedrock-calling application must:

- emit the OpenTelemetry GenAI metric `gen_ai.client.token.usage` (a token-count
  histogram) with `gen_ai.system = aws.bedrock` and `gen_ai.request.model` set
  to the raw Bedrock model ID;
- attach attributes carrying organizational context: AWS account ID, team,
  service name, and SSO user ID.

Raw `gen_ai.request.model` values are normalized through the shared model table
(`packages/shared/src/models.ts`) — the same table CloudWatch/CloudTrail IDs
use — so the two source paths never drift. The collector remains a **single
Lambda**: a second Lambda writing the same `DailyRollup` items would clobber
the first.

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
│           │                 → classify usage type → per-account + per-model
│           │                   cost + non-model charges (exact)
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
  └── Route Handlers → DynamoDB via AWS SDK, protected by Auth.js in the proxy
```

## Lambda Collector Flow

Each hourly run performs these steps:

1. Read the account registry from DynamoDB (all `AccountMeta` items with `active: true`). Only registered accounts receive rollups. Member accounts with Bedrock usage but **no** registry entry are ignored until an admin adds them in Settings. Registry accounts with no data for a day are **skipped** (no empty rollup item). "Data" includes any Cost Explorer Bedrock cost: an account whose only charge that day is idle Provisioned Throughput or model storage still gets a rollup (Data Model spec — *Non-Model Charges*, Rule 5).
2. Assume `CostExplorerReadRole` in the management account and query **Cost Explorer**:
   - `GetCostAndUsage` for yesterday (finalized) and today (partial).
   - Filtered to the Bedrock service.
   - Grouped by `LINKED_ACCOUNT` and `USAGE_TYPE`, requesting `UnblendedCost` and `UsageQuantity`.
   - **Classify** each usage type as model token usage (→ canonical model key), a non-model charge category (→ `nonModel[<category>]`), or unknown (→ `nonModel.unclassified`). See *Cost Explorer `USAGE_TYPE` classification*. This yields exact per-account, per-model, and per-category cost.
3. Query **CloudTrail Lake** locally (org-wide event data store):
   - `StartQuery` (SQL), then poll `GetQueryResults` until the query completes (async).
   - Bedrock `InvokeModel`/`InvokeModelWithResponseStream` calls grouped by account, SSO username, application inference profile (→ service), and model ID.
   - Time range: yesterday + today.
4. Query **CloudWatch** via cross-account observability:
   - `GetMetricData` with account-scoped queries covering all linked source accounts — issued from the monitoring account, no role assumption.
   - Per `ModelId` dimension: InputTokenCount, OutputTokenCount, Invocations, InvocationLatency.
   - Time range: yesterday + today.
5. Normalize raw Bedrock model IDs to canonical keys (see Data Model spec — Model ID Normalization), then merge all three data sources per account per day (see **Three-source merge rules** below). Per-user and per-service costs are proportional estimates of **model** cost only. `nonModel` entries pass through from Cost Explorer unsplit, and the rollup `cost` is set to Σ model cost + Σ non-model cost. Compute that sum from the **already-stored entry values** (each rounded to 6 decimals), never from a separately rounded total, so the `|Δ| ≤ 1e-6` invariant holds (Data Model spec — *Schema decisions*). Request Cost Explorer **usage records only**: Cost Explorer can return negative amounts (credits, refunds), and the v1 schema is nonnegative. Exact `RECORD_TYPE` handling is unverified until Phase 6. `nonModel` entries carry `costEstimated` as a boolean in the schema, `false` by convention in v1.
6. Write/overwrite DailyRollup items to DynamoDB using `BatchWriteItem` (25 items/batch), each carrying `date` (`YYYY-MM-DD`, UTC) and validated with `DailyRollupItemSchema` from `packages/shared` before writing (Data Model spec — *`date` attribute*) — yesterday = finalized, today = estimated (see Today's cost fallback below when Cost Explorer returns zero for today).
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
| **OpenTelemetry / Prometheus** | Alternative token + attribution source via `OtelPrometheusProvider` (see *Alternative usage source: OpenTelemetry*); cost still from Cost Explorer | Optional, post-v1 |

Not used: **Amazon Security Lake** — a security-operations data lake in OCSF format; overkill for a cost/usage dashboard, and CloudTrail Lake is the direct fit. **AWS Control Tower** is contextual governance, not a project dependency — if the organization runs it, the observability account is its existing *Log Archive* account.

## Lambda Configuration

- **Runtime:** Node.js 22.x
- **Timeout:** 5 minutes (CloudTrail Lake SQL polling plus CloudWatch and Cost Explorer queries can take 2-3 minutes for large orgs)
- **Memory:** 512 MB (sufficient for in-memory merge of all account data)
- **Concurrency:** Reserved concurrency 1 (single instance, no parallel invocations needed — hourly cron)

## Infrastructure as Code

**Dashboard hosting (decided 2026-11-09):** AWS ECS Fargate behind an imported or internal ALB, defined in a CDK app (`infra/`: InfraStack, AppStack; CollectorStack in Phase 6) — see the [Platform spec](2026-11-10-platform.md). The `bedrock-usage` table moves to the CDK InfraStack when RP lands; the SAM stack below then stops defining it, and moving the collector itself to CDK is a Phase 6 amendment.

Two IaC artifacts, both deployed through the CloudFormation control plane to different accounts:

| Stack | Tool | Account | Resources |
|-------|------|---------|-----------|
| `cost-explorer-read-role` | Plain CloudFormation (YAML) | Management | `CostExplorerReadRole` only — trust policy to `BedrockCollectorLambdaRole` |
| `bedrock-cost-collector` | AWS SAM (`apps/collector/template.yaml`) | Observability | Lambda function, execution role, log group, EventBridge hourly rule, CloudWatch failure alarm, `bedrock-usage` DynamoDB table |

**Why SAM for the collector.** The collector is a pure serverless workload — `AWS::Serverless::Function` collapses the function, its IAM role, log group, and the EventBridge schedule into one resource with an inline `Events:` block. `sam build` bundles the TypeScript; `sam local invoke` exercises the handler against DynamoDB Local before deploy. A SAM template *is* a CloudFormation template (the `Serverless` transform), so it deploys through the same control plane as the plain-CFN role stack — one paradigm, no second IaC tool.

**Why plain CFN for `CostExplorerReadRole`.** A single IAM role in a different account, deployed once. The SAM transform adds nothing — keep it a minimal standalone template.

**DynamoDB table ownership.** The production `bedrock-usage` table is defined in the SAM template (`AWS::DynamoDB::Table`) and owned by the collector stack — PK/SK + GSI1, TTL on `DailyRollup`. `scripts/create-table.ts` is **DynamoDB-Local-only** and never touches AWS. The SAM template is the source of truth for the production schema; the two must be kept in sync by hand.

**Monorepo bundling.** The collector imports `@llm-usage-lens/shared` as a `workspace:*` dependency, which cannot be resolved at Lambda runtime. SAM's `BuildMethod: esbuild` must inline the shared package into the artifact — configure `esbuild` with the shared package source on its resolve path, or run `pnpm --filter collector deploy` to produce a flattened `node_modules` before `sam build`. Verify the built bundle contains the shared code in Phase 6.

**Credentials.** Both stacks deploy from GitHub Actions using an OIDC-assumed IAM role — no static AWS keys in CI, consistent with the AWS SDK default credential chain rule. The deploy role itself is created once during one-time setup.

## Known Limitations

1. **Single region**: Only `ap-southeast-2` (Sydney) Bedrock usage is collected. Usage in other regions is not captured.
2. **Cost Explorer lag**: Cost data is 8-24h behind. Today's cost is estimated from token counts and model pricing. Yesterday's cost is finalized.
3. **Per-user/per-service cost is approximate**: Calculated proportionally from token usage ratio. Only account-level and model-level cost from Cost Explorer is exact.
4. **Service tagging dependency**: `byService` data quality depends on teams routing calls through tagged **application inference profiles** (`service=<name>`). Usage not routed through a tagged profile falls into the `_untagged` bucket. Billing cost allocation tags in the AWS console do not populate `byService` in v1.
5. **CloudTrail Lake query cost**: CloudTrail Lake charges per query scan. At high Bedrock call volumes, this cost should be monitored.
6. **Cost Explorer API cost**: Each `GetCostAndUsage` call costs $0.01. Cost Explorer is queried once per day per run (yesterday + today) — 2 calls per hourly run, roughly $1.50/month regardless of the number of accounts.
7. **Lambda overrun**: With reserved concurrency of 1 and an hourly trigger, a run exceeding 60 minutes would collide with the next invocation. The 5-minute timeout makes this effectively impossible, but EventBridge invocation failures are surfaced via a CloudWatch alarm.
8. **Bedrock service charges only**: Charges for resources that Bedrock features run on but that bill under other Cost Explorer services are not collected in v1. Examples are OpenSearch Serverless OCUs behind a Knowledge Base vector store, S3 data sources, and Lambda action groups. The dashboard labels totals "Bedrock service charges only" (see *Adjacent services*).
9. **Non-model cost is not attributed to users or services**: `nonModel` charges appear at account, team, and department level only (Data Model spec — *Non-model cost is account-level only*).

---

## Collector Appendices

### Cost Explorer `USAGE_TYPE` classification

**Amendment 2026-10-23.** Not every Bedrock usage type is model token usage. Guardrails, Provisioned Throughput, model storage, Custom Model Import, Knowledge Bases, Flows, Data Automation, and model evaluation each bill under their own usage types. The categories, billing units, and storage rules are in Data Model spec — *Non-Model Charges*.

> **Unverified.** Every usage-type string and substring in this section is an **illustrative pattern family**, not a confirmed AWS value. Confirm exact `USAGE_TYPE` strings (including region prefixes such as `USE1-`), their `UsageQuantity` units, and the Cost Explorer `SERVICE` dimension value(s) against a real `GetCostAndUsage` response and the AWS pricing page in Phase 6, before the classification table is frozen in `packages/shared`. The `Service = AmazonBedrock` filter value used throughout this spec is itself a placeholder until the Phase 6 `SERVICE` ground-truth check (*Proposed collector amendments (audit A2)* item 4).

The classifier is a pure function in `packages/shared`, `classifyUsageType(raw) → { kind: "model", key } | { kind: "nonModel", category } | { kind: "unclassified" }`, driven by an ordered pattern table. It does not return `recurring`; the collector derives that from the category (see Recurring flag below). The signature may gain an optional `service` argument in Phase 6 if the Cost Explorer `SERVICE` ground truth shows that some model families are identifiable only from `SERVICE`, not from `USAGE_TYPE` (see Third-party model billing below). In `{ kind: "nonModel", category }`, `category` is any `NonModelCategorySchema` key **except** `unclassified`; an unmatched usage type returns `{ kind: "unclassified" }`, which the collector writes to `nonModel.unclassified`. The classifier first strips a leading region prefix **at most once** with the placeholder regex `^[A-Z]{2,4}[0-9]+-` (e.g. `USE1-`, `EUC1-`, `APS2-`; unverified, confirm the prefix forms in Phase 6). The match is case-sensitive and runs before case folding. The prefix must end in a digit because the broader `^[A-Z0-9]+-` would also strip leading acronyms such as `BDA-`, hiding the row 9 marker. It then matches the remainder as a case-insensitive substring unless a row says otherwise, and the **first match wins**:

| Order | Pattern family (illustrative, unverified) | Result |
|---|---|---|
| 1 | Contains a guardrail marker (e.g. `Guardrail`), or a guardrail policy name (e.g. `ContentFilter`, `DeniedTopic`, `SensitiveInformation`, `ContextualGrounding`, `AutomatedReasoning`) | `nonModel.guardrails` |
| 2 | Contains a Custom Model Import marker (e.g. `CustomModelUnit`, `ModelImport`), including Custom Model Import storage | `nonModel.custom-model-import` |
| 3 | Contains a customized-model storage marker (e.g. `CustomModel…Storage`) | `nonModel.custom-model-storage` |
| 4 | Contains a provisioned-throughput marker (e.g. `ProvisionedThroughput`, `ModelUnit`), including commitment-term variants | `nonModel.provisioned-throughput` |
| 5 | Contains a customization/training marker (e.g. `Customization`, `FineTuning`, `Training`) | `nonModel.model-customization` |
| 6 | Contains a Knowledge Base marker (e.g. `KnowledgeBase`, `Retrieve`, `Rerank`) | `nonModel.knowledge-bases` |
| 7 | Contains an Agents marker (e.g. `Agent`, which also covers `AgentCore`) | `nonModel.agents` |
| 8 | Contains a Flows marker (e.g. `Flow`, `NodeTransition`) | `nonModel.flows` |
| 9 | Contains a Data Automation marker: `DataAutomation` as a substring, or `BDA` as a whole token only (bounded by the string start/end, `-`, `_`, or `:`), since a bare `bda` substring also occurs inside unrelated words such as `Lambda` | `nonModel.data-automation` |
| 10 | Contains an evaluation marker (e.g. `Evaluation`, `HumanTask`) | `nonModel.model-evaluation` |
| 11 | Contains a prompt-routing, prompt-optimization, or web-search marker (e.g. `PromptRouting`, `PromptOptimization`, `WebSearch`) | `nonModel.other-features` |
| 12 | Contains a known model family. **Families come from `packages/shared/src/models.ts`** (`claude-opus`, `claude-sonnet`, `claude-haiku`); there is no second family table. The usage-type matcher accepts each family with or without separators and with an optional version, e.g. `ClaudeOpus` / `claude-opus` / `Claude4-Opus` → `claude-opus`, `ClaudeSonnet` / `Claude3-5-Sonnet` / `claude-sonnet` → `claude-sonnet`, `ClaudeHaiku` / `Claude3-5-Haiku` / `claude-haiku` → `claude-haiku`. Includes batch, cache-read/cache-write, cross-Region, and service-tier variants | `models[<key>]` (model cost) |
| 13 | Contains a token-usage marker (e.g. `input-tokens`, `output-tokens`, `InputToken`, `OutputToken`; illustrative and unverified — input and output usage of an unmapped model must classify the same way) but no known model family | `models.other` (raw usage type appended to its `rawModelIds`) |
| 14 | Anything else under the Bedrock service | `nonModel.unclassified` |

Rules:

- **Non-model families are tested before model families.** A Provisioned Throughput or storage usage type can embed a model name. Without this ordering it would be misfiled as that model's token cost (Data Model spec — *Non-Model Charges*, Rule 2).
- **Custom Model Import and custom-model storage are tested before Provisioned Throughput.** Matching is a case-insensitive substring test and the first match wins, so the provisioned-throughput marker `ModelUnit` is a substring of the Custom Model Import marker `CustomModelUnit`. With Provisioned Throughput first, every Custom Model Import charge would be misfiled as Provisioned Throughput.
- **`other` vs. `unclassified`.** A usage type that is recognizably token usage of an unmapped model goes to `models.other`, as today. A usage type the classifier cannot interpret at all goes to `nonModel.unclassified` and is **not** guessed into a model. Both keep the raw string (`rawModelIds` / `rawUsageTypes`).
- **Recurring flag.** The collector derives `recurring` from the category; the classifier does not return it: `true` for `provisioned-throughput`, `custom-model-storage`, and `custom-model-import`. For `knowledge-bases` it is `true` when one of its `rawUsageTypes` contains `Storage` (unverified marker). It is `false` otherwise (Data Model spec — *Charge categories*).
- **Units.** Sum `UsageQuantity` per category. Set `usageUnit` only when every folded usage type reports the same unit; otherwise omit both `usageQuantity` and `usageUnit`, never mixing units.
- **Observability.** Log every usage type that lands in `nonModel.unclassified` or `models.other` to CloudWatch Logs as a structured warning, so operators can extend the table. Log entries carry the usage-type string and account ID only — never env values or credentials (Rule 50.6).
- **Third-party model billing.** Some third-party models on Bedrock may bill under a separate Marketplace-style Cost Explorer `SERVICE` value rather than the Bedrock service. If so, the `Service = AmazonBedrock` filter silently drops them. Phase 6 must list the distinct `SERVICE` values carrying Bedrock usage in a real account and widen the filter to an explicit list if needed (unverified; see *Proposed collector amendments (audit A2)* item 4).

### Adjacent services

Some Bedrock features run on resources that bill under **other** Cost Explorer services:

- OpenSearch Serverless OCUs and storage for a Knowledge Base vector store
- S3 for Knowledge Base data sources and batch inference input/output
- Lambda for Agent action groups
- AgentCore, if it bills under its own service (unverified)

These are not Bedrock usage types, so the classifier never sees them.

- **v1: excluded, and labelled.** The collector queries the Bedrock service only. The dashboard states the scope as "Bedrock service charges only" wherever totals appear (Data Model spec — *Dashboard impact*).
- **Phase 6+ option, behind config.** An optional `ADJACENT_SERVICES` collector setting lists extra Cost Explorer `SERVICE` values to query. Off by default; validated with Zod at startup (Rule 60.19). Without resource-level tags, an account's OpenSearch Serverless spend cannot be attributed to Bedrock, so adjacent charges would need their own top-level rollup field, separate from `nonModel`, and an explicit opt-in. The design is deferred; see [`docs/future-improvements.md`](../future-improvements.md) — *Adjacent-service cost collection*.

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

When Cost Explorer returns **zero or no rows** for a model on today's UTC day (common due to 8–24h lag). The trigger is evaluated **per model**, over rows that `classifyUsageType` maps to `{ kind: "model" }` only. `nonModel` rows never suppress it: an idle Provisioned Throughput or storage row that posts for today while token rows still lag does not count as Cost Explorer data for any model.

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
| Account **non-model cost** (`nonModel`) | **Cost Explorer only**: exact, `costEstimated: false`, never token-priced, never split to users/services. Omitted on today's rollup until Cost Explorer reports it |

CloudTrail user/service token sums may not equal CloudWatch model totals (sampling, timing, or untracked calls). Do not rebalance CloudWatch totals to match CloudTrail; keep breakdowns as recorded and accept small drift.

### Proposed collector amendments (audit A2)

> **Proposals, 2026-10-23; not yet adopted.** Each needs a decision before Phase 6 starts. Adopting one means updating the sections it names and the Phase 6 task list.

1. **Resolve ARN-form model IDs before normalization.** CloudTrail and CloudWatch can report an application inference profile ARN (the v1 `byService` mechanism) or a provisioned-model ARN instead of a foundation-model ID. Today these normalize to `other`. Proposed: the collector resolves profile ARNs with `bedrock:GetInferenceProfile` and provisioned-model ARNs with `bedrock:GetProvisionedModelThroughput` to the underlying foundation model, then calls `normalizeModelId`. Results are cached per run, and the two read actions are added to `BedrockCollectorLambdaRole`. An unresolvable ARN stays `other` with the ARN in `rawModelIds` (Data Model spec — *Model ID Normalization*). Cross-account resolution needs the same validation as *Inference profile tag resolution* step 2.
2. **Widen the CloudTrail event filter to the Converse API.** Step 3 and the sample query match only `InvokeModel`/`InvokeModelWithResponseStream`. Calls made through `Converse`/`ConverseStream` would then be missing from `byUser`/`byService`. Proposed: `eventName IN ('InvokeModel', 'InvokeModelWithResponseStream', 'Converse', 'ConverseStream')`; confirm the event names on real events in Phase 6. **Batch inference** jobs have no per-call CloudTrail invocation events, so batch tokens have no user or service attribution (Data Model spec — *Token-based charges that stay model cost*).
3. **Zero-denominator rule for the proportional split.** When a model has cost on an account-day but zero CloudWatch tokens (for example batch-only usage, or a metric gap), `entity tokens ÷ CloudWatch model tokens` is undefined. Proposed: never divide by zero. Attribute the whole model cost to a reserved `_unattributed` key in both `byUser` and `byService` (`costEstimated: true`, zero tokens and invocations). Also put the residual there when CloudTrail attribution sums to less than the model cost, so the per-model attribution maps sum to the model cost. `_unattributed` is distinct from `_untagged`, which means a call with no service tag.
4. **Ground-truth the Cost Explorer `SERVICE` filter (unverified, high impact).** Third-party models, possibly including Anthropic Claude, may bill through AWS Marketplace under per-model `SERVICE` names rather than the Bedrock service. If so, `Service = AmazonBedrock` would miss Claude cost entirely. Phase 6 ground-truth check: run read-only `aws ce get-dimension-values --dimension SERVICE` over a recent window in the bedrock-simulator sandbox. Record every `SERVICE` value that carries Bedrock usage, and set the collector filter to that explicit list (see *Cost Explorer `USAGE_TYPE` classification* — Third-party model billing).

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

Besides schemas and model normalization, `packages/shared` may hold small pure, dependency-free utilities used by two or more of the dashboard, the collector and `scripts/` (e.g. `runBounded`, bounded-concurrency mapping — decided 2026-10-29). Nothing with I/O or AWS SDK imports.

Both apps depend on `@llm-usage-lens/shared` (workspace package). Phase 1 scaffolds the workspace; Phase 3 implements schemas in `packages/shared`; Phase 6 imports the same package in the collector bundle.
