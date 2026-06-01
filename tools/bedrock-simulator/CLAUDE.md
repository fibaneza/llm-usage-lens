# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this tool is

A standalone SAM/Lambda test harness deployed to a **dedicated AWS sandbox account**. It invokes real Amazon Bedrock models on demand and produces the CloudWatch metrics, CloudTrail events, Cost Explorer line items, Guardrail evaluations, and model-invocation-log payloads that the Phase 6 dashboard collector will ingest.

This tool is **not part of the dashboard's pnpm workspace** and **does not follow Phase discipline** (Rule 30). It has its own `package.json`, its own `pnpm-lock.yaml`, and is built and deployed independently.

- **Spec:** `docs/specs/2026-05-24-bedrock-simulator.md`
- **Operational runbook:** `docs/guides/bedrock-simulator.md`

## Commands

Run from `tools/bedrock-simulator/`.

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Install dependencies |
| `pnpm build` | Full pipeline: `tsc --noEmit` → esbuild → `sam build` |
| `pnpm typecheck` | Type-check only |
| `pnpm test` | Run all tests (Vitest) |
| `pnpm test -- tests/handler.test.ts` | Run a single test file |
| `pnpm sam:validate` | `sam validate --lint` |
| `pnpm sam:build` | `sam build` only (assumes `dist/` is current) |

**Build pipeline detail:** `pnpm build` chains three steps:
1. `tsc --noEmit` — type-check; fails fast before touching the filesystem
2. `node build.mjs` — esbuild bundles `src/*.ts` → `dist/*.mjs` (AWS SDK excluded; provided by the Lambda runtime)
3. `sam build` — copies `dist/` into `.aws-sam/` for packaging

`pnpm sam:build` is a convenience shortcut for when only `template.yaml` changed.

## Architecture

Two Lambda functions are deployed:

**`SimulatorLambda` (`src/handler.ts`)** — the main invocation fan-out function. It receives a JSON payload, picks random combinations of user/service/model per call, and invokes Bedrock. The function itself holds **no Bedrock permissions** — it assumes one of three `SimUserRoles` via STS for each call.

**`BedrockInvocationLoggingConfigFunction` (`src/invocation-logging-config.ts`)** — a CloudFormation custom resource Lambda that calls `PutModelInvocationLoggingConfiguration` on Create/Update and tears it down on Delete.

### Attribution model

The simulator produces three dimensions of attribution data:

- **User attribution:** The Lambda assumes `SimUserRole-engineering`, `SimUserRole-research`, or `SimUserRole-marketing`. CloudTrail records the role name in `userIdentity.sessionIssuer.userName`. This is how the dashboard gets per-user breakdowns.
- **Service attribution:** Three application inference profiles tagged `service=<name>` (chat / summarizer / translator). A call is routed through the matching profile only when the requested model matches the profile's wrapped model; otherwise it falls back to the direct model invoke ID. Either way, the per-model CloudWatch dimension is preserved.
- **Model attribution:** Resolved in `src/invoke.ts:resolveInvokeTarget` — uses the application inference profile ARN when the model/service pair matches; otherwise uses the `us.*` cross-region inference profile ID from env vars.

### Canonical model key mapping

Four canonical keys (`claude-opus`, `claude-sonnet`, `claude-haiku`, `other`) are defined in `src/models.ts`. Each maps to an env var (`CLAUDE_OPUS_INVOKE_ID`, etc.) set by the SAM template. **`claude-opus` deliberately maps to Sonnet in the default template** to keep simulator costs low — the spec documents this under "Cost expectations."

### Source layout

- `src/handler.ts` — Lambda entry point, Zod-validated input, invocation loop
- `src/invoke.ts` — STS assume-role, Bedrock `InvokeModel`, guardrail detection, token extraction
- `src/models.ts` — `CanonicalModelKey` enum and env-var resolver
- `src/profiles.ts` — `ServiceKey` / `UserKey` enums and env-var resolvers
- `src/prompts.ts` — synthetic prompt fixtures (safe + guardrail-tripping)
- `src/invocation-logging-config.ts` — CloudFormation custom resource handler

Tests mirror this layout under `tests/` (not colocated with `src/`).

## Key constraints

**`INTERNAL_PROFILE_OVERRIDE` in `handler.ts`** must remain `null` in committed code. Setting it to `"heavy"` (2000-token cap) is only for ad-hoc Opus cost testing and requires code review.

**`src/prompts.ts` is CODEOWNERS-protected.** Every change requires security-team review. The synthetic-data-only constraint applies: no real-looking PII. Guardrail-tripping fixtures must use documented test-pattern values (e.g., the GB29 NWBK… test IBAN). The token cap of 500 estimated input tokens per prompt must not be raised without coordinating with the spec's cost claims.

**Teardown is CI-only.** `sam delete`, `aws …delete-*`, and `cloudformation delete-stack` are blocked by `.claude/settings.json` in the parent repo. Tear the stack down only with the `bedrock-simulator-destroy.yml` workflow.

**Dedicated sandbox account required.** `PutModelInvocationLoggingConfiguration` is an account-level setting — deploying into a shared account would overwrite the existing logging config. See Risk #2 in the spec.

## Local deploy loop

```bash
# Authenticate (no static keys — Rule 50).
aws sso login
export AWS_PROFILE=<your-sandbox-profile>

# First time: create a deploy config from the example.
cp samconfig.toml.example samconfig.toml   # fill in placeholders

# Build and deploy.
pnpm install --frozen-lockfile
pnpm build
sam deploy
```

Minimal loop after editing `src/`:

```bash
pnpm build && sam deploy
```

The canonical deploy path is GitHub Actions (`bedrock-simulator-deploy.yml`), which holds AWS credentials via OIDC. All four simulator workflows are `workflow_dispatch` only and bound to the `bedrock-simulator-sandbox` GitHub Environment.

## Git hooks

A `pre-push` hook at `.hooks/pre-push` runs `pnpm typecheck`, `pnpm test`, and a secret scan for simulator-related commits. Install once:

```bash
pnpm hooks:install
```

Remove when Phase 1 Husky is wired up (Husky sets `core.hooksPath` and the installed hook becomes inactive anyway).
