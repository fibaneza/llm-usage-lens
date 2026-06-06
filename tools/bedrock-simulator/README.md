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
| [`bedrock-simulator-build.yml`](../../.github/workflows/bedrock-simulator-build.yml) | Gate (typecheck + tests + `sam validate`), then `pnpm build` (type-check + bundle + sam build), package `.aws-sam/` as a reusable artifact. |
| [`bedrock-simulator-deploy.yml`](../../.github/workflows/bedrock-simulator-deploy.yml) | Deploy a previously built artifact (by run id or release tag); post-deploy stack-status + resource + smoke checks. |
| [`bedrock-simulator-run.yml`](../../.github/workflows/bedrock-simulator-run.yml) | Invoke the deployed Lambda once with operator-chosen `totalCalls` / `guardrailRatio`. |
| [`bedrock-simulator-destroy.yml`](../../.github/workflows/bedrock-simulator-destroy.yml) | Empty the logging bucket, disable model invocation logging, then `sam delete`. |

## Scripts

Run from `tools/bedrock-simulator/`. None of these touch AWS except `sam deploy`.

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Install dependencies against the committed lockfile |
| `pnpm build` | **Full pipeline:** `tsc --noEmit` type-check → esbuild bundles `src/*.ts` → `dist/*.mjs` → `sam build` packages `dist/` into `.aws-sam/` |
| `pnpm typecheck` | Type-check only (`tsc --noEmit`) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm sam:validate` | `sam validate --lint` |
| `pnpm sam:build` | `sam build` — **packages `dist/` only; does not transpile** |

## How the build works

`pnpm build` chains three steps in sequence:

1. **`tsc --noEmit`** — type-check; fails fast before touching the filesystem.
2. **`node build.mjs`** — esbuild bundles `src/*.ts` → `dist/*.mjs` (AWS SDK excluded; provided by the Lambda runtime).
3. **`sam build`** — copies `dist/` into `.aws-sam/` for packaging.

The SAM template uses `CodeUri: dist/` with no `Metadata: BuildMethod`, so `sam build` only copies the pre-built bundle — it does not transpile. `pnpm build` is the single entry point: run it after every `src/` change.

`pnpm sam:build` is kept as a convenience for cases where `dist/` is already current and only the SAM template changed.

## Git hooks

A `pre-push` hook in `.hooks/pre-push` runs `pnpm typecheck`, `pnpm test`, and a
secret scan whenever simulator files are in the commits being pushed. It is a
no-op for pushes that touch other paths only.

**Install once** (from `tools/bedrock-simulator/`):

```bash
pnpm hooks:install
```

**Remove** when Phase 1's Husky setup is wired up — Husky sets `core.hooksPath`
to `.husky/`, which bypasses `.git/hooks/` entirely, so the installed hook
becomes inactive anyway. Husky's `pre-push` will incorporate the simulator check.

```bash
pnpm hooks:uninstall
```

See [`docs/guides/git-hooks.md`](../../docs/guides/git-hooks.md) for the full
hooks strategy, secret detection approach, and the Phase 1 Husky plan.

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

# 2b. To deploy via GitHub Actions, create the pipeline OIDC deployer role once
#     (a PIPELINE concern, separate from this app bootstrap). The wrapper feeds
#     this app's role name, workflow pins, and iam/deployer-*.json policies to the
#     project-generic .github/scripts/aws/lib/create-deployer-role.sh, reading config
#     from .github/scripts/aws/.env. Not needed for the local `sam deploy` below.
(cd "$(git rev-parse --show-toplevel)" && \
  ./.github/scripts/aws/create-bedrock-simulator-deployer-role.sh)

# 3. Build → package → deploy.
pnpm install --frozen-lockfile   # only if deps aren't installed
pnpm build                       # tsc + esbuild → dist/ + sam build → .aws-sam/
sam deploy                       # reads samconfig.toml (use --guided the first time)
```

The minimal loop after editing `src/`:

```bash
pnpm build && sam deploy
```

**Credentials:** only `sam deploy` needs them; `pnpm build` (including the chained `sam build`) runs offline.

**Teardown is CI-only.** `.claude/settings.json` denies `sam delete`,
`aws …delete-*`, and `cloudformation delete-stack` from local shells — tear the
stack down with `bedrock-simulator-destroy.yml` (see the guide). `sam build` and
`sam deploy` are not blocked.
