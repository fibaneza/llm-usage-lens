# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This repository is **pre-implementation** for application code: no `apps/`, no `packages/`, no `package.json`, no build tooling yet. Phase 1 (Foundation) has not started.

Pre-Phase-1 infrastructure *is* in place — the devcontainer, the OpenTelemetry/Prometheus/Loki/Grafana observability stack, the `.claude/` rules + agents + commands, and the `.mcp.json` config (Azure MCP) are all wired up. Treat these as ready; do not rebuild them from scratch.

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

Build strictly in phase order (see implementation-phases spec). Phase 4 has 9 sub-phases, one per dashboard page; components are built where first needed and reused later.

Project-specific Claude Code customization lives under `.claude/`:
- **Rules** — `.claude/rules/` (numbered `00`–`70`; always loaded)
- **Slash commands** — `.claude/commands/` (see table below)
- **Agents** — `.claude/agents/` — see Rule 70

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
| `pnpm tsx scripts/seed-ranking.ts` | Seed ranking-focused dataset (optional) |

Pre-commit (Husky + lint-staged): ESLint fix + Prettier on staged files, plus gitleaks secret scan. Commits must follow Conventional Commits (commitlint).

## Slash commands

| Command | Purpose |
|---|---|
| `/build-feature <description>` | Run typescript-developer → test-engineer → quality-reviewer agent loop for a feature |
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

MCP servers are configured in `.mcp.json` at the repo root (currently: Azure MCP via `@azure/mcp`). Add new MCP servers there rather than to per-user Claude Code settings so the whole team gets them.

## Architecture & conventions

Detailed conventions live in `.claude/rules/` (numbered `00`–`70`, always loaded) and in `docs/specs/`. CLAUDE.md does not restate them — read the relevant rule and spec before writing code:

- **Rule 00** — specs are the source of truth; cite the spec for non-trivial decisions
- **Rule 10** — server-only data boundary (DynamoDB and the AWS SDK in server code only)
- **Rule 20** — data model conventions (single table, model-first rollups, UTC, cost provenance)
- **Rule 30** — phase discipline (strict build order)
- **Rule 40** — design system & stack (dark mode default, no raw hex, lazy-loaded charts)
- **Rule 50** — security & secrets (two credential concerns, no static AWS keys)
- **Rule 60** — coding standards (TypeScript strict, validate at the boundary, Vitest)
- **Rule 70** — typescript-developer → test-engineer → quality-reviewer agent workflow
