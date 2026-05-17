# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This repository is **pre-implementation**. Only `docs/` (specs), `LICENSE`, and `.gitignore` exist — no application code, no `package.json`, no build tooling yet. Phase 1 (Foundation) has not started.

The `docs/specs/` directory is the source of truth. Read it before writing any code:

- [docs/specs/2026-05-15-system-architecture.md](docs/specs/2026-05-15-system-architecture.md) — AWS serverless pipeline, account layout, data sources, Lambda collector flow
- [docs/specs/2026-05-15-data-model.md](docs/specs/2026-05-15-data-model.md) — DynamoDB single-table design, entities, access patterns, model ID normalization
- [docs/specs/2026-05-15-design-system.md](docs/specs/2026-05-15-design-system.md) — tech stack, visual design, component inventory, performance patterns
- [docs/specs/2026-05-15-implementation-phases.md](docs/specs/2026-05-15-implementation-phases.md) — 6-phase build plan; each phase independently testable
- [docs/guides/auth-setup.md](docs/guides/auth-setup.md) — Auth.js + Microsoft Entra ID and AWS credential setup
- [docs/guides/aws-infrastructure.md](docs/guides/aws-infrastructure.md) — operational runbook: collector design, SAM deploy/undeploy CLI
- [docs/guides/dashboard-deployment.md](docs/guides/dashboard-deployment.md) — operational runbook: Next.js dashboard on Netlify, deploy/undeploy CLI

Build strictly in phase order (see implementation-phases spec). Phase 4 has 9 sub-phases, one per dashboard page; components are built where first needed and reused later.

Project-specific Claude Code customization lives under `.claude/`:
- **Rules** — `.claude/rules/` (numbered `00`–`70`; always loaded)
- **Slash commands** — `.claude/commands/` (see table below)
- **Agents** — `.claude/agents/` (`developer`, `tester`, `reviewer`, `spec-guardian`)

## What This Project Is

Two deliverables in a **pnpm monorepo**, sharing `packages/shared` (Zod schemas, model normalization, price table):

1. **Next.js dashboard** (`apps/dashboard`) — reads aggregated Bedrock cost/usage from DynamoDB, displays 9 pages. Built first (Phases 1–5), developed against **DynamoDB Local**.
2. **AWS Lambda collector** (`apps/collector`, `bedrock-cost-collector`) — serverless hourly pipeline that collects real Bedrock data and writes to DynamoDB. Built last (Phase 6).

## Commands

> These commands are defined in specs and will be wired up in Phase 1. Until then, run them via their underlying tools.

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
| `playwright test` | E2E tests (Phase 5+) |
| `docker compose up -d dynamodb-local` | Start DynamoDB Local |
| `pnpm tsx scripts/create-table.ts` | Create the DynamoDB table (idempotent) |
| `pnpm tsx scripts/seed.ts` | Seed realistic data |
| `pnpm tsx scripts/seed-empty.ts` | Seed empty state |
| `pnpm tsx scripts/seed-large.ts` | Seed large dataset |

Pre-commit (Husky + lint-staged): ESLint fix + Prettier on staged files, plus gitleaks secret scan. Commits must follow Conventional Commits (commitlint).

## Slash commands

| Command | Purpose |
|---|---|
| `/build-feature <description>` | Run developer → tester → reviewer agent loop for a feature |
| `/lint` | Run prettier + eslint + tsc + vitest sequentially |
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

## Local development environment

A devcontainer (`.devcontainer/`) bundles an observability stack alongside the app:

| Service | Port | Purpose |
|---|---|---|
| Next.js / app | 3000 | Dashboard dev server |
| OpenTelemetry Collector | 4317/4318 | OTLP ingest (gRPC/HTTP) |
| Prometheus | 9090 | Metrics storage |
| Loki | 3100 | Logs/events storage |
| Grafana | 3001 | Dashboards for metrics + logs |

`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` are set in the compose file. Running the `claude` CLI inside the devcontainer auto-exports Claude Code telemetry (sessions, token/cost metrics, prompt/tool/API events) to the collector — metrics land in Prometheus, events in Loki. DynamoDB Local is a separate service started with `/seed` or `docker compose up -d dynamodb-local`.

## Architecture Essentials

**Server-only data boundary.** DynamoDB and the AWS SDK are accessed *only* from server code. Data-access functions live in `apps/dashboard/lib/data/` and import `server-only`. Route Handlers live in `apps/dashboard/app/api/`. Repo-root `scripts/` for table setup and seeds. Client Components never import `apps/dashboard/lib/data/` or the AWS SDK — they receive data as props from Server Components or fetch from same-origin Route Handlers. AWS credentials never reach the browser.

**Route Handlers** (`apps/dashboard/app/api/*`) are the only HTTP-reachable backend: validate input with Zod, check the Auth.js session, query DynamoDB, return `{ data: T }` on success or `{ error: { code, message } }` on failure. This response shape is mandatory and Zod-validated on both ends.

**Single DynamoDB table** (`bedrock-usage`), PK/SK + one GSI (`gsi1pk`/`gsi1sk`, projection `ALL`). Three entities: `AccountMeta`, `DailyRollup`, `SyncStatus`. The `DailyRollup` breaks metrics down **by model first**, with `byUser` and `byService` nested inside each model. GSI1 queries can exceed DynamoDB's 1MB limit — any GSI query must loop on `LastEvaluatedKey`.

**Model ID normalization** lives in `packages/shared` (`@bedrock-usage/shared`), imported by both `apps/dashboard` and `apps/collector`. Raw Bedrock model IDs map to canonical keys (`claude-opus`, `claude-sonnet`, `claude-haiku`, `other`) → display name + chart CSS token (not raw hex in components).

**Two credential concerns — never conflate them:** dashboard *login* is Auth.js (NextAuth v5) + Microsoft Entra ID; the server's *AWS access* is the AWS SDK default credential chain (DynamoDB Local needs no real creds; real AWS uses `aws sso login` + `AWS_PROFILE`). Never use static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.

**Rankings are computed in-memory** in the API route (fetch all `DailyRollup`s for the date range via GSI1, group, sort). v1 targets ≤100 accounts at 30-day range (~3k items); API caps custom ranges at 90 days. See data model spec for scale math.

## Conventions & Constraints

- **UTC everywhere** for date bucketing. `DAILY#{YYYY-MM-DD}` keys are UTC calendar days.
- **All cost is USD.** Only account-level and model-level cost (from Cost Explorer) is exact. Per-user and per-service cost is a proportional estimate and always carries `costEstimated: true`. Today's data is `costFinalized: false` (estimated); yesterday's is `true`.
- A **missing `SyncStatus` item** (before the Lambda's first run) is a valid "never synced" state, not an error. Show a neutral message, never crash. `SyncCountdown` uses `nextScheduledAt` when present.
- **`byService`** comes from CloudTrail inference profiles (`service=<name>` tag), not Cost Explorer billing tags. Untagged usage → `_untagged`.
- **Dark mode is the default and primary** theme (OLED enterprise dashboard). Light mode is future-only.
- No raw hex in components — use semantic color tokens. No global state libraries (TanStack Query for server state, nuqs for URL state, `useState` for local).
- Charts: lazy-load Recharts with `next/dynamic` + `ssr: false`; wrap every chart in `ResponsiveContainer`; wrap each page section in its own `<Suspense>` and `ErrorBoundary`.
- Env vars are validated at build time by `@t3-oss/env-nextjs` with Zod. Auth.js is the identity-provider abstraction — switching providers is a change to `apps/dashboard/auth.ts` only.
- The collector targets **`us-east-1` only**. Multi-region is a documented future enhancement.
