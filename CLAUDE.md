# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This repository is **pre-implementation**. Only `docs/` (specs), `LICENSE`, and `.gitignore` exist — no application code, no `package.json`, no build tooling yet. Phase 1 (Foundation) has not started.

The `docs/specs/` directory is the source of truth. Read it before writing any code:

- `docs/specs/2026-05-15-system-architecture.md` — AWS serverless pipeline, account layout, data sources, Lambda collector flow
- `docs/specs/2026-05-15-data-model.md` — DynamoDB single-table design, entities, access patterns, model ID normalization
- `docs/specs/2026-05-15-design-system.md` — tech stack, visual design, component inventory, performance patterns
- `docs/specs/2026-05-15-implementation-phases.md` — 6-phase build plan; each phase independently testable
- `docs/auth-setup.md` — Auth.js + Microsoft Entra ID and AWS credential setup

Build strictly in phase order (see implementation-phases spec). Phase 4 has 9 sub-phases, one per dashboard page; components are built where first needed and reused later.

## What This Project Is

Two separate deliverables that share Zod schemas and `lib/models.ts`:

1. **Next.js dashboard** — reads aggregated Bedrock cost/usage from DynamoDB, displays 9 pages. Built first (Phases 1–5), developed against **DynamoDB Local**.
2. **AWS Lambda collector** (`bedrock-cost-collector`) — serverless hourly pipeline that collects real Bedrock data and writes to DynamoDB. Built last (Phase 6), separate codebase from the Next.js app.

## Commands (do not exist yet — establish in Phase 1)

Package manager is **pnpm**. Planned commands from the specs:

- `pnpm dev` — run Next.js dev server
- `pnpm build` — `next build`
- `eslint .` — lint (ESLint v9 flat config, `eslint.config.ts`)
- `prettier --check .` — format check
- `tsc --noEmit` — type check (also the pre-push hook)
- `vitest run` — unit + component tests (Vitest, **not Jest** — decided in the Phase 3 spec)
- `playwright test` — E2E tests (Phase 5+)
- DynamoDB Local runs via `docker-compose.yml`; `scripts/create-table.ts` creates the table; `scripts/seed.ts` / `seed-empty.ts` / `seed-large.ts` populate data.

Pre-commit (Husky + lint-staged): ESLint fix + Prettier on staged files, plus gitleaks secret scan. Commits must follow Conventional Commits (commitlint).

## Architecture Essentials

**Server-only data boundary.** DynamoDB and the AWS SDK are accessed *only* from server code. Data-access functions live in `lib/data/` and import `server-only`. Client Components never import `lib/data/` or the AWS SDK — they receive data as props from Server Components or fetch from same-origin Route Handlers. AWS credentials never reach the browser.

**Route Handlers** (`app/api/*`) are the only HTTP-reachable backend: validate input with Zod, check the Auth.js session, query DynamoDB, return `{ data: T }` on success or `{ error: { code, message } }` on failure. This response shape is mandatory and Zod-validated on both ends.

**Single DynamoDB table** (`bedrock-usage`), PK/SK + one GSI (`gsi1pk`/`gsi1sk`, projection `ALL`). Three entities: `AccountMeta`, `DailyRollup`, `SyncStatus`. The `DailyRollup` breaks metrics down **by model first**, with `byUser` and `byService` nested inside each model. GSI1 queries can exceed DynamoDB's 1MB limit — any GSI query must loop on `LastEvaluatedKey`.

**Model ID normalization** lives in shared `lib/models.ts`, imported by *both* the Next.js app and the Lambda. Raw Bedrock model IDs map to canonical keys (`claude-opus`, `claude-sonnet`, `claude-haiku`, `other`) → display name + chart color. Keep it shared so the two never drift.

**Two credential concerns — never conflate them:** dashboard *login* is Auth.js (NextAuth v5) + Microsoft Entra ID; the server's *AWS access* is the AWS SDK default credential chain (DynamoDB Local needs no real creds; real AWS uses `aws sso login` + `AWS_PROFILE`). Never use static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.

**Rankings are computed in-memory** in the API route (fetch all `DailyRollup`s for the date range, group, sort). No pre-aggregated ranking or department entities — intentional, valid for <500 accounts.

## Conventions & Constraints

- **UTC everywhere** for date bucketing. `DAILY#{YYYY-MM-DD}` keys are UTC calendar days.
- **All cost is USD.** Only account-level and model-level cost (from Cost Explorer) is exact. Per-user and per-service cost is a proportional estimate and always carries `costEstimated: true`. Today's data is `costFinalized: false` (estimated); yesterday's is `true`.
- A **missing `SyncStatus` item** (before the Lambda's first run) is a valid "never synced" state, not an error. Show a neutral message, never crash.
- **Dark mode is the default and primary** theme (OLED enterprise dashboard). Light mode is future-only.
- No raw hex in components — use semantic color tokens. No global state libraries (TanStack Query for server state, nuqs for URL state, `useState` for local).
- Charts: lazy-load Recharts with `next/dynamic` + `ssr: false`; wrap every chart in `ResponsiveContainer`; wrap each page section in its own `<Suspense>` and `ErrorBoundary`.
- Env vars are validated at build time by `@t3-oss/env-nextjs` with Zod. Auth.js is the identity-provider abstraction — switching providers is a change to `auth.ts` only.
- The collector targets **`us-east-1` only**. Multi-region is a documented future enhancement.
