# Bedrock simulator — operational guide

The playbook for the standalone Bedrock test harness in [`tools/bedrock-simulator/`](../../tools/bedrock-simulator/). Read the spec ([`docs/specs/2026-05-24-bedrock-simulator.md`](../specs/2026-05-24-bedrock-simulator.md)) for the design; this file is the runbook.

**Reminder:** every `aws` / `sam` command in this guide runs **from an operator terminal with sandbox-account SSO credentials** (or from the GitHub Actions runner). Claude Code is hard-blocked from `sam delete`, `aws cloudformation delete-stack`, and `aws *delete-*` via [`.claude/settings.json`](../../.claude/settings.json) — that is by design. If you find yourself wanting Claude to run a destructive command, you are doing something wrong.

## Prerequisites runbook

These six items are operator one-time setup. None can be created by the SAM template.

### 0. AWS SSO credential setup

All `aws` / `sam` commands in this guide need short-lived credentials for the sandbox account. Set up an IAM Identity Center (SSO) profile once; re-run `aws sso login` when the session expires (typically 8 hours).

**Profile name used throughout this guide: `bedrock-simulator-sandbox`**
This matches the GitHub Environment name and makes it unambiguous which account you are targeting.

**Step 1 — Find your SSO start URL**

Open **IAM Identity Center** in the management (or SSO-delegated) account.
Under **Settings → Identity source → Instance URL**, copy the portal start URL
(format: `https://<subdomain>.awsapps.com/start`).

**Step 2 — Add the profile to `~/.aws/config`**

The easiest path is the interactive wizard:

```bash
aws configure sso --profile bedrock-simulator-sandbox
```

It will ask for the start URL, region, account, and role, then write the
`~/.aws/config` blocks for you. If you prefer to edit the file directly, add:

```ini
[profile bedrock-simulator-sandbox]
sso_session    = bedrock-cost-tracker-sso
sso_account_id = 000000000000   # your sandbox account ID
sso_role_name  = AdministratorAccess
region         = us-east-1
output         = json

[sso-session bedrock-cost-tracker-sso]
sso_start_url           = https://<your-portal>.awsapps.com/start
sso_region              = us-east-1
sso_registration_scopes = sso:account:access
```

Replace `<your-portal>` with the subdomain from Step 1.

> **Role name:** an `AdministratorAccess`-grade SSO role is required to run the
> one-time `.github/scripts/aws/create-bedrock-simulator-deployer-role.sh` (it
> creates the OIDC provider and the `bedrock-simulator-deployer` IAM role via
> `.github/scripts/aws/lib/create-deployer-role.sh`). All deploys — including the first — then
> go through GitHub Actions using that `bedrock-simulator-deployer` role.

**Step 3 — Log in**

```bash
aws sso login --profile bedrock-simulator-sandbox
```

A browser tab opens for authentication. Confirm the device code, then return
to the terminal.

**Step 4 — Verify**

```bash
aws sts get-caller-identity --profile bedrock-simulator-sandbox
```

Expected output:

```json
{
    "UserId": "AROA...:you@example.com",
    "Account": "000000000000",
    "Arn": "arn:aws:sts::000000000000:assumed-role/AdministratorAccess/you@example.com"
}
```

**Re-authentication:** sessions expire after 8 hours (configurable in Identity
Center). Re-run `aws sso login --profile bedrock-simulator-sandbox` whenever a
command fails with `Token has expired` or `Error when retrieving token`.

### 1. Sandbox member account in the AWS Organisation

Required for the simulator itself. The CloudWatch cross-account observability link to the dashboard's observability account is a **deferred prerequisite** — Phase 6 hasn't built that account yet, so set up the link when Phase 6 begins, not now.

```bash
# Verify the sandbox is in the org (run in management account)
aws organizations list-accounts \
  [--profile <your-profile-name>] \
  --query 'Accounts[?Status==`ACTIVE`].[Id,Name]' \
  --output table

# Later, when the observability account exists, enrol the sandbox as a CWO source.
# (Not done today.)
```

### 2. Bedrock model access

**As of mid-2025, the Bedrock Model Access page has been retired.** Serverless foundation models are now automatically enabled on first invocation — no manual activation required. For Anthropic models, first-time users in a new account may be prompted to submit use case details before the first call succeeds; follow the console link in the error response if that happens.

The template defaults (after updating from the original Claude 4 May 2025 IDs) are:

| Canonical key | Model ID | Invocation | Regions needed |
|---|---|---|---|
| `claude-opus` | `anthropic.claude-sonnet-4-6` | `us.*` cross-region profile | auto-enabled on first call in each region |
| `claude-sonnet` | `anthropic.claude-sonnet-4-6` | `us.*` cross-region profile | auto-enabled on first call in each region |
| `claude-haiku` | `anthropic.claude-haiku-4-5-20251001-v1:0` | `us.*` cross-region profile | auto-enabled on first call in each region |
| `other` | `meta.llama3-3-70b-instruct-v1:0` | bare ID, `us-east-1` only | auto-enabled on first call |

The `us.*` cross-region profiles for Sonnet route across `us-east-1`, `us-west-2`, and `us-east-2` — access activates in each region on first routing there, which the deploy workflow's smoke test triggers automatically.

```bash
# Verify active models in the sandbox account (sanity check):
aws bedrock list-foundation-models --region us-east-1 \
  --profile <aws-profile> \
  --query 'modelSummaries[?modelLifecycle.status==`ACTIVE` && contains(modelId,`anthropic`)].[modelId]' \
  --output text

# Optional: trigger a first invocation to surface any use-case-details prompt early.
# Claude 4.x models (including Haiku 4.5) require the us.* cross-region inference
# profile prefix — bare model IDs fail with "on-demand throughput isn't supported".
# Use the Converse API (bedrock-runtime converse) rather than invoke-model for
# newer models; it handles the request/response envelope automatically.
aws bedrock-runtime converse \
  --profile <aws-profile> \
  --region us-east-1 \
  --model-id us.anthropic.claude-haiku-4-5-20251001-v1:0 \
  --messages '[{"role":"user","content":[{"text":"hi"}]}]'

# With inference config
aws bedrock-runtime converse \
    --profile <aws-profile> \
    --model-id arn:aws:bedrock:us-east-1:469515554732:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0 \
    --messages '[{"role":"user","content":[{"text":"hi"}]}]' \
    --inference-config '{"maxTokens":32000,"stopSequences":[],"temperature":1}' \
    --additional-model-request-fields '{"top_k":250}' \
    --performance-config '{"latency":"standard"}' \
    --region us-east-1
```

### 3. Bedrock per-region service quotas

Defaults are tight. Verify quotas for the test mix before raising `totalCalls` toward the cap.

```bash
# Check the Bedrock service quota codes for InvokeModel (Claude 3.5 Haiku example):
aws service-quotas list-service-quotas --service-code bedrock --region us-east-1 \
  --query 'Quotas[?contains(QuotaName, `Haiku`)].[QuotaName,Value]' --output table

# Request an increase (example — replace QuotaCode + DesiredValue):
aws service-quotas request-service-quota-increase \
  --service-code bedrock --region us-east-1 \
  --quota-code L-XXXXXXXX --desired-value 100
```

### 4. GitHub OIDC IdP in the sandbox account

One per account; not per stack.

```bash
# Check if it already exists:
aws iam list-open-id-connect-providers \
  --query 'OpenIDConnectProviderList[?contains(Arn, `token.actions.githubusercontent.com`)]'

# If empty, create it (thumbprint may change — verify from GitHub docs):
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 5. SNS topic confirmation for the budget alarm

The SAM template creates the topic + email subscription. The confirmation link **must be clicked manually** — there is no API for it. After the first deploy:

```bash
# Confirm the subscription is Confirmed (not PendingConfirmation):
aws sns list-subscriptions --query 'Subscriptions[?contains(TopicArn, `bedrock-simulator`)].[Endpoint,SubscriptionArn]' \
  --output table
```

If the subscription is `PendingConfirmation`, find the AWS SNS email in your inbox and click the confirm link.

### 6. Organisation CloudTrail captures Bedrock data events

The most-missed prerequisite. `InvokeModel` is a CloudTrail **data event**, not a management event — and data events require explicit opt-in. Without this, simulator calls never appear in CloudTrail Lake and the dashboard's per-user / per-service breakdown gets nothing from the sandbox account.

```bash
# Run in the management account:
aws cloudtrail get-event-selectors --trail-name <org-trail-name> \
  --query 'AdvancedEventSelectors[?contains(to_string(FieldSelectors), `Bedrock`)]'
```

Expected result includes a selector with `eventCategory = Data` and a `resources.type` matching `AWS::Bedrock::*` (or an inclusive selector). If empty, this needs to be added — coordinate with whoever owns the org trail. **Flag this to the Phase 6 owner**: the dashboard's `docs/specs/2026-05-15-system-architecture.md` implies but does not explicitly require this configuration.

## Bootstrap: first deploy

The `bedrock-simulator-deployer` role the workflows assume is **not** a CloudFormation resource — it is created out-of-band so the very first deploy can run entirely through GitHub Actions. (Were it defined in the stack, it would not exist until after the first deploy, yet the deploy workflow's OIDC credential step needs it *before* `sam deploy` runs — a chicken-and-egg.)

### Step A — create the deployer role (one-time, local)

The deployer role is a **pipeline** resource, not part of the app. Provision it once with operator SSO credentials via the wrapper `.github/scripts/aws/create-bedrock-simulator-deployer-role.sh`, which feeds the bedrock-simulator inputs (role name, the three workflow trust pins, and the `iam/deployer-*.json` permission policies) to the project-generic engine `.github/scripts/aws/lib/create-deployer-role.sh`. The engine registers the account-shared GitHub OIDC provider (if missing) and creates the `bedrock-simulator-deployer` role.

```bash
# Run from the repo root. All configuration (profile, account ID, GitHub owner)
# is read from .github/scripts/aws/.env — copy .env.example to .env and fill it in.
aws sso login --profile bedrock-simulator-sandbox
./.github/scripts/aws/create-bedrock-simulator-deployer-role.sh
```

Set the repo's `SANDBOX_ACCOUNT_ID` Actions **variable** to the same account ID (the deploy workflow reads `vars.SANDBOX_ACCOUNT_ID` to build the role ARN). Tear the role down later with `./.github/scripts/aws/create-bedrock-simulator-deployer-role.sh --delete`.

> **Re-provision after policy changes.** The role's permissions live in the
> committed [`iam/deployer-*.json`](../../.github/scripts/aws/iam/) files, but the
> **live** role only changes when this script is re-run (`aws iam put-role-policy`
> overwrites the inline policy in place, so re-running is idempotent). Whenever
> those JSON files change, re-run the wrapper or a later deploy/destroy will fail
> on the missing permission — see [Recovery G](#recovery-g--sam-delete-fails-with-accessdenied-on-s3deleteobject).

### Step B — deploy via GitHub Actions

With the role in place, deploy from scratch through the workflows:

```bash
gh workflow run bedrock-simulator-build.yml          # compile + sam build artifact
gh workflow run bedrock-simulator-deploy.yml -f confirm=deploy   # deploy the artifact
```

The deploy workflow passes `SandboxAccountId` / `GitHubOwner` / `GitHubRepo` / `GitHubEnvironment` / `BudgetAlertEmail` (the last from the `BUDGET_ALERT_EMAIL` secret) as parameter overrides. `UseKmsEncryption` defaults to `false` (SSE-S3, free); set it `true` to add a CMK ($1/month) for the invocation logs + SNS.

After the deploy completes:
- The `validate` job runs the post-deploy health checks automatically; you can also run checks 2a–2c below by hand.
- Click the SNS email confirmation link (Prereq #5).

### Optional — local deploy alternative

`./bootstrap.sh` (from `tools/bedrock-simulator/`) builds and `sam deploy`s the stack locally with your SSO credentials — useful for recovery runs or developing without round-tripping through Actions. It does **not** create the deployer role (that is Step A, a pipeline concern); a local `sam deploy` does not need it. The stack creates the app's own roles. `sam deploy --guided` prompts for each parameter and writes a gitignored `samconfig.toml` (never commit it).

## Build / deploy / run / destroy

`run` and `destroy` are `workflow_dispatch` only and bound to the `bedrock-simulator-sandbox` GitHub Environment (required-reviewer protection). `deploy` is the same. `build` holds no AWS credentials (an access boundary, not a cost claim), so it is **not** bound to the Environment (no approval, runnable from any branch). Trigger from the GitHub Actions UI or `gh workflow run`.

Build and deploy are **separate workflows** so a known-good build can be re-deployed (rollback) without rebuilding — see [Rollback / redeploy](#rollback--redeploy).

### Build

```bash
gh workflow run bedrock-simulator-build.yml
gh run watch
```

The workflow runs `gate` + `deps` in parallel, then `build` (which needs both):

```mermaid
flowchart LR
    gate["gate<br/>typecheck · test · sam validate"]
    deps["deps<br/>outdated · dedupe (advisory)<br/>pnpm audit (BLOCKING)"]
    build["build<br/>pnpm build → sam-build.tgz"]
    publish["publish-asset<br/>(release only)"]
    gate --> build
    deps --> build
    build --> publish
```

1. `gate` — `pnpm typecheck` + `pnpm test` + `sam validate --lint`.
2. `deps` — `pnpm outdated` + `pnpm dedupe --check` (advisory, to the run summary) and `pnpm audit` (**blocking**: any vulnerability fails the job, so no artifact ships with a known CVE). Both jobs cache the pnpm store.
3. `build` — needs `gate` **and** `deps`; runs `pnpm build` (`tsc --noEmit` + esbuild → `dist/*.mjs`, then `sam build`), packages `.aws-sam/` as `sam-build.tgz`, and uploads it as a **7-day** Actions artifact. The run summary prints the `build_run_id` to pass to deploy.

When a `vX.Y.Z` **release** is published, build also fires on `release: [published]` and attaches `sam-build.tgz` to that GitHub Release as a **durable** asset (release assets don't expire), so any release stays redeployable.

### Deploy

```bash
# Deploy the latest successful build:
gh workflow run bedrock-simulator-deploy.yml -f confirm=deploy
# Deploy a specific build run (7-day artifact):
gh workflow run bedrock-simulator-deploy.yml -f confirm=deploy -f build_run_id=<run-id>
# Redeploy a release by tag (durable asset):
gh workflow run bedrock-simulator-deploy.yml -f confirm=deploy -f release_tag=v1.2.3
gh run watch
```

Deploy downloads a *previously built* bundle and deploys it — it does **not** rebuild or re-test. Which bundle (precedence `release_tag` > `build_run_id` > latest):

- `release_tag=vX.Y.Z` → the durable `sam-build.tgz` asset on that release.
- `build_run_id=<id>` → that build run's 7-day Actions artifact.
- neither → the latest successful build on `main`.

It then runs, in order:

1. Resolves + downloads the bundle, extracts `.aws-sam/`, and prints the build's provenance (commit SHA) to the run summary.
2. `sam deploy --no-confirm-changeset` against the prebuilt `.aws-sam/build/template.yaml` — creates or updates the stack.
3. **Post-deploy verification** (see below). On failure, the stack remains so you can inspect it.

### Rollback / redeploy

To roll back, deploy points at an earlier bundle instead of the current source:

- **Within 7 days** — `-f build_run_id=<run-id>` (from the build run's summary or the Actions UI). Once the artifact expires, re-run the build workflow on that commit.
- **Any release, anytime** — `-f release_tag=vX.Y.Z`. Release assets are durable, so a release built once stays redeployable indefinitely.

### Run (generate Bedrock traffic)

```bash
gh workflow run bedrock-simulator-run.yml \
  -f totalCalls=10 \
  -f guardrailRatio=0.2
gh run watch
```

The workflow builds the full-matrix payload (all 4 models × 3 services × 3 users) and invokes the Lambda once. The Lambda fans out `totalCalls` invocations and returns a structured response (see "Inspecting results" below).

Defaults are deliberately small (10 calls, 20% guardrail) — see [Cost guardrails](#cost-guardrails) before raising.

### Destroy

```bash
gh workflow run bedrock-simulator-destroy.yml \
  -f confirm="destroy bedrock-simulator"
gh run watch
```

Two-phase teardown:

1. `aws bedrock put-model-invocation-logging-configuration` with empty destinations — disables the account-level setting that pins the S3 bucket and log group in place.
2. `aws s3 rm s3://<bucket> --recursive` + abort any multipart uploads — empties the bucket so CFN can delete it.
3. `sam delete --no-prompts` — tears down the stack.

If step 3 lands in `DELETE_FAILED`, run [Recovery D](#recovery-d----delete_failed) by hand. If step 3 fails with `AccessDenied` on `s3:DeleteObject` against the `aws-sam-cli-managed-default-*` artifact bucket, the live deployer role is stale — see [Recovery G](#recovery-g--sam-delete-fails-with-accessdenied-on-s3deleteobject).

## Post-deploy verification

The deploy workflow runs three checks in order. Each gates the next.

### 2a — Stack-status assertion

```bash
aws cloudformation describe-stacks --stack-name bedrock-simulator \
  --query 'Stacks[0].StackStatus' --output text
```

Must be exactly `CREATE_COMPLETE` or `UPDATE_COMPLETE`. Anything else (including `ROLLBACK_COMPLETE`, `UPDATE_ROLLBACK_COMPLETE`, `CREATE_FAILED`) fails the workflow. On failure the workflow dumps:

```bash
aws cloudformation describe-stack-events --stack-name bedrock-simulator \
  --query 'StackEvents[?contains(ResourceStatus,`FAILED`)].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
  --output table
```

…and uploads the full event log as a workflow artifact.

### 2b — Resource existence

| Check | Command | Pass criterion |
|---|---|---|
| Lambda is `Active` | `aws lambda get-function --function-name "$LAMBDA_NAME"` | `Configuration.State == "Active"` and `Configuration.LastUpdateStatus == "Successful"` |
| Each inference profile is `ACTIVE` | `aws bedrock get-inference-profile --inference-profile-identifier "$ARN"` (×3) | `status == "ACTIVE"` |
| Guardrail is `READY` | `aws bedrock get-guardrail --guardrail-identifier "$GUARDRAIL_ID"` | `status == "READY"` |
| Logging destinations wired | `aws bedrock get-model-invocation-logging-configuration` | `loggingConfig.s3Config.s3BucketName` and `loggingConfig.cloudWatchConfig.logGroupName` match the stack's outputs |

Any failing check fails the workflow with a specific message naming which resource is wrong.

### 2c — Functional smoke test

```bash
aws lambda invoke \
  --function-name "$LAMBDA_NAME" \
  --payload '{"totalCalls":1,"models":["claude-haiku"],"services":["chat"],"users":["engineering"],"guardrailRatio":0}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/response.json
```

Pass criteria: `StatusCode == 200`; the response JSON has `summary.totalCalls == 1` and `summary.errored == 0`. Cost ~$0.001.

Failure causes (typical): first-time Anthropic use-case-details prompt not yet submitted (see Prereq #2), inference profile region mismatch, guardrail still provisioning. Re-running the workflow usually clears transient issues.

## Deploy/verify/fix sequence (Diagram 2)

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant CCD as Claude Code<br/>(/build-feature)
    participant Repo as GitHub repo
    participant GA as GitHub Actions<br/>(env: bedrock-simulator-sandbox)
    participant AWS as AWS sandbox account

    Dev->>CCD: /build-feature "change X"
    CCD->>CCD: Rule 70 TDD loop<br/>(tdd-test-engineer → typescript-developer → quality-reviewer)
    CCD->>Repo: Open draft PR with template + code changes
    Dev->>Repo: Review, merge to main
    Dev->>GA: workflow_dispatch bedrock-simulator-build.yml
    Note over GA: build touches no AWS — no Environment, no approval
    GA->>GA: gate (tests + lint) ‖ deps (audit blocks on vuln) → build → upload sam-build.tgz
    Dev->>GA: workflow_dispatch bedrock-simulator-deploy.yml (build_run_id / release_tag / latest)
    Note over GA: Required-reviewer protection from the GitHub Environment
    GA->>GA: download the chosen sam-build.tgz bundle
    GA->>AWS: sam deploy (prebuilt artifact)
    GA->>AWS: 2a describe-stacks (assert CREATE_COMPLETE)
    GA->>AWS: 2b resource-existence checks
    GA->>AWS: 2c smoke test (1 InvokeModel — Lambda assumes a SimUserRole)
    alt Deploy + verify succeed
        GA-->>Dev: ✓ Workflow green
    else Any check fails
        GA-->>Dev: ✗ Workflow red + artifact (CFN events + Lambda logs)
        Dev->>CCD: /build-feature with artifact as input
        Note over CCD,Dev: Loop back to the top
    end
```

The Lambda's per-call `AssumeRole` is the load-bearing detail for per-user attribution — without it, every CloudTrail event would carry the Lambda execution role's name and the dashboard's per-user breakdown would collapse to a single bucket.

## Inspecting results

Each run produces a structured Lambda response. The workflow surfaces `summary` in the job output; full results are in the artifact.

```jsonc
{
  "results": [
    {
      "user": "engineering",
      "service": "chat",
      "model": "claude-haiku",
      "status": "success",            // "success" | "error" | "guardrailBlocked"
      "inputTokens": 213,
      "outputTokens": 187,
      "guardrailIntervention": false,
      "errorCode": null,
      "errorMessage": null,
      "latencyMs": 1247
    }
    // ...one entry per call
  ],
  "summary": {
    "totalCalls": 10,
    "success": 8,
    "errored": 0,
    "guardrailBlocked": 2
  }
}
```

Per-call errors do not abort the run; one bad `(user, service, model)` triple appears as `status: "error"` with `errorCode` populated, and the rest still execute. `guardrailBlocked` counts entries where a guardrail intervention prevented the model from producing output.

To verify the five downstream signals (the whole point of the simulator), give CloudWatch ~5 minutes and Cost Explorer ~24 hours, then check:

```bash
# 1. CloudWatch invocation metrics
aws cloudwatch get-metric-statistics --namespace AWS/Bedrock \
  --metric-name InvocationCount \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 300 --statistics Sum --region us-east-1

# 2. CloudTrail per-user attribution
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=InvokeModel \
  --max-results 10 --region us-east-1 \
  --query 'Events[].[EventTime,Username]' --output table

# 3. Cost Explorer (next day)
aws ce get-cost-and-usage \
  --time-period "Start=$(date -u -d 'yesterday' +%Y-%m-%d),End=$(date -u +%Y-%m-%d)" \
  --granularity DAILY --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Bedrock"]}}'

# 4. Guardrail invocations — check the Bedrock console:
#    https://console.aws.amazon.com/bedrock/home?region=us-east-1#/guardrails

# 5. Invocation log payloads in S3
aws s3 ls s3://"$BUCKET_NAME"/AWSLogs/ --recursive | head -5

# 5b. Invocation log payloads in CloudWatch Logs
aws logs filter-log-events --log-group-name "$LOG_GROUP_NAME" --max-items 5
```

## Troubleshooting (runtime errors)

Per-call errors appear in the Lambda response's `results[]` with `errorCode` populated.

| Symptom | Likely cause | Fix |
|---|---|---|
| `AccessDeniedException` on `AssumeRole` | `SimUserRole-*` trust policy doesn't list `SimulatorLambdaRole`'s ARN | Re-deploy; trust is set in the template |
| `ValidationException: Invocation of model ID … with on-demand throughput isn't supported` | Model needs a cross-region wrapper, missing from `models.ts` | Add the `us.*` cross-region profile ID to `models.ts`; redeploy |
| `AccessDeniedException` on `InvokeModel` for a Claude model | First-time Anthropic invocation in a new account may require use case details | Follow the console link in the error response; re-run after submitting |
| `ThrottlingException` | Per-region Bedrock TPM/RPM limit | Lower `totalCalls` or request quota increase (see Prereq #3) |
| `guardrailIntervention: true`, `status: "guardrailBlocked"` | Call blocked by guardrail policy | Working as intended — the simulator's job is to produce these for the dashboard to display |
| Smoke test fails with `Cost is bounded by …` workflow error | `prompts.ts` has been edited and exceeds the ≤500 input-token cap | Shorten the prompt or revert; the cap is enforced by the build |

## Recovery procedures

The CloudFormation state machine (Diagram 3 below) shows which failure state maps to which procedure. Run these from an operator terminal with sandbox-account SSO credentials.

### Recovery A — `ROLLBACK_COMPLETE` after first-deploy failure

The most common gotcha. CloudFormation **does not** allow `UPDATE` on a stack in `ROLLBACK_COMPLETE` — fix-and-redeploy will fail with `ROLLBACK_COMPLETE state and can not be updated`. Delete the failed stack first.

```bash
# 1. Confirm the state
aws cloudformation describe-stacks --stack-name bedrock-simulator \
  --query 'Stacks[0].StackStatus' --output text

# 2. Read the failure reason
aws cloudformation describe-stack-events --stack-name bedrock-simulator \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table

# 3. Delete the failed stack
aws cloudformation delete-stack --stack-name bedrock-simulator
aws cloudformation wait stack-delete-complete --stack-name bedrock-simulator

# 4. Fix the root cause from step 2, re-run bedrock-simulator-build.yml, then
#    deploy that build. To get unblocked immediately, deploy a known-good
#    earlier build/release instead: bedrock-simulator-deploy.yml with
#    build_run_id=<prior-run> or release_tag=vX.Y.Z.
```

### Recovery B — `UPDATE_ROLLBACK_COMPLETE`

CloudFormation restored the previous good state. The stack is functional at its prior version; only the new change was rejected.

```bash
# 1. Confirm the state
aws cloudformation describe-stacks --stack-name bedrock-simulator \
  --query 'Stacks[0].StackStatus' --output text

# 2. Identify which resource update failed
aws cloudformation describe-stack-events --stack-name bedrock-simulator \
  --query 'StackEvents[?ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table

# 3. Fix the template change, re-run bedrock-simulator-build.yml, then deploy that
#    build — no delete needed. (Or roll back now: deploy build_run_id=<prior-run>
#    or release_tag=vX.Y.Z.)
```

### Recovery C — `UPDATE_ROLLBACK_FAILED`

CloudFormation could not even roll back. The stack is wedged.

```bash
# 1. Identify which resource(s) are stuck
aws cloudformation describe-stack-events --stack-name bedrock-simulator \
  --query 'StackEvents[?ResourceStatus==`UPDATE_ROLLBACK_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table

# 2. Skip the stuck resources and continue the rollback.
#    Only skip resources you have manually verified are safe to leave in their current state.
aws cloudformation continue-update-rollback --stack-name bedrock-simulator \
  --resources-to-skip <LogicalId1> <LogicalId2>

# 3. Wait, then re-deploy
aws cloudformation wait stack-update-rollback-complete --stack-name bedrock-simulator
```

### Recovery D — `DELETE_FAILED`

Almost always: the S3 logging bucket still has objects, or the Bedrock model-invocation-logging configuration still points at the (now-deleted) destinations.

```bash
# 1. Identify stuck resources
aws cloudformation describe-stack-events --stack-name bedrock-simulator \
  --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table

# 2. Empty the bucket (versioning is off, but multipart uploads may persist)
aws s3 rm s3://"$BUCKET_NAME" --recursive
aws s3api list-multipart-uploads --bucket "$BUCKET_NAME" \
  --query 'Uploads[].[Key,UploadId]' --output text \
  | while read -r key id; do
      aws s3api abort-multipart-upload --bucket "$BUCKET_NAME" --key "$key" --upload-id "$id";
    done

# 3. Disable model invocation logging if it still references stack resources
aws bedrock delete-model-invocation-logging-configuration

# 4. Retry the delete. Use --retain-resources ONLY when a specific resource
#    must be kept and removed manually outside CFN (rare).
aws cloudformation delete-stack --stack-name bedrock-simulator
aws cloudformation wait stack-delete-complete --stack-name bedrock-simulator
```

### Recovery E — Stuck `*_IN_PROGRESS`

A genuinely stuck operation (rare; usually a custom-resource Lambda timing out).

```bash
# Only valid during an in-progress UPDATE, not during CREATE:
aws cloudformation cancel-update-stack --stack-name bedrock-simulator
```

For `CREATE_IN_PROGRESS`, wait the full operation timeout (default 1h), then handle the resulting failure with Recovery A.

### Recovery F — Drift from template

Manual changes outside CloudFormation (e.g. an IAM policy edited by hand) make `sam deploy` behave unpredictably. Detect first, then decide.

```bash
aws cloudformation detect-stack-drift --stack-name bedrock-simulator
# Poll until detection completes:
aws cloudformation describe-stack-drift-detection-status --stack-drift-detection-id <id>
# Inspect drifted resources:
aws cloudformation describe-stack-resource-drifts --stack-name bedrock-simulator \
  --stack-resource-drift-status-filters MODIFIED DELETED
```

Decide whether to revert the manual change (preferred — CFN owns the resource) or update the template to match reality.

### Recovery G — `sam delete` fails with `AccessDenied` on `s3:DeleteObject`

```
Error: An error occurred (AccessDenied) when calling the DeleteObject operation:
User: …assumed-role/bedrock-simulator-deployer/GitHubActions is not authorized to
perform: s3:DeleteObject on resource:
"arn:aws:s3:::aws-sam-cli-managed-default-…samclisourcebucket-…/<key>"
```

The deployer role's inline permission policies are versioned in
[`.github/scripts/aws/iam/`](../../.github/scripts/aws/iam/), but the **live**
role in the sandbox account is only updated when the provisioning script is
re-run. If the policy JSON has gained permissions since the role was last
provisioned (here: `s3:DeleteObject`/`s3:DeleteObjectVersion` on the SAM-managed
artifact bucket, which `sam delete` needs to clean up its packaged artifacts),
the live role is stale and `sam delete` is denied on the final cleanup step —
even though the CloudFormation stack itself may already be deleted.

Re-provision the role to pick up the committed policy, then re-run the destroy
workflow. `aws iam put-role-policy` overwrites the inline policy in place, so
this is idempotent and safe to repeat:

```bash
# From an operator terminal with sandbox-account SSO credentials:
./.github/scripts/aws/create-bedrock-simulator-deployer-role.sh

# Then retry the teardown:
gh workflow run bedrock-simulator-destroy.yml -f confirm="destroy bedrock-simulator"
```

Any time the `iam/deployer-*.json` policies change, the live role must be
re-provisioned the same way (noted in [Step A](#step-a--create-the-deployer-role-one-time-local)).

## CFN state machine (Diagram 3)

```mermaid
stateDiagram-v2
    [*] --> CREATE_IN_PROGRESS: sam deploy (first time)
    CREATE_IN_PROGRESS --> CREATE_COMPLETE: success
    CREATE_IN_PROGRESS --> ROLLBACK_IN_PROGRESS: failure
    ROLLBACK_IN_PROGRESS --> ROLLBACK_COMPLETE: rollback OK
    ROLLBACK_COMPLETE --> [*]: Recovery A<br/>(delete-stack, retry)

    CREATE_COMPLETE --> UPDATE_IN_PROGRESS: sam deploy (subsequent)
    UPDATE_IN_PROGRESS --> UPDATE_COMPLETE: success
    UPDATE_IN_PROGRESS --> UPDATE_ROLLBACK_IN_PROGRESS: failure
    UPDATE_ROLLBACK_IN_PROGRESS --> UPDATE_ROLLBACK_COMPLETE: rollback OK
    UPDATE_ROLLBACK_IN_PROGRESS --> UPDATE_ROLLBACK_FAILED: rollback failed
    UPDATE_ROLLBACK_COMPLETE --> UPDATE_IN_PROGRESS: Recovery B<br/>(fix, redeploy)
    UPDATE_ROLLBACK_FAILED --> UPDATE_ROLLBACK_COMPLETE: Recovery C<br/>(continue-update-rollback)

    UPDATE_COMPLETE --> DELETE_IN_PROGRESS: bedrock-simulator-destroy.yml
    CREATE_COMPLETE --> DELETE_IN_PROGRESS: bedrock-simulator-destroy.yml
    DELETE_IN_PROGRESS --> DELETE_COMPLETE: success
    DELETE_IN_PROGRESS --> DELETE_FAILED: stuck resources
    DELETE_FAILED --> DELETE_IN_PROGRESS: Recovery D<br/>(empty bucket, disable MIL, retry)
    DELETE_COMPLETE --> [*]
```

## Cost guardrails

Per [Cost posture](../../CLAUDE.md), the paid resources here (Lambda, Bedrock calls, and optionally a KMS CMK) are accepted and documented, not hidden. These caps protect the sandbox account from surprise spend.

| Guardrail | Where |
|---|---|
| `totalCalls` capped at 50 by Zod schema | `handler.ts` (Rule 60.16) |
| `guardrailRatio` capped at 1.0 | `handler.ts` |
| Same caps validated again on workflow inputs | `bedrock-simulator-run.yml` |
| `SimulatorBudgetAlarm`: 80% forecast (~$8 projected) + 100% actual ($10 spent), monthly | Template; email comes from the `BUDGET_ALERT_EMAIL` GitHub Actions secret |
| Invocation-logging S3 lifecycle: 7-day expiration of current + noncurrent versions | Template |
| CloudWatch Logs retention: 7 days on both Lambda and invocation log groups | Template |
| `prompts.ts` ≤500 input tokens per fixture | Enforced by a Vitest test in `tests/` |
| `max_tokens` per profile: smoke=200, default=1000, heavy=2000 | `handler.ts` constants — heavy profile requires a code change to use |

Worked cost examples (per spec):

| Scenario | Cost |
|---|---|
| Smoke test in deploy workflow (1 Haiku call) | ~$0.001 |
| Default workflow run (10 calls, even split, 20% guardrail) | $0.05–$0.10 |
| Max workflow run (50 calls, same mix) | $0.25–$0.50 |
| Heavy Opus-only (requires code change) | $5–$10 |

Verify Bedrock pricing at https://aws.amazon.com/bedrock/pricing/ before raising any cap.

## On completion of a deploy

After the deploy workflow succeeds and `bedrock-simulator-run.yml` produces visible signals:

1. Confirm CLAUDE.md's "Out-of-scope tooling" section points at this guide and the spec.
2. Confirm `bedrock-simulator-*` workflows are visible in the GitHub Actions tab and require approval on dispatch (the GitHub Environment's required-reviewer protection).
3. Flag Prerequisite #6 (CloudTrail Bedrock data events) to the Phase 6 owner so the data-source assumption is explicit before the collector goes live.
4. Record the sandbox account ID and stack name in the team's runbook store — not in the repo. `samconfig.toml` stays gitignored.

Tear down with `bedrock-simulator-destroy.yml` when the dashboard's Phase 6 collector is running against real production traffic and the simulator no longer provides diagnostic value.
