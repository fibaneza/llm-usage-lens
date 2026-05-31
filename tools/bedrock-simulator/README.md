# bedrock-simulator

Standalone Amazon Bedrock test harness. It deploys to a dedicated AWS **sandbox**
account, invokes real Bedrock models on a schedule, and generates the CloudWatch /
CloudTrail / Cost Explorer / Guardrail / model-invocation-log signals the Phase 6
collector eventually ingests.

> **Not part of the dashboard.** This tool is **not** in the pnpm workspace (it has
> its own `package.json` and `pnpm-lock.yaml`) and does **not** follow the
> dashboard's phase discipline ([Rule 30](../../.claude/rules/30-phase-discipline.md)).
> Build and deploy it independently.

- **Spec:** [`docs/specs/2026-05-24-bedrock-simulator.md`](../../docs/specs/2026-05-24-bedrock-simulator.md)
- **Operational runbook (CI deploy / run / destroy, recovery):** [`docs/guides/bedrock-simulator.md`](../../docs/guides/bedrock-simulator.md)

## GitHub workflows

All `workflow_dispatch` only. `deploy` / `run` / `destroy` are bound to the
`bedrock-simulator-sandbox` GitHub Environment (required-reviewer protection);
`build` holds no AWS credentials and is unbound.

| Workflow | Purpose |
|---|---|
| [`bedrock-simulator-build.yml`](../../.github/workflows/bedrock-simulator-build.yml) | Gate (typecheck + tests + `sam validate`), then `pnpm build` → `sam build`, package `.aws-sam/` as a reusable artifact. |
| [`bedrock-simulator-deploy.yml`](../../.github/workflows/bedrock-simulator-deploy.yml) | Deploy a previously built artifact (by run id or release tag); post-deploy stack-status + resource + smoke checks. |
| [`bedrock-simulator-run.yml`](../../.github/workflows/bedrock-simulator-run.yml) | Invoke the deployed Lambda once with operator-chosen `totalCalls` / `guardrailRatio`. |
| [`bedrock-simulator-destroy.yml`](../../.github/workflows/bedrock-simulator-destroy.yml) | Empty the logging bucket, disable model invocation logging, then `sam delete`. |

## Scripts

Run from `tools/bedrock-simulator/`. None of these touch AWS except `sam deploy`.

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Install dependencies against the committed lockfile |
| `pnpm build` | **The actual build:** `tsc --noEmit` type-check, then esbuild bundles `src/*.ts` → `dist/*.mjs` |
| `pnpm typecheck` | Type-check only (`tsc --noEmit`) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm sam:validate` | `sam validate --lint` |
| `pnpm sam:build` | `sam build` — **packages `dist/` only; does not transpile** |

## Build before you package — `sam build` does not transpile

The SAM template points both Lambdas at the **pre-built** bundle:

```yaml
CodeUri: dist/
Runtime: nodejs22.x
```

There is **no `Metadata: BuildMethod`** on the functions, so `sam build` simply
copies `dist/` into `.aws-sam/`. It does **not** run `tsc`, does **not** run
esbuild, and does **not** run any `package.json` script. If `dist/` is missing or
stale, the Lambdas ship raw/old code and fail at runtime with
`Cannot find module`.

Therefore **`pnpm build` must run before `sam build`** — locally and in CI alike
(`.github/workflows/bedrock-simulator-build.yml` enforces the same order).

Re-run `pnpm build` after **every** change to `src/` — `sam build` will not notice
stale `dist/`.

> `sam build` *can* transpile TypeScript via `Metadata: BuildMethod: esbuild`, but
> that path was deliberately removed: it fails to resolve esbuild under pnpm's
> symlinked layout, duplicates the esbuild flags into the template, and skips the
> `tsc` type-check. Keeping one `pnpm build` script as the single source of truth
> avoids all three.

## Local build & deploy loop

The **canonical** deploy path is GitHub Actions (see the
[guide](../../docs/guides/bedrock-simulator.md)) — it holds AWS credentials via
OIDC and is how the shared sandbox is deployed. For fast iteration against your
**own** sandbox account you can build and deploy from your shell:

```bash
cd tools/bedrock-simulator

# 1. Authenticate to the sandbox account (no static keys — Rule 50).
aws sso login
export AWS_PROFILE=<your-sandbox-profile>   # account in us-east-1

# 2. First time only: create a deploy config from the example.
cp samconfig.toml.example samconfig.toml    # then edit stack name / params
#   (account-specific samconfig.*.toml variants are gitignored)

# 3. Build → package → deploy.
pnpm install --frozen-lockfile   # only if deps aren't installed
pnpm build                       # tsc + esbuild → dist/   ← the actual build
sam build                        # copies dist/ → .aws-sam/
sam deploy                       # reads samconfig.toml (use --guided the first time)
```

The minimal loop after editing `src/`:

```bash
pnpm build && sam build && sam deploy
```

**Credentials:** only `sam deploy` needs them; `pnpm build` and `sam build` run
offline.

**Teardown is CI-only.** `.claude/settings.json` denies `sam delete`,
`aws …delete-*`, and `cloudformation delete-stack` from local shells — tear the
stack down with `bedrock-simulator-destroy.yml` (see the guide). `sam build` and
`sam deploy` are not blocked.
