# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Current phase progress is not recorded here — run `/phase-status`, which checks the task and Verify checkboxes in [`docs/specs/2026-05-15-implementation-phases.md`](docs/specs/2026-05-15-implementation-phases.md) against the repo and `git log`.

Supporting infrastructure is in place and active — the devcontainer, the OpenTelemetry/Prometheus/Loki/Grafana observability stack, the `.claude/` rules + agents + commands, the `.mcp.json` config (Azure MCP), the repo-root quality config (`commitlint.config.cjs`, `.gitleaks.toml`, `.editorconfig`, `.gitattributes`), the Husky hooks (see [`docs/guides/git-hooks.md`](docs/guides/git-hooks.md)), and the headless Playwright E2E harness (`apps/dashboard/playwright.config.ts` + `apps/dashboard/e2e/`). Treat all of this as ready; do not rebuild it from scratch.

## Reading order

If you're about to touch code, read in this order:

1. `docs/specs/2026-05-15-implementation-phases.md` — confirms which phase the work belongs to and what its Verify checklist requires.
2. The spec matching your task (see index below).
3. The numbered rule(s) in `.claude/rules/` that govern the area you're editing.

The `docs/specs/` directory is the source of truth:

- `docs/specs/2026-05-15-system-architecture.md` — AWS serverless pipeline, account layout, data sources, Lambda collector flow
- `docs/specs/2026-05-15-data-model.md` — DynamoDB single-table design, entities, access patterns, model ID normalization
- `docs/specs/2026-05-15-design-system.md` — tech stack, visual design, component inventory, performance patterns
- `docs/specs/2026-05-15-implementation-phases.md` — the build plan: Phases 1–6, plus Phase 4R (access & platform) and the LiteLLM units (L0–L8); each phase independently testable
- `docs/specs/2026-11-10-access-control.md` — roles from Entra ID, scopes, membership, visibility, audit log, threat model (Phase 4R)
- `docs/specs/2026-11-10-platform.md` — AWS ECS Fargate hosting and the CDK stacks (Phase 4R.P)
- `docs/specs/2026-11-10-litellm.md` — LiteLLM team/user administration, the gateway allowlist, service key, LiteLLM-reported cost (LiteLLM units L0–L8); contract snapshot in `docs/litellm/`
- `docs/guides/auth-setup.md` — Auth.js + Microsoft Entra ID and AWS credential setup
- `docs/guides/aws-infrastructure.md` — operational runbook: collector design, SAM deploy/undeploy CLI
- `docs/guides/dashboard-deployment.md` — operational runbook: building and deploying the dashboard on ECS Fargate (CDK inputs, `cdk synth`, user-run deploy, DNS)
- `docs/guides/operations.md` — operations runbook: alarms, redeploy, secret rotation, deploy/undeploy order
- `docs/guides/litellm-admin.md` — LiteLLM runbook: service user and key, `allowed_routes`, SSM, connection, rotation
- `docs/guides/dynamic-workflows.md` — where Opus 4.8 dynamic workflows fit (and don't fit) the phase plan; piloted per implementation-phases — *Workflow pilots*
- `docs/guides/github-best-practices.md` — general GitHub/Actions practice reconciled to this project's GitHub Flow, SAM, and pnpm conventions
- `docs/guides/git-hooks.md` — local git-hook strategy: the current simulator pre-push hook and the Phase 1 Husky suite that supersedes it
- `docs/guides/testing.md` — Vitest layout (unit / integration / infra projects), where a test goes, the `apps/dashboard/test/` folders, how to run one project or file, coverage
- `docs/guides/learning-path.md` — guided, phase-by-phase walk-through of the whole build (lesson + tracker); start here if you're new to the project

Not in the reading path above, but worth knowing they exist:

- `docs/future-improvements.md` — the parking lot of intentionally-deferred enhancements, each with the trigger that would revisit it; per Rule 00, adopting any starts with a spec change, not a PR
- `ONBOARDING.md` — new-contributor setup checklist (codebases, MCP servers, skills to know)
- `prompts/` — the prompts behind the guarded, agent-driven build runs (worker and coordinator sessions); [`prompts/README.md`](prompts/README.md) is the index
- `poc/` — an isolated proof of concept that runs the dashboard image on one EC2 instance with Docker Compose; **not** the deployment path and not in the pnpm workspace ([`poc/README.md`](poc/README.md))
- `docs/superpowers/` — the design spec + implementation plan for the already-shipped `/new-component` command; kept for provenance, not active guidance

Build strictly in phase order (Rule 30 has the order and its decided exceptions). Phase 2 (2.1–2.3), Phase 3 (3.1–3.3), Phase 4 (4.1–4.9), Phase 4R (RP, R1–R5) and the LiteLLM units (L0–L8, with L3b and L3c) are each split into independently deliverable sub-phases — one per branch and squash commit (Rule 30.4); Phase 4's are one per dashboard page. Components are built where first needed and reused later.

Project-specific Claude Code customization lives under `.claude/`:
- **Rules** — `.claude/rules/` (numbered `00`–`70`; always loaded)
- **Slash commands** — `.claude/commands/` (see table below)
- **Agents** — `.claude/agents/` — see Rule 70
- **Hooks** — `.claude/hooks/`, wired in `.claude/settings.json`: `session-start.sh` (installs dependencies), `server-only-guard.sh` (blocks a Rule 10 violation when a `"use client"` file is written), `prettier-on-edit.sh` (formats after an edit)

## What This Project Is

Two deliverables (plus the platform IaC) in a **pnpm monorepo** (`apps/*`, `packages/*`, `infra`), sharing `packages/shared` (Zod schemas, model normalization, price table):

1. **Next.js dashboard** (`apps/dashboard`) — reads aggregated Bedrock cost/usage from DynamoDB and displays the 9 Phase 4 pages, plus the role-based access management in Settings (Phase 4R), the LiteLLM page and Settings panel (LiteLLM units) and the account page. Built first (Phases 1–5), developed against **DynamoDB Local**.
2. **AWS Lambda collector** (`apps/collector`, `bedrock-cost-collector`) — serverless hourly pipeline that collects real Bedrock data and writes to DynamoDB. Built last (Phase 6); the directory does not exist until then.

The dashboard's AWS platform (ECS Fargate, FoundationStack + DashboardServiceStack) is a CDK app in `infra/` (`@llm-usage-lens/infra`; [Platform spec](docs/specs/2026-11-10-platform.md)). Deploying is always a user action.

## Cost posture

Keep AWS spend as low as possible — prefer free-tier and no-cost resources where
they do the job (self-hosted OpenTelemetry/Grafana over paid SaaS, DynamoDB Local
in dev, Grafana Cloud's free tier in production). But the project unavoidably
deploys some paid resources (KMS CMK, Lambda, Bedrock on-demand calls, DynamoDB),
and that cost is **accepted, not avoided**. This is a guiding principle, **not a
strict rule**: document a cost where it is introduced (e.g. the simulator spec's
["Cost expectations"](docs/specs/2026-05-24-bedrock-simulator.md)) rather than
incurring it silently.

"Touches no AWS" / "non-AWS" (e.g. the bedrock-simulator build workflow) is about
**credentials and access** — the workflow holds no AWS credentials — and never
means "free of cost."

## Commands

Package manager is **pnpm** (run via `corepack pnpm` if `pnpm` is not on PATH). The root `package.json` (Phase 1) defines the canonical scripts; run them from the repo root.

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server (`apps/dashboard`) |
| `pnpm build` | `next build` |
| `pnpm build:ci` | `pnpm build` with non-secret placeholder auth/env values so env validation still runs (what the CI build job runs) |
| `pnpm check` | Full local gate, stopping at the first failure: `typecheck`, `lint`, `format:check`, `vitest run` (all three projects; DynamoDB Local on `:8000`), `build:ci`, then the bundle scan (`lib/litellm/bundle-output.test.ts` with `REQUIRE_BUILD_OUTPUT=1` — the LiteLLM service key must not reach `.next/static`) — the pre-merge gate in Rule 31 |
| `pnpm format:check` | Prettier format check (`pnpm format` to write) |
| `pnpm lint` | ESLint v9 flat config (`eslint.config.ts`) |
| `pnpm typecheck` | `tsc --noEmit` across every workspace (`pnpm -r --if-present typecheck`) plus `tsc -p tsconfig.scripts.json` for `scripts/` |
| `pnpm test` | Unit + integration + infra tests (**Vitest**, not Jest) — root `vitest.config.ts` with three projects; the integration project needs DynamoDB Local on `:8000`; excludes `e2e/` and `tools/` ([testing guide](docs/guides/testing.md)) |
| `pnpm test:unit` | Unit + component tests only (`vitest run --project unit`, jsdom; no DynamoDB needed) |
| `pnpm test:integration` | Data-access integration tests against DynamoDB Local (`vitest run --project integration`) |
| `pnpm test:infra` | CDK stack tests (`vitest run --project infra`, node) |
| `pnpm test:coverage` | All three projects with v8 coverage into `coverage/`; measured, no threshold ([testing guide](docs/guides/testing.md)) |
| `pnpm db:create-table` | Create the `bedrock-usage` table in DynamoDB Local (idempotent) |
| `pnpm db:seed` / `db:seed:empty` / `db:seed:large` / `db:seed:ranking` | Load seed data (`seed:empty` resets the table first) |
| `pnpm exec vitest run path/to/file.test.ts` | Run a single test file |
| `pnpm --filter @llm-usage-lens/infra synth` | `cdk synth` the platform stacks (needs the CDK context; see the deployment guide; never deploys) |
| `pnpm test:e2e` | Headless Playwright E2E in `apps/dashboard/e2e/` (smoke specs accrue with UI work; full journeys Phase 5) |

DynamoDB Local (Phase 3.2): `docker compose up -d dynamodb-local` (inside `.devcontainer`; from the host use `docker compose -f .devcontainer/docker-compose.yml up -d dynamodb-local`), then `pnpm db:create-table` and `pnpm db:seed` (variants `db:seed:empty` / `db:seed:large` / `db:seed:ranking`). The scripts default to `http://localhost:8000` and must never target real AWS. The `/seed` slash command wraps this flow. See the [README](README.md) for the macOS volume workaround.

**Git hooks (Husky).** Pre-commit: gitleaks (or grep fallback) secret scan + `lint-staged` (ESLint fix + Prettier on staged files). Commit-msg: `commitlint` (Conventional Commits). Pre-push: when `apps/`/`packages/`/`scripts/`/`infra/`/`tsconfig.scripts.json` change, runs `pnpm typecheck` + `pnpm exec vitest run --project unit --project infra --passWithNoTests` (integration tests run in CI and via `pnpm test`); when `tools/bedrock-simulator/` changes, runs that workspace's typecheck + tests; then a gitleaks scan of the pushed range (skipped with a notice if gitleaks is not installed). Never bypass with `--no-verify` (Rule 50.5).

## Slash commands

| Command | Purpose |
|---|---|
| `/build-feature <description>` | Run the tdd-test-engineer → typescript-developer → quality-reviewer TDD agent loop for a feature |
| `/lint` | Run prettier + eslint + tsc + vitest sequentially |
| `/ui-review` | Run the headless Playwright UI suite and audit e2e coverage of changed components |
| `/seed [empty\|large\|ranking]` | Bring up DynamoDB Local and load seed data |
| `/new-route <path>` | Scaffold a Route Handler with all required boilerplate |
| `/new-data-access <description>` | Scaffold a server-only data-access function |
| `/new-component <variant> <group> <Name>` | Scaffold a dashboard component (display/interactive/chart) |
| `/phase-status` | Report current phase progress |
| `/verify-phase <n>` | Run the spec's Verify checklist for a phase |
| `/start-phase <n>` | Expand a phase into an ordered TODO list |
| `/spec <topic>` | Load and summarise a spec or guide |
| `/commit` | Stage and commit with Conventional Commits |
| `/obsidian-sync` | Sync `.claude/` Markdown to an Obsidian vault via the Obsidian MCP |

## CI & PR automation

GitHub-side automation lives in `.github/`; [`.github/ACTIONS.md`](.github/ACTIONS.md)
is the source of truth — read it before touching any workflow.

| Workflow | Trigger | Purpose |
|---|---|---|
| `llm-usage-lens-build.yml` | push to `main`; pull request | Dashboard CI: `quality` (lint, format, typecheck, gitleaks), `test` (all three Vitest projects against a DynamoDB Local service), `build` (`pnpm build:ci`), `e2e` (Playwright, both projects, production servers, against DynamoDB Local), `e2e-dev` (the dev-login specs on `next dev`) |
| `llm-usage-lens-deploy.yml` | `workflow_dispatch` (user action) | Builds the dashboard image, pushes it to ECR via OIDC and deploys the DashboardServiceStack only |
| `claude-pr-review.yml` | PR opened / synchronize / ready / reopened | Inline review + security findings; HIGH findings submit a `REQUEST_CHANGES` review |
| `claude-code-review.yml` | release tag push / `workflow_dispatch` | Release audit scoped to commits since the previous tag; files issues |
| `github-pr-title-lint.yml` | PR opened / edited / reopened | Conventional-Commits check on the PR title (the squash-merge commit on `main`) |
| `claude-assistant.yml` | `@claude` mention | On-demand reactive bot |
| `github-sync-labels.yml` | push to `main` touching the label definitions or the workflow; `workflow_dispatch` | Syncs the repository labels (create/update only, never deletes) |

The five `bedrock-simulator-*.yml` workflows (build, deps, deploy, run, destroy) belong to the standalone simulator (see *Out-of-scope tooling*) and are documented in `.github/ACTIONS.md`.

Reusable logic is factored into composite actions (`.github/actions/`) and
scripts (`.github/scripts/claude/`).

Two non-obvious constraints:
- **Workflow-editing PRs can't self-approve.** `claude-code-action` refuses to
  run on a PR that modifies the review workflow; the check only passes once the
  change is on `main`.
- **Branch protection is not enforced** on the current free private repo.
  Work lands as local squash-merges into `main` that the user pushes
  ([Rule 31](.claude/rules/31-github-flow.md)), so PR-only checks run only on
  the optional PR path; CI (`llm-usage-lens-build.yml`) runs on every push to `main` and on every pull request.

## Local development environment

A devcontainer (`.devcontainer/`) bundles an observability stack alongside the app:

| Service | Port | Purpose |
|---|---|---|
| Next.js / app | 3000 | Dashboard dev server |
| OpenTelemetry Collector | 4317/4318 | OTLP ingest (gRPC/HTTP) |
| Prometheus | 9090 | Metrics storage |
| Loki | 3100 | Logs/events storage |
| Grafana | 3001 | Dashboards for metrics + logs |
| DynamoDB Local | 8000 | Dashboard's data store in dev (started on demand) |

`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` are set in the compose file. Running the `claude` CLI inside the devcontainer auto-exports Claude Code telemetry (sessions, token/cost metrics, prompt/tool/API events) to the collector — metrics land in Prometheus, events in Loki. DynamoDB Local is a separate service started with `/seed` or `docker compose up -d dynamodb-local` (from the host: `docker compose -f .devcontainer/docker-compose.yml up -d dynamodb-local`).

MCP servers are configured in `.mcp.json` at the repo root (currently: Azure MCP via `@azure/mcp`). Add new MCP servers there rather than to per-user Claude Code settings so the whole team gets them.

The repo-root `temp/` directory is **local scratch** — design exports, screenshots, and throwaway working files. It is gitignored and **must never be committed or pushed**. Do not `git add` anything under `temp/`. When something in `temp/` is worth keeping (e.g. a vendored design reference), promote a curated copy into `docs/` instead — as was done for the Strata design system at [`docs/design-system/`](docs/design-system/README.md).

The project's default response voice is the **`spec-cited` output style** (`.claude/output-styles/spec-cited.md`): brief, impersonal, no emoji, citing `docs/specs/**` for non-trivial decisions and rendering file references as workspace-relative Markdown links.

`.claude/settings.json` hard-blocks destructive commands via its `deny` list — `rm -rf`, `git push --force`, `git reset --hard`, `git commit --no-verify`, and all `aws … delete-*` / `aws dynamodb delete-table` / `aws cloudformation delete-stack` / `sam delete`. These will be refused regardless of permission mode; don't attempt to route around them.

## Out-of-scope tooling

`tools/bedrock-simulator/` is a **standalone test harness**, not part of the dashboard project. It deploys to a dedicated AWS sandbox account, invokes real Amazon Bedrock models on demand, and generates the CloudWatch / CloudTrail / Cost Explorer / Guardrail / model-invocation-log signals the Phase 6 collector eventually ingests.

- It is **not in the pnpm workspace** (separate `tools/bedrock-simulator/package.json`).
- It does **not participate in `.claude/rules/30-phase-discipline.md`** — build it independently of the dashboard's phase order.
- Deploy / run / destroy are GitHub Actions workflows (`workflow_dispatch` only). The `.claude/settings.json` deny list blocks `sam delete` and `aws *delete-*` from Claude Code — these run from the workflow, not from the local Claude session.
- Spec: [`docs/specs/2026-05-24-bedrock-simulator.md`](docs/specs/2026-05-24-bedrock-simulator.md). Operational guide: [`docs/guides/bedrock-simulator.md`](docs/guides/bedrock-simulator.md).

## Architecture & conventions

Detailed conventions live in `.claude/rules/` (numbered `00`–`70`, always loaded) and in `docs/specs/`. CLAUDE.md does not restate them — read the relevant rule and spec before writing code:

- **Rule 00** — specs are the source of truth; cite the spec for non-trivial decisions
- **Rule 10** — server-only data boundary (DynamoDB and the AWS SDK in server code only)
- **Rule 20** — data model conventions (single table, model-first rollups, UTC, cost provenance)
- **Rule 30** — phase discipline (strict build order)
- **Rule 31** — GitHub Flow (branching strategy, squash-merge, release tagging)
- **Rule 40** — design system & stack (light mode default, no raw hex, lazy-loaded charts)
- **Rule 50** — security & secrets (two credential concerns, no static AWS keys)
- **Rule 60** — coding standards (TypeScript strict, validate at the boundary, Vitest; a new Route Handler registers in `apps/dashboard/test/route-registry.ts`, which the shared route-contract suite iterates — Rule 60.23)
- **Rule 70** — tdd-test-engineer → typescript-developer → quality-reviewer TDD agent workflow
