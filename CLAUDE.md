# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Phases 1–2 are **complete**: the pnpm monorepo toolchain (Phase 1) and the dashboard layout shell — sidebar nav, top bar, date-range filter, sync status, command menu — with placeholder pages for every route (Phase 2). Phase 3 (Data Layer: DynamoDB Local, `lib/dynamodb.ts`, `lib/data/**`, seed scripts) is next; run `/phase-status` to confirm before starting work.

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
- `docs/specs/2026-05-15-implementation-phases.md` — 6-phase build plan; each phase independently testable
- `docs/guides/auth-setup.md` — Auth.js + Microsoft Entra ID and AWS credential setup
- `docs/guides/aws-infrastructure.md` — operational runbook: collector design, SAM deploy/undeploy CLI
- `docs/guides/dashboard-deployment.md` — operational runbook: Next.js dashboard on Netlify, deploy/undeploy CLI
- `docs/guides/dynamic-workflows.md` — where Opus 4.8 dynamic workflows fit (and don't fit) the phase plan; not adopted in v1
- `docs/guides/github-best-practices.md` — general GitHub/Actions practice reconciled to this project's GitHub Flow, SAM, and pnpm conventions
- `docs/guides/git-hooks.md` — local git-hook strategy: the current simulator pre-push hook and the Phase 1 Husky suite that supersedes it
- `docs/guides/learning-path.md` — guided, phase-by-phase walk-through of the whole build (lesson + tracker); start here if you're new to the project

Not in the reading path above, but worth knowing they exist:

- `docs/future-improvements.md` — the parking lot of intentionally-deferred enhancements, each with the trigger that would revisit it; per Rule 00, adopting any starts with a spec change, not a PR
- `ONBOARDING.md` — new-contributor setup checklist (codebases, MCP servers, skills to know)
- `docs/superpowers/` — the design spec + implementation plan for the already-shipped `/new-component` command; kept for provenance, not active guidance

Build strictly in phase order (see implementation-phases spec). Phase 4 has 9 sub-phases, one per dashboard page; components are built where first needed and reused later.

Project-specific Claude Code customization lives under `.claude/`:
- **Rules** — `.claude/rules/` (numbered `00`–`70`; always loaded)
- **Slash commands** — `.claude/commands/` (see table below)
- **Agents** — `.claude/agents/` — see Rule 70

## What This Project Is

Two deliverables in a **pnpm monorepo**, sharing `packages/shared` (Zod schemas, model normalization, price table):

1. **Next.js dashboard** (`apps/dashboard`) — reads aggregated Bedrock cost/usage from DynamoDB, displays 9 pages. Built first (Phases 1–5), developed against **DynamoDB Local**.
2. **AWS Lambda collector** (`apps/collector`, `bedrock-cost-collector`) — serverless hourly pipeline that collects real Bedrock data and writes to DynamoDB. Built last (Phase 6).

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

> The `pnpm <script>` shortcuts (`pnpm dev`, `pnpm build`) require a `package.json` and don't exist until Phase 1. The `pnpm exec …` forms below are runnable as soon as dependencies are installed.

Package manager is **pnpm**.

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | `next build` |
| `pnpm exec prettier --check .` | Format check |
| `pnpm exec eslint .` | Lint (ESLint v9 flat config, `eslint.config.ts`) |
| `pnpm exec tsc --noEmit` | Type check (also the pre-push hook) |
| `pnpm exec vitest run` | Unit + component tests (**Vitest**, not Jest) |
| `pnpm exec vitest run path/to/file.test.ts` | Run a single test file |
| `pnpm test:e2e` | Headless Playwright E2E (smoke specs accrue with UI work; full journeys Phase 5) |
| `docker compose up -d dynamodb-local` | Start DynamoDB Local |
| `pnpm tsx scripts/create-table.ts` | Create the DynamoDB table (idempotent) |
| `pnpm tsx scripts/seed.ts` | Seed realistic data |
| `pnpm tsx scripts/seed-empty.ts` | Seed empty state |
| `pnpm tsx scripts/seed-large.ts` | Seed large dataset |
| `pnpm tsx scripts/seed-ranking.ts` | Seed ranking-focused dataset (optional) |

Pre-commit (Husky + lint-staged): ESLint fix + Prettier on staged files, plus gitleaks secret scan. Commits must follow Conventional Commits (commitlint).

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

GitHub-side automation lives in `.github/`; [`.github/README.md`](.github/README.md)
is the source of truth — read it before touching any workflow.

| Workflow | Trigger | Purpose |
|---|---|---|
| `claude-pr-review.yml` | PR opened / synchronize / ready / reopened | Inline review + security findings; HIGH findings submit a `REQUEST_CHANGES` review |
| `claude-code-review.yml` | release tag push / `workflow_dispatch` | Release audit scoped to commits since the previous tag; files issues |
| `pr-title-lint.yml` | PR opened / edited / reopened | Conventional-Commits check on the PR title (the squash-merge commit on `main`) |
| `claude-assistant.yml` | `@claude` mention | On-demand reactive bot |

Reusable logic is factored into composite actions (`.github/actions/`) and
scripts (`.github/scripts/claude/`).

Two non-obvious constraints:
- **Workflow-editing PRs can't self-approve.** `claude-code-action` refuses to
  run on a PR that modifies the review workflow; the check only passes once the
  change is on `main`.
- **Branch protection is documented but not enforced** on the current free
  private repo — classic branch protection and rulesets both require GitHub Pro
  or a public repo. The "required checks" in [Rule 31](.claude/rules/31-github-flow.md)
  are advisory until then.

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

`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` are set in the compose file. Running the `claude` CLI inside the devcontainer auto-exports Claude Code telemetry (sessions, token/cost metrics, prompt/tool/API events) to the collector — metrics land in Prometheus, events in Loki. DynamoDB Local is a separate service started with `/seed` or `docker compose up -d dynamodb-local`.

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
- **Rule 60** — coding standards (TypeScript strict, validate at the boundary, Vitest)
- **Rule 70** — tdd-test-engineer → typescript-developer → quality-reviewer TDD agent workflow
