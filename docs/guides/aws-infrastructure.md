# AWS Infrastructure Guide — Bedrock Cost Collector

Operational runbook for the AWS side of the project: how the collector pipeline
is designed, how it works at runtime, and the CLI commands to deploy and
undeploy it.

> Design source of truth: [docs/specs/2026-05-15-system-architecture.md](../specs/2026-05-15-system-architecture.md). This
> guide is the *operational* companion — it does not redefine architecture
> decisions, it explains how to run them.

---

## 1. What runs in AWS

Only the **collector** runs in AWS. The Next.js dashboard is hosted separately
(see [docs/guides/dashboard-deployment.md](dashboard-deployment.md)). The collector is a serverless pipeline that
gathers Bedrock cost and usage data hourly and writes aggregated rollups to
DynamoDB.

### Account layout

| Account | Role |
|---------|------|
| **Management** | Owns AWS Organizations, the org CloudTrail, and Cost Explorer. Hosts the `CostExplorerReadRole`. |
| **Observability** | Runs the collector Lambda, DynamoDB, EventBridge. The CloudWatch monitoring account and CloudTrail Lake delegated administrator. |
| **Member accounts** | One per team. Linked as CloudWatch observability source accounts; Bedrock activity captured by the org CloudTrail. No custom roles deployed here. |

### Data sources

| Source | Provides | Exactness |
|--------|----------|-----------|
| **Cost Explorer** (management acct, via assumed role) | Per-account, per-model cost | Exact (yesterday); lagging 8–24h (today) |
| **CloudWatch** (cross-account observability) | Per-model tokens, invocations, latency | Exact — authoritative for rollup totals |
| **CloudTrail Lake** (observability acct) | Per-user and per-service attribution | Exact counts; cost is a proportional estimate |

---

## 2. How it works

An EventBridge cron rule fires the Lambda **every hour**. Each run:

1. Reads the account registry from DynamoDB (`AccountMeta` items with `active: true`).
2. Assumes `CostExplorerReadRole` in the management account, queries Cost Explorer
   for yesterday (finalized) and today (partial).
3. Queries CloudTrail Lake for per-user / per-service attribution.
4. Queries CloudWatch for per-model token and invocation totals.
5. Normalizes raw Bedrock model IDs to canonical keys, merges the three sources
   per account per day (see the spec's *Three-source merge rules*).
6. Writes/overwrites `DailyRollup` items via `BatchWriteItem` (25/batch).
7. Updates the `SyncStatus` item (`lastRunAt`, `nextScheduledAt`, status, counts).

**Two-day refresh:** every run rewrites both yesterday and today. Yesterday is
finalized (`costFinalized: true`); today is estimated. When Cost Explorer returns
no rows for today, cost falls back to a token-based estimate from the shared
static price table.

**Lambda config:** Node.js 22.x, 5-minute timeout, 512 MB, reserved concurrency 1.

---

## 3. Infrastructure as Code

Two stacks, both deployed through the CloudFormation control plane:

| Stack | Tool | Account | Contents |
|-------|------|---------|----------|
| `cost-explorer-read-role` | Plain CloudFormation (YAML) | Management | `CostExplorerReadRole` (trusts the collector Lambda role) |
| `bedrock-cost-collector` | AWS SAM (`apps/collector/template.yaml`) | Observability | Lambda, execution role, log group, EventBridge rule, CloudWatch alarm, `bedrock-usage` DynamoDB table |

The SAM stack **owns the production `bedrock-usage` table**. The repo-root
`scripts/create-table.ts` is for DynamoDB Local only and never touches AWS.

---

## 4. Prerequisites

Install and authenticate before any deploy:

```sh
# AWS SAM CLI
brew install aws-sam-cli          # macOS; see AWS docs for other platforms
sam --version

# AWS CLI + SSO login (use a profile, never static keys)
aws --version
aws sso login --profile <observability-profile>
```

One-time AWS setup (done once per organization — see the implementation-phases
spec, Phase 6 *One-Time AWS Setup*):

- CloudWatch cross-account observability enabled org-wide.
- Organization CloudTrail configured; observability account set as CloudTrail
  delegated administrator.
- GitHub Actions OIDC deploy role(s) created (used by CI; see §7).

---

## 5. Deploy

### 5a. `CostExplorerReadRole` (management account, one-time)

```sh
aws cloudformation deploy \
  --template-file infra/cost-explorer-read-role.yaml \
  --stack-name cost-explorer-read-role \
  --capabilities CAPABILITY_NAMED_IAM \
  --profile <management-profile> \
  --region ap-southeast-2
```

### 5b. Collector stack (observability account)

```sh
# From apps/collector/
sam build                          # bundles TypeScript + @llm-usage-lens/shared via esbuild

sam deploy \
  --stack-name bedrock-cost-collector \
  --capabilities CAPABILITY_IAM \
  --profile <observability-profile> \
  --region ap-southeast-2 \
  --no-confirm-changeset
```

First deploy can use `sam deploy --guided` to generate `samconfig.toml`; later
deploys read that config and only need `sam deploy`.

### Verify

```sh
# Trigger a run immediately instead of waiting for the cron
aws lambda invoke --function-name bedrock-cost-collector \
  --profile <observability-profile> /tmp/out.json && cat /tmp/out.json

# Tail logs
sam logs --stack-name bedrock-cost-collector --tail \
  --profile <observability-profile>
```

A healthy run writes `DailyRollup` items and updates `SyncStatus` in DynamoDB.

---

## 6. Undeploy

> **Warning:** the `bedrock-usage` DynamoDB table is part of the collector stack.
> Deleting the stack deletes the table and all rollup data. Back up first if the
> data matters:
> ```sh
> aws dynamodb create-backup --table-name bedrock-usage \
>   --backup-name pre-teardown-$(date +%Y%m%d) --profile <observability-profile>
> ```

```sh
# Collector stack (observability account)
sam delete --stack-name bedrock-cost-collector \
  --profile <observability-profile> --region ap-southeast-2

# CostExplorerReadRole (management account) — only if fully decommissioning
aws cloudformation delete-stack --stack-name cost-explorer-read-role \
  --profile <management-profile> --region ap-southeast-2
```

Org-level setup (CloudWatch observability links, org CloudTrail) is shared
infrastructure and is **not** removed by these commands — leave it unless the
whole observability program is being shut down.

---

## 7. CI/CD

The GitHub Actions `deploy-collector` job (see implementation-phases spec,
*CI/CD — GitHub Actions*) runs on push to `main`, after `build`:

1. Assumes the AWS deploy role via **OIDC** — no static keys in CI.
2. `sam build` (bundles `@llm-usage-lens/shared`).
3. `sam deploy --no-confirm-changeset`.

Local `sam deploy` (above) and the CI job are interchangeable; CI is the normal
path, local deploy is for first setup and break-glass.

---

## 8. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `sam build` succeeds but Lambda fails on a missing `@llm-usage-lens/shared` import | esbuild did not bundle the workspace package — check `BuildMethod: esbuild` and the resolve path |
| `AccessDenied` assuming `CostExplorerReadRole` | Role trust policy does not name the collector Lambda role, or the role stack is not deployed |
| `SyncStatus` never updates | Lambda erroring before step 7 — check `sam logs` |
| Today's cost is 0 | Expected if Cost Explorer has no rows yet; token-based fallback should fill it — verify the price table is current |

---

## Related docs

- [docs/guides/dashboard-deployment.md](dashboard-deployment.md) — hosting the Next.js dashboard
- [docs/guides/auth-setup.md](auth-setup.md) — Auth.js + Microsoft Entra ID and AWS credentials
- [docs/specs/2026-05-15-system-architecture.md](../specs/2026-05-15-system-architecture.md) — full architecture design
- [docs/specs/2026-05-15-implementation-phases.md](../specs/2026-05-15-implementation-phases.md) — Phase 6 build plan
