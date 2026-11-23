# Implementation Phases Spec

**Status:** Draft
**Date:** 2026-05-15
**Scope:** Phased implementation plan for the LLM Usage Lens, designed for small-batch delivery

---

## Overview

The project is broken into 6 phases. Each phase is independently testable. Phase 4 (Pages) contains 9 sub-phases — one per page — so each page is a standalone deliverable.

Components are built where they are first needed and reused in subsequent pages.

## Phase Summary

| Phase | Name | Deliverable |
|---|---|---|
| 1 | Foundation | Scaffolded project with auth, linting, monitoring, theme |
| 2 | Layout Shell | Responsive sidebar, top bar, global filters, navigation |
| 3 | Data Layer (3.1, 3.1a, 3.2, 3.3) | DynamoDB Local, Zod schemas, Route Handlers, TanStack Query |
| 4 | Pages (4.1–4.9) | All 9 dashboard pages, one sub-phase each |
| 4R | Access & Platform (RP, R1–R5) | AWS CDK platform, role-based access from Entra ID, scoped data, management UI |
| 5 | Polish & Accessibility | Error boundaries, accessibility audit, responsive testing |
| 6 | AWS Lambda Collector | Serverless pipeline (`apps/collector`), shared `packages/shared` |

---

## Phase 1 — Foundation

**Goal:** Scaffolded Next.js project with all tooling, auth, monitoring, and theme configured. No pages yet — just the skeleton.

### Tasks

- [x] Initialize pnpm workspace monorepo (`pnpm-workspace.yaml`, `packages/shared`, `apps/dashboard`)
  - `packages/shared`: Zod schemas and `models.ts` consumed by dashboard and (later) collector — see System Architecture spec **Shared code layout**
- [x] Initialize Next.js project in `apps/dashboard` with TypeScript strict mode, App Router
- [x] Configure Tailwind CSS v4 with light mode theme
  - Color tokens (CSS variables from design system spec)
  - Typography (Space Grotesk + JetBrains Mono; self-hosted via `next/font/local` since 2026-11-06, Design System — *Typography*)
  - Spacing scale (4px/8px grid)
- [x] Self-host fonts via `@fontsource-variable/*` + `next/font/local` (decided 2026-11-06; replaces the `next/font/google` loader)
- [x] Initialize shadcn/ui with light theme
- [x] Configure ESLint v9 (flat config, `eslint.config.ts`)
- [x] Configure Prettier (paired with ESLint)
- [x] Set up Husky + lint-staged (pre-commit: ESLint + Prettier on staged files)
- [x] Set up gitleaks (pre-commit: secret scanning)
- [x] Set up commitlint (conventional commits)
- [x] Configure pre-push hook (`tsc --noEmit`)
- [x] Wire the two project Claude Code hooks in `.claude/settings.json` — deferred to here because before Phase 1 there is no `package.json`, so the commands would fail (the agent workflow in [Rule 70](../../.claude/rules/70-agent-workflow.md) is likewise dormant until now). These complement the git hooks above, they do not replace them:
  - **PostToolUse(`Write|Edit`)** → `prettier --write` the changed file, for format-on-edit feedback ahead of the lint-staged pre-commit pass
  - **PreToolUse(`Write|Edit`)** scoped to `apps/dashboard/**/*.tsx` → guard the [Rule 10](../../.claude/rules/10-server-only-boundary.md) server-only boundary: block an `@aws-sdk/*` or `lib/data/**` import landing in a `"use client"` module (Rule 10 calls this a security bug). This is the one check the git hooks and the `settings.json` deny list cannot easily do at write time
- [x] Set up Auth.js (NextAuth v5) authentication
  - Install `next-auth`
  - Configure the Microsoft Entra ID provider in `auth.ts` (provider-agnostic — swappable in one file; superseded 2026-10-29, see the amendment below)
  - Configure Auth.js in the Next.js proxy (`proxy.ts`) to protect `/dashboard/*` and `/api/*` routes
  - Build sign-in page (`/sign-in`) — single "Sign in with Microsoft" action; no sign-up (identities managed in Entra ID) (superseded 2026-10-29, see the amendment below)
  - Set up environment variables
- [x] Configure @t3-oss/env-nextjs (type-safe env vars with Zod validation)
- [x] Integrate OpenTelemetry (`@vercel/otel` + `instrumentation.ts`)
  - Export errors, traces, and metrics via OTLP to the devcontainer Collector (Prometheus + Loki + Grafana); Grafana Cloud free tier in production
  - Capture server errors via the Next.js `onRequestError` hook
- [x] Create environment files
  - `.env.example` (template with all required vars, no values — git tracked)
  - `.env.local` (local dev values — git ignored)
  - `.env.test` (test config — git ignored)
- [x] Set up GitHub Actions CI pipeline
  - Lint (ESLint + Prettier check)
  - Type check (`tsc --noEmit`)
  - Secret scan (gitleaks)
  - Build (`next build`)
- [x] Verify: project runs with `pnpm dev`, Microsoft Entra ID sign-in works, light theme renders
- [x] Amendment (decided 2026-10-29; ships on its own `fix/` branch, not tied to a later phase): optional Entra ID plus a dev-only local login (System Architecture spec — *Authentication & Access*)
  - `env.ts`: the three `AUTH_MICROSOFT_ENTRA_ID_*` variables optional as a group; `AUTH_DEV_LOGIN`; fail when no provider is configured; in production fail when Entra is absent or `AUTH_DEV_LOGIN` is set
  - `auth.ts`: register providers conditionally (Credentials dev provider only when `NODE_ENV !== "production"` and `AUTH_DEV_LOGIN=true`); repeat the production check at runtime
  - Sign-in page lists only configured providers; add `AUTH_DEV_LOGIN=` to `.env.example`
  - Verify: dev login works with no Entra variables; production with no provider or with `AUTH_DEV_LOGIN` set fails env validation, and with validation skipped every auth request fails; the Entra button appears only when Entra is configured

### Dependencies

None — this is the starting point.

### Components Built

None — infrastructure only.

---

## Phase 2 — Layout Shell

**Goal:** Responsive layout with sidebar navigation, top bar, global date filter, and command menu. All pages will render inside this shell.

Phase 2 is split into three sub-phases, each independently deliverable on its own branch and PR — built in order, one visual checkpoint at a time (mirrors the Phase 4 sub-phase model; see [Rule 30](../../.claude/rules/30-phase-discipline.md) branching). Components are introduced in the sub-phase where they are first needed.

| Sub-phase | Name | New components |
|---|---|---|
| 2.1 | Shell + Navigation | `Sidebar`, top bar + user menu, `SyncStatusBadge` (placeholder), `SyncCountdown` (placeholder) |
| 2.2 | Command Menu | `Kbd`, `CommandMenu` |
| 2.3 | Global Date Filter | `DateRangePicker` (in the top bar) |

### Navigation routes

The sidebar exposes **7 top-level navigation links**: Overview, Ranking, Departments, Teams, Services, Users, Settings. The two detail routes (`departments/[id]`, `teams/[id]`) are reached by drill-down — they get placeholder pages but **no sidebar entry**. Nine route files in total (see Design System spec — Navigation).

### Dependencies

Phase 1 (Foundation).

---

### Phase 2.1 — Shell + Navigation

**Goal:** The persistent application frame — sidebar, top bar, and responsive layout — with every route navigable as a bare placeholder.

**Tasks:**
- [x] Create bare placeholder pages for all 9 routes (title only — the shared top-bar title comes from this shell; the global date filter joins the top bar in 2.3) so navigation has targets: `/dashboard`, `/dashboard/ranking`, `/dashboard/departments`, `/dashboard/departments/[id]`, `/dashboard/teams`, `/dashboard/teams/[id]`, `/dashboard/services`, `/dashboard/users`, `/dashboard/settings`
- [x] Build `Sidebar` component (shadcn/ui)
  - 7 top-level navigation links with Lucide icons (the two `[id]` detail routes are drill-down only — no sidebar entry)
  - Active state highlighting
  - Collapsible on desktop, overlay on mobile
  - Mobile overlay closes on Escape and on nav-link click, returning focus to the `SidebarTrigger` (Design System *Component Inventory* — `Sidebar`; follow-up, 2026-10-29)
  - Footer rail toggle is named for its action — "Collapse" when the rail is expanded and in the mobile sheet, "Expand" when the desktop rail is collapsed; the icon and the collapsed-rail tooltip follow the same word (WCAG 4.1.2, Rule 60.30; follow-up, 2026-10-30)
- [x] Build responsive layout structure (the `/dashboard` layout)
  - Breakpoints: 375 / 768 / 1024 / 1440
  - Content area max-width 1280px, centered (superseded 2026-11-11 by the fluid content area — Phase 5 *UI refresh*)
  - Mobile: single column, collapsible sidebar
  - Tablet: sidebar overlay
  - Desktop: persistent sidebar + content
- [x] Build top bar
  - User menu (avatar, name, sign out, Auth.js session) + organization name (`NEXT_PUBLIC_ORG_NAME`; from unit CFG `display.orgName` in `config.yaml`, the variable a deprecated fallback — System Architecture — *Configuration file*, 2026-11-17)
  - `SyncStatusBadge` placeholder (no real data yet — neutral "no sync" state, never an error)
  - `SyncCountdown` placeholder
  - Compact forms per breakpoint (badge/countdown icon-only below `lg`, search icon-only `md`–1439) per Design System *Layout* (follow-up, 2026-10-29)
- [x] Verify: every route is reachable from the sidebar, sidebar collapses on desktop and overlays on mobile, responsive at all breakpoints with no horizontal scroll

**Components Built:** `Sidebar`, top bar + user menu, `SyncStatusBadge` (placeholder), `SyncCountdown` (placeholder)

---

### Phase 2.2 — Command Menu

**Goal:** Quick-jump search layered onto the shell.

**Dependencies:** Phase 2.1.

**Tasks:**
- [x] Build `Kbd` component (keyboard-shortcut hint)
- [x] Build `CommandMenu` component (shadcn/ui cmdk)
  - Cmd+K trigger with `Kbd` hint
  - Skeleton search — navigates to pages (populated with real data in Phase 5)
- [x] Verify: Cmd+K opens the command menu and navigates between pages

**Components Built:** `Kbd`, `CommandMenu`

---

### Phase 2.3 — Global Date Filter

**Goal:** The global date filter, rendered once in the top bar and shared by
every page. (The "page header" the top bar already provides in 2.1 — title +
sync status — is the heading; the date filter joins it there rather than in a
separate content-area band; see design-system spec — Layout / Date Filtering.)

**Dependencies:** Phase 2.2.

**Tasks:**
- [x] Build `DateRangePicker` component
  - Segmented preset toggle (`7D / 30D / 90D`) + a `Custom` trigger opening a
    shadcn/ui `Calendar` in a `Popover` (see design-system — Control Patterns)
  - Presets: 7 days, 30 days, 90 days, Custom range
  - Default: last 30 days
  - Persisted in URL via nuqs; UTC arithmetic with a 90-day clamp (Rules 20.1, 20.8)
- [x] Place the `DateRangePicker` in the top bar (`AppHeader`), wrapped in a
  `<Suspense>` boundary so pages still prerender statically
- [x] Verify: date filter persists in URL, renders on every page via the shared
  top bar, navigation and responsive behaviour from 2.1 still hold, `next build`
  succeeds

**Components Built:** `DateRangePicker` (top bar)

---

## Phase 3 — Data Layer

**Goal:** DynamoDB Local running, seed data populated, Zod schemas validated, Route Handlers serving data, TanStack Query fetching it.

Phase 3 is split into three sub-phases built as a strict chain (3.1 → 3.2 → 3.3), plus the 3.1a follow-up that amends the merged 3.1 schemas and lands before or alongside 3.2. Each is independently deliverable on its own branch (mirrors the Phase 2 and Phase 4 sub-phase model; see [Rule 30](../../.claude/rules/30-phase-discipline.md) branching). The split follows the natural data-layer boundary: shared schemas → database + data access → routes + client.

| Sub-phase | Name | Deliverable |
|---|---|---|
| 3.1 | Shared Schemas & Model Normalization | Zod schemas + model-ID table in `packages/shared`; CI `test` job |
| 3.1a | Non-Model Cost Schema (follow-up) | Optional `nonModel` map on `DailyRollupSchema` + charge-category enum + `classifyUsageType` table; rollup `date` + `DailyRollupItemSchema`; non-model seed coverage; amends 3.1 after the fact |
| 3.2 | DynamoDB Local, Table/Seeds & Data Access | DynamoDB Local table/seed scripts, `lib/dynamodb.ts`, the six `lib/data/**` functions |
| 3.3 | Route Handlers & TanStack Query | 13 Route Handlers + TanStack Query client integration |

### Dependencies

Phase 1 (Foundation), Phase 2 (Layout Shell — for rendering data in pages).

### Components Built

None — data infrastructure only.

### Testing Decision: Vitest over Jest

**Decision:** Use Vitest instead of Jest for all testing.

**Rationale:** Vitest is faster, has native TypeScript and ESM support without additional configuration, uses the same Vite-compatible transform pipeline, and provides a Jest-compatible API — making the transition straightforward for developers familiar with Jest. Vitest also integrates better with modern tooling (TanStack, Next.js App Router) and avoids the CommonJS/ESM configuration complexity that Jest requires for TypeScript projects.

---

### Phase 3.1 — Shared Schemas & Model Normalization

**Goal:** The Zod schemas and model-ID normalization table in `packages/shared`, importable by the dashboard and (later) the collector — plus the CI `test` job that runs the suite.

**Dependencies:** Phase 1 (Foundation).

**Tasks:**
- [x] Implement Zod v4 validation schemas in `packages/shared/src/schemas/`
  - `AccountMetaSchema`
  - `DailyRollupSchema`
  - `SyncStatusSchema` (includes `nextScheduledAt`)
  - `RankingQuerySchema` (dateFrom, dateTo, tab, model, sortBy, order, limit)
  - `DateRangeQuerySchema` (dateFrom, dateTo, accountId; max 90-day span)
  - `TeamsQuerySchema` (date range + optional `departmentId`)
  - Types derived via `z.infer` — never hand-written (Rule 60.3)
- [x] Implement shared model ID normalization in `packages/shared/src/models.ts`
  - Raw Bedrock model ID → canonical key → display name + chart CSS token
  - Re-export from `apps/dashboard/lib/models.ts` if needed for convenience
  - Same package imported by Lambda in Phase 6 (see System Architecture spec — Shared code layout)
- [x] Unit tests for schemas (valid/invalid inputs, Rule 60.22) and model normalization
- [x] Add the GitHub Actions `test` job (`pnpm exec vitest run`) — this also starts running the existing Phase 2 component tests in CI. No DynamoDB needed yet.
- [x] Verify: schemas + model table importable by the dashboard; `vitest run` is green in CI; no DynamoDB dependency.

**Components Built:** None — shared validation infrastructure only.

---

### Phase 3.1a — Non-Model Cost Schema (follow-up)

**Goal:** Extend the merged 3.1 schemas so a `DailyRollup` can carry Bedrock charges that are not per-model token usage: Guardrails, Provisioned Throughput, model storage, Custom Model Import, Knowledge Bases, and others. Account totals stay exact (Rule 20.3). Also adds the rollup `date` attribute (write-side `DailyRollupItemSchema`, seeds write it, `lib/data/**` returns it). Spec: Data Model spec — *Non-Model Charges*; System Architecture spec — *Cost Explorer `USAGE_TYPE` classification*.

**Dependencies:** Phase 3.1 (merged). A follow-up to 3.1 on its own branch (`feature/phase-3.1a-non-model-cost`, Rule 30.4). It does not reorder the sub-phases. Land it **before or alongside** 3.2 so the seed scripts can cover `nonModel`. **Seed routing:** if 3.1a merges before 3.2, the seed-coverage tasks below (and the seeded idle-PT Verify item) move into 3.2's `nonModel` pass-through task; if 3.2 merges first, they land on a 3.1a follow-up branch (as happened: `feature/phase-3.1a-followup`).

**Tasks:**
- [x] Add `NonModelCategorySchema` (closed enum of the canonical category keys) and `NonModelChargeSchema` (`cost`, `costEstimated`, `recurring`, optional `usageQuantity`/`usageUnit`, `rawUsageTypes`) in `packages/shared/src/schemas/`; types via `z.infer` (Rule 60.3)
- [x] Add optional `nonModel: z.partialRecord(NonModelCategorySchema, NonModelChargeSchema)`. Export the unrefined `DailyRollupBaseSchema` plus the refined `DailyRollupSchema`, whose refinement enforces `|cost − (Σ models[*].cost + Σ nonModel[*].cost)| ≤ 1e-6` (Data Model spec — *Schema decisions*)
- [x] Add the pure `classifyUsageType` function and its ordered pattern table in `packages/shared`. Patterns are placeholders, marked unverified until Phase 6 confirms real `USAGE_TYPE` strings
- [x] Add the semantic chart token `--color-cost-non-model: var(--color-foreground)` (Design System spec — *Chart Colors (Per Model)*; no raw hex, Rule 40.2)
- [x] Add optional `date` (`YYYY-MM-DD`, UTC) to `DailyRollupSchema`, with valid/invalid tests; the `date` ↔ `SK`/`gsi1pk` consistency check goes in the write-side `DailyRollupItemSchema` (`packages/shared/src/schemas/`), not `DailyRollupSchema`; seed scripts write `date`, and the `lib/data/**` rollup functions return it, deriving it from `SK` when absent (Data Model spec — *`date` attribute*, adopted 2026-10-28)
- [x] Unit tests (Rule 60.22):
  - valid rollup with and without `nonModel`; a pre-amendment fixture (no `nonModel`) still parses
  - unknown category key rejected
  - invariant violation rejected
  - `DailyRollupBaseSchema` accepts an invariant-violating item and supports `.pick` / `.omit` (the refinement lives only on `DailyRollupSchema`)
  - a `nonModel` entry carrying token fields (`inputTokens`, etc.) is rejected (`NonModelChargeSchema` is a strict object)
  - classifier ordering: a provisioned-throughput usage type that names a model → `provisioned-throughput`, not the model
  - classifier ordering: a `…CustomModelUnit…` usage type → `custom-model-import`, not `provisioned-throughput`
  - `BDA` matches only as a whole token: a usage type containing `Lambda` is not `data-automation`
  - an unprefixed `BDA-…` usage type → `data-automation` (the region-prefix strip does not consume `BDA-`)
  - a Claude family token usage type (e.g. `USE1-Claude3-5-Sonnet-input-tokens`) → model `claude-sonnet`
  - unknown usage type → `unclassified`
  - unmapped-model token usage type → `models.other`
- [x] Seed coverage (3.2 seed scripts; routed per **Seed routing** above):
  - `seed.ts` includes guardrail charges on some days
  - one account with Provisioned Throughput accruing every day, including days with zero invocations (an idle recurring rollup with `models: {}`)
  - one `unclassified` entry with `rawUsageTypes`
  - `seed-empty.ts` unchanged
- [x] Verify: schema tests green in CI; existing 3.1 tests green, assertions unchanged; fixtures that violate the invariant corrected (the empty-models and hoisted-byUser fixtures move to `cost: 0`, by tdd-test-engineer); a seeded idle-PT day validates (checked wherever the seed tasks land, per **Seed routing**); `date` valid/invalid tests green, `DailyRollupItemSchema` rejects a `date` ↔ `SK`/`gsi1pk` mismatch, and the `lib/data/**` rollup functions return `date` for items stored without it; no DynamoDB dependency added to `packages/shared`.

**Components Built:** None — shared validation infrastructure only.

---

### Phase 3.2 — DynamoDB Local, Table/Seeds & Data Access

**Goal:** DynamoDB Local serving the dashboard's reads — table created, seed data populated, and the server-only data-access layer in place.

**Dependencies:** Phase 3.1 (the schemas the data-access functions return), Phase 2 (Layout Shell — for rendering data in pages).

**Tasks:**
- [x] Document DynamoDB Local startup (already runs in the devcontainer — `.devcontainer/docker-compose.yml`; document `docker compose up -d dynamodb-local` in the README)
- [x] Create DynamoDB table setup script (repo-root `scripts/create-table.ts`, invoked via `pnpm` from workspace root)
  - Creates `bedrock-usage` table with PK/SK + GSI1 (`ALL` projection)
  - Idempotent (safe to re-run)
- [x] Create seed scripts
  - Every profile maps each account to its own team, because a team is one AWS member account (System Architecture — *Organizational Hierarchy*; decided 2026-11-06). The profiles therefore have no multi-account team; Team Detail `accounts[]` > 1 and the "merge across its accounts" rules for Services and Users are covered by dedicated multi-account fixtures in unit and integration tests, not by the seeds
  - `scripts/seed.ts` — realistic data: 3 departments, 5 teams (2+2+1) = 5 accounts, 10 users (2 per team), 8 services, 30 days of rollups, multiple models
  - `scripts/seed-empty.ts` — empty state: the default profile's 5 accounts exist but no rollups (tests empty states)
  - `scripts/seed-large.ts` — stress test: 50 accounts = 50 teams across 5 departments (10 each), 90 days, 20 users/team, 15 services
  - `scripts/seed-ranking.ts` (optional) — 100 accounts = 100 teams across 5 departments (20 each) × 30 days to validate ranking performance at v1 upper bound
- [x] Remap seed profiles to one account per team (decided 2026-11-06)
- [x] Build DynamoDB client (`apps/dashboard/lib/dynamodb.ts`)
  - AWS SDK v3 document client
  - Configurable endpoint (DynamoDB Local vs AWS)
- [x] Build data access functions (`apps/dashboard/lib/data/`) — each `import "server-only"` (Rule 10)
  - `getAccountMeta(accountId)`
  - `getAllAccounts()`
  - `getAccountsByDepartment(departmentId)`
  - `getDailyRollups(accountId, dateFrom, dateTo)`
  - `getRollupsByDate(date)` — must loop on `LastEvaluatedKey` (GSI1 query can exceed DynamoDB's 1MB limit, Rule 20.6)
  - `getSyncStatus()` — return a "never synced" state when no item exists, not an error (Rule 20.9)
- [x] Add the Vitest node-env project split + DynamoDB-Local integration tests for data-access functions (the env split the `vitest.config.ts` comment already anticipates)
- [x] Extend the CI `test` job to start DynamoDB Local + create table + seed
- [x] `nonModel` pass-through: seeds cover `nonModel` per the Phase 3.1a seed-coverage tasks, including a seeded idle-PT day that validates (owned here if 3.1a merges first; via a follow-up commit on the 3.1a branch if 3.2 merges first — Phase 3.1a *Seed routing*), and data-access functions parse each item with the refined `DailyRollupSchema` on read and return `nonModel` unchanged
- [x] Verify: `pnpm tsx scripts/seed.ts` populates DynamoDB Local; data-access integration tests pass locally and in CI.

**Components Built:** None — data infrastructure only.

---

### Phase 3.3 — Route Handlers & TanStack Query

**Goal:** The HTTP backend the pages consume — every Route Handler returning the standard validated shape, with TanStack Query wired into the client.

**Dependencies:** Phase 3.2 (the data-access functions the handlers call).

**Tasks:**
- [x] Build Route Handlers (`apps/dashboard/app/api/`) — see Data Model spec **API Routes** table; return `401`/`400`/`404` per HTTP status table
  - `GET /api/overview`, `/api/ranking`, `/api/departments`, `/api/departments/[id]`, `/api/teams`, `/api/teams/[id]`, `/api/services`, `/api/users`, `/api/sync-status`
  - `GET|POST /api/accounts`, `PATCH|DELETE /api/accounts/[id]` (Settings CRUD)
  - Each: Auth.js session check → Zod-validate query/body → data-access call → `{ data: T }` / `{ error: { code, message } }` shape (Rules 10, 20.11) (account writes: role gate added 2026-10-29, see the amendment below)
  - Zod validation on all query params; enforce 90-day max on custom date ranges
  - Next.js server cache with 1-hour revalidation (`export const revalidate = 3600`, Rule 60.10); data reads wrapped in `unstable_cache` — rollups per UTC day, accounts tagged (1 h) and sync status tagged (5 min, Design System *Caching Strategy*), account writes revalidate the `accounts` tag (follow-up, 2026-10-29)
- [x] Set up TanStack Query
  - `QueryClientProvider` in root layout (beside the existing `NuqsAdapter`)
  - Default `staleTime`: 5 minutes
  - Query hooks per data access pattern
- [x] `nonModel` pass-through: `/api/overview`, `/api/departments/[id]`, and `/api/teams/[id]` responses gain the model vs. non-model cost split plus per-category totals with `recurring` (Data Model spec — *Dashboard impact*); response schemas derive from `DailyRollupBaseSchema`
- [x] Route Handler tests: assert the `{ data }` / `{ error }` shape and cover the `401` (unauthenticated) and `400` (bad input) paths (Rule 60.23)
- [x] Amendment (decided 2026-10-29; ships on its own `fix/` branch): `Admin` app-role gate on account writes (System Architecture spec — *Authentication & Access*)
  - `auth.ts`: Zod-parse the ID-token `roles` claim into the JWT and `session.user.roles`; sessions end 8 hours after sign-in regardless of activity (sign-in time in the JWT; `maxAge` 8 hours as the idle timeout); the dev-only login signs in with `["Admin"]`; the role name and check live in `lib/auth/`
  - `packages/shared`: add `FORBIDDEN` to `ApiErrorCodeSchema`
  - `POST /api/accounts`, `PATCH`/`DELETE /api/accounts/[id]`: `403 FORBIDDEN` after the session check, before input parsing and any DynamoDB call; `GET` routes unchanged
  - Verify: a session without `Admin` gets `403 { error: { code: "FORBIDDEN" } }` from each write route with no DynamoDB write; an `Admin` session succeeds; reads unaffected; the dev login carries `Admin`; a token whose sign-in time is more than 8 hours old is rejected even while the user stays active
  - Hardening (follow-up, 2026-10-29): a future sign-in time (> 60 s skew) is rejected; a session `update` cannot change roles or the sign-in time; a structural test enumerates every write Route Handler except Auth.js's own `/api/auth/[...nextauth]` handler and requires a `403` for non-admins; the Entra issuer must be tenant-specific (checked by `env.ts` and again at runtime); Verify: the structural test and the issuer, skew and update tests pass
- [x] Verify: Route Handlers return validated data, a TanStack Query hook fetches it, `next build` succeeds — unblocks Phase 4.

**Components Built:** None — data infrastructure only.

---

## Phase 4 — Pages

**Goal:** All 9 dashboard pages, built one at a time. Each sub-phase is independently deliverable. Components are built where first needed and reused in later pages.

### Component Build Order

Components are introduced in the sub-phase where they are first needed:

| Sub-phase | New components introduced |
|---|---|
| 4.1 Overview | MetricCard, DeltaBadge, CostTrendChart, ModelBreakdownChart, Skeleton, Suspense boundaries |
| 4.2 Ranking | UsageTable, RankingList, PercentOfTotalBar, SparklineCell, ModelFilter, SearchInput, ColumnToggle, Pagination, ExportButton, EmptyState, CostEstimateIndicator |
| 4.3 Departments | (reuses MetricCard, EmptyState) |
| 4.4 Department Detail | PeriodComparison (reuses UsageTable, CostTrendChart) |
| 4.5 Teams | (reuses UsageTable, ModelFilter) |
| 4.6 Team Detail | ModelBadge, AccountIdBadge, UserAvatar (reuses UsageTable) |
| 4.7 Services | (reuses UsageTable, CostEstimateIndicator) |
| 4.8 Users | (reuses UsageTable, UserAvatar, CostEstimateIndicator) |
| 4.9 Settings | (CRUD forms, new; reuses SyncStatusBadge, SyncCountdown) |
| 4.9b Tag Coverage (deferred) | TagCoverageBar |

---

### Phase 4.1 — Overview Page (`/dashboard`)

**Goal:** KPI cards, cost trend chart, model breakdown, sync status. This is the heaviest page — introduces core display components.

**Sections (5):**
1. KPI metric cards row (Total Cost, Total Tokens, Total Invocations, Most Used Model, Active Accounts)
2. Cost trend: stacked area chart by model (last 30 days)
3. Top 5 departments by cost: horizontal bar chart
4. Model distribution: donut chart
5. Sync status with last update time and countdown

**Tasks:**
- [x] Build `MetricCard` component (shadcn Card + icon + value + trend)
- [x] Build `DeltaBadge` component ("+12.3%" green / "-5.1%" red)
- [x] Build `CostTrendChart` (Recharts stacked area, `next/dynamic` with `ssr: false`, `ResponsiveContainer`; prop `groupBy: 'model' | 'team'` for reuse on department detail (team series use `--color-team-1…8` — Design System *Chart Colors (Per Team)*); non-model cost as its own series/segment (never merged into `other`) using `--color-cost-non-model` (Data Model spec — *Dashboard impact (v1)*; requires Phase 3.1a))
- [x] Build `ModelBreakdownChart` (Recharts donut, `next/dynamic` with `ssr: false`, `ResponsiveContainer`; non-model cost as its own series/segment (never merged into `other`) using `--color-cost-non-model` (Data Model spec — *Dashboard impact (v1)*; requires Phase 3.1a))
- [x] Build top departments horizontal bar chart
- [x] Show the model vs. non-model cost split on Total Cost, a "recurring" indicator for recurring non-model categories, and the "Bedrock service charges only" scope note (Data Model spec — *Dashboard impact*). Requires Phase 3.1a
- [x] Connect `SyncStatusBadge` and `SyncCountdown` to real data (SyncStatus entity)
- [x] Build `Skeleton` loading states for all 5 sections
- [x] Wrap each section in `<Suspense>` with Skeleton fallback
- [x] Connect all components to TanStack Query hooks + DateRangePicker filter
- [x] Tests: component tests for MetricCard, DeltaBadge; integration test for overview data loading
- [x] Verify: page renders with seed data, skeletons show during load, date filter updates all sections

---

### Phase 4.2 — Ranking Page (`/dashboard/ranking`)

**Goal:** Leaderboard with tabs, filters, sortable table. This is the second heaviest page — introduces the core table infrastructure reused by most other pages.

**Sections (2):**
1. Tabs (Departments / Teams / Services / Users) + filters (Model, Date)
2. Sortable data table with ranking

**Tasks:**
- [x] Build `UsageTable` component (TanStack Table + shadcn Table)
  - Sortable columns (click header to sort)
  - `Pagination` (default 20 rows)
  - `SearchInput` (debounced text filter)
  - `ColumnToggle` (show/hide columns via shadcn DropdownMenu)
- [x] Build `RankingList` variant with medal icons for top 3
- [x] Build `PercentOfTotalBar` component (inline proportion bar)
- [x] Build `SparklineCell` component (inline trend sparkline)
- [x] Build `ModelFilter` component (shadcn Select)
- [x] Build `ExportButton` component (CSV export)
- [x] Build `EmptyState` component (icon + message + optional CTA)
- [x] Implement tab switching via nuqs (URL-persisted)
- [x] Connect to Route Handlers: ranking data grouped by department/team/service/user
- [x] Table columns: Rank, Name, Cost, Input Tokens, Output Tokens, Invocations, % of Total, Trend
- [x] Build `CostEstimateIndicator` component (subtle badge on rows with `costEstimated: true` — the Users and Services tabs; Rule 20.3). Moved from Phase 4.9: Ranking is its first consumer (Rule 30.2; decided 2026-11-03)
- [x] Users and Services tabs show the "model usage only" note (Data Model spec — *Non-model cost is account-level only*) — review blocker (2026-11-03), closed 2026-11-04 by `ModelUsageNote`
- [x] The full table fits its container at 768–1439px with the sidebar open (Design System — *Responsive Tables*: no horizontal scroll at any viewport) — review blocker (2026-11-03), closed 2026-11-04: smaller type and padding below `lg`, wrapping headers and names, abbreviated figures
- [x] Tests: component tests for UsageTable (sort, filter, paginate); EmptyState rendering
- [x] Verify: all 4 tabs load, sorting works, model filter updates results, CSV exports correctly

---

### Phase 4.3 — Departments Page (`/dashboard/departments`)

**Goal:** Department cards grid showing each department's total cost, tokens, and team count.

**Sections (1):**
1. Department cards grid

**Tasks:**
- [x] Build department cards grid layout (responsive: 1 col mobile, 2 tablet, 3 desktop)
- [x] Each card: department name, total cost (with DeltaBadge), total tokens, team count, top model (`teamCount` and `topModel` on the `/api/departments` row — Data Model spec, *Zod Validation Schemas*; decided 2026-11-04)
- [x] Reuse `MetricCard` pattern for department cards
- [x] Link each card to department detail page
- [x] `EmptyState` for no departments
- [x] Connect to Route Handler: rollups for the range grouped by department (AccountMeta not read)
- [x] Tests: grid renders correct number of cards; empty state when no departments
- [x] Verify: cards render with seed data, links navigate to detail pages

---

### Phase 4.4 — Department Detail Page (`/dashboard/departments/[id]`)

**Goal:** Deep dive into a single department — teams breakdown, cost over time, top users.

**Sections (4):**
1. Department header (name, total cost, tokens, invocations with DeltaBadge, "Bedrock service charges only" scope note — Data Model spec, *Dashboard impact (v1)*; decided 2026-11-06)
2. Teams breakdown table (sortable)
3. Cost over time: stacked area chart by team
4. Top users in this department: ranked list

**Tasks:**
- [x] Build department header with summary stats
- [x] Build `PeriodComparison` component ("vs previous 30 days" side-by-side)
- [x] Reuse `UsageTable` for teams breakdown
- [x] Reuse `CostTrendChart` (stacked by team instead of model)
- [x] Top users ranked list (reuse `RankingList`)
- [x] Connect to Route Handlers: department rollups + team breakdown
- [x] Tests: header stats calculation
- [x] Add the "Bedrock service charges only" scope note to the department header (Data Model spec, *Dashboard impact (v1)*; decided 2026-11-06)
- [x] Verify: page loads for each department in seed data, charts and tables render correctly

---

### Phase 4.5 — Teams Page (`/dashboard/teams`)

**Goal:** Filterable list of all teams across all departments.

**Sections (1):**
1. Teams table with department filter

**Tasks:**
- [x] Reuse `UsageTable` for teams list
- [x] Add department filter dropdown (reuse `ModelFilter` pattern with department data)
- [x] Columns: Team Name, Department, Cost, Tokens, Invocations, Services count, Users count (headers "Services" and "Users"; `serviceCount` and `userCount` on the `/api/teams` row — Data Model spec, *Zod Validation Schemas*; decided 2026-11-05)
- [x] Link team name to team detail page
- [x] `EmptyState` for no teams / no results
- [x] Connect to Route Handler: all accounts with optional department filter
- [x] Tests: department filter works; table sorting and pagination
- [x] Verify: all teams from seed data appear, filter narrows results

---

### Phase 4.6 — Team Detail Page (`/dashboard/teams/[id]`)

**Goal:** Deep dive into a single team — services, users, model breakdown.

**Sections (4):**
1. Team header (name, account ID(s), total cost, tokens, "Bedrock service charges only" scope note)
2. Services breakdown table
3. Users breakdown table
4. Model usage breakdown: bar chart

**Tasks:**
- [x] Build team header with one `AccountIdBadge` per `accounts[]` entry (formatted AWS account ID with copy button) and the scope note (Data Model spec, *Dashboard impact (v1)*; decided 2026-11-06)
- [x] Build `ModelBadge` component (model name + assigned color dot) and use it as the model usage bar chart's legend
- [x] Build `UserAvatar` component (initials avatar with consistent color)
- [x] Reuse `UsageTable` for services breakdown
- [x] Reuse `UsageTable` for users breakdown (with `UserAvatar` in name column)
- [x] Build model usage bar chart (reuse Recharts, `next/dynamic`)
- [x] Connect to Route Handlers: team rollups with byService and byUser data
- [x] Tests: AccountIdBadge copy functionality; UserAvatar color consistency
- [x] Verify: services and users tables populated from seed data, model chart renders

---

### Phase 4.7 — Services Page (`/dashboard/services`)

**Goal:** All services across all accounts in one table.

**Sections (1):**
1. Services table

**Tasks:**
- [x] Reuse `UsageTable` for services list
- [x] Columns: Service Name, Team, Department, Cost, Tokens, Invocations, % of Total
- [x] Aggregate byService data across all accounts and date range, one row per team and service (Data Model — `ServicesResponseSchema`; decided 2026-11-06)
- [x] Cost values carry `CostEstimateIndicator`; the page shows the "model usage only" note (Data Model — *Non-model cost is account-level only*); `_untagged` rows read "Untagged"; % of Total is the row's share of all rows' cost (0% when that sum is 0)
- [x] Link to parent team detail page
- [x] `EmptyState` when there are no rows; when every row is `_untagged`, the table still renders its Untagged rows and a `role="status"` notice above it explains that no usage carries a `service` tag (System Architecture — *Service tagging dependency*)
- [x] Connect to Route Handler: aggregated services across all rollups
- [x] Tests: cross-account aggregation correctness; two teams sharing a service name stay two rows; each team's `_untagged` is a separate row
- [x] Verify: services from all teams appear, sorted by cost

---

### Phase 4.8 — Users Page (`/dashboard/users`)

**Goal:** All users across all accounts in one table.

**Sections (1):**
1. Users table

**Tasks:**
- [x] Reuse `UsageTable` for users list (with `UserAvatar`)
- [x] Columns: User (avatar + user id), Team, Department, Cost, Tokens, Invocations, % of Total
- [x] Aggregate byUser data across all accounts and date range, one row per team and user (Data Model — `UsersResponseSchema`; decided 2026-11-06)
- [x] Cost values carry `CostEstimateIndicator` (all per-user costs are proportional estimates); the page shows the "model usage only" note (Data Model — *Non-model cost is account-level only*); % of Total is the row's share of all rows' cost (0% when that sum is 0)
- [x] Link to parent team detail page
- [x] `EmptyState` for no users
- [x] Connect to Route Handler: aggregated users across all rollups
- [x] Tests: cross-account user aggregation; one user in two teams stays two rows; CostEstimateIndicator appears
- [x] Verify: users from all teams appear, sorted by cost, estimated cost indicator shown

---

### Phase 4.9 — Settings Page (`/dashboard/settings`)

**Goal:** Admin page for managing account registry, viewing sync status and data retention. Only page with write operations (CRUD). Tag coverage moved to Phase 4.9b (decided 2026-11-10).

**Sections (3)** *(since 2026-11-16 these are tabs of route pages, not one scroll: see Settings admin area — unit D)*:
1. Account registry (add / edit / deactivate accounts, map to department/team)
2. Sync status (last run time, success/error count, next scheduled run)
3. Data retention (TTL configuration display)

Tag coverage per team is Phase 4.9b (deferred).

**Tasks:**
- [x] Build account registry table with add/edit/deactivate actions
  - Add account form (shadcn Dialog): account ID, name, department ID/name, team ID/name. `region` is not an input: it is fixed to `COLLECTOR_REGION` (`ap-southeast-2`) and `AccountMetaSchema` rejects any other value (System Architecture — *Region*; decided 2026-11-10)
  - *Amended 2026-11-24 (unit ST1, D-ST5; review round 1):* the Add account form takes the AWS account ID typed (12 digits), and the department and team by name or by picking an existing one; `departmentId` and `teamId` are generated server-side and the strict body refuses them (`400`). The Edit form picks existing departments and teams the same way and sends the picked ids in the unchanged PATCH (Design System — *Settings Page*). Data Model — *API Routes* has the id rules.
  - Edit account form (shadcn Sheet)
  - Deactivate with confirmation dialog
  - Zod validation on all form inputs
  - No Server Actions in v1: Settings CRUD uses the `/api/accounts` Route Handlers through TanStack Query mutations (Rule 60.15). A Server Action added later goes through `next-safe-action` (decided 2026-11-10)
  - The `/api/accounts` Route Handlers (Phase 3.3) are the Settings CRUD HTTP contract; a Server Action, if used, calls the same `lib/data/account-meta.ts` functions rather than a second write path (decided 2026-10-29)
  - **Account-mutation role (decided 2026-10-29):** only the `Admin` app role may create, edit and deactivate accounts (System Architecture — *Authentication & Access*). The `/api/accounts` write routes return `403 FORBIDDEN` without it (Phase 3.3 amendment); the Settings page hides the add/edit/deactivate controls from non-admins, and any Server Action checks the same role.
- [x] Build sync status display
  - Connect `SyncStatusBadge` and `SyncCountdown` to SyncStatus entity
  - Show: last run time, status (success/partial/error), accounts processed, duration, errors list
- [x] Reuse `CostEstimateIndicator` (built in Phase 4.2) wherever Settings shows an estimated cost — none in v1: Settings shows no estimated cost (decided 2026-11-10)
- [x] Build data retention display (TTL info, read-only)
- [x] Tests: CRUD operations against DynamoDB Local; form validation; a non-admin session sees no add/edit/deactivate controls, and the write routes return `403` for it (e2e needs admin and non-admin forged sessions)
- [x] Verify: can add/edit/deactivate accounts as `Admin`; a non-admin sees the registry read-only and gets `403` from the write routes; sync status displays correctly

### Phase 4.9b — Tag Coverage (deferred; decided 2026-11-10)

**Goal:** Settings section "Tag coverage per team" — the percentage of tagged vs `_untagged` usage (Data Model — *`_untagged` Bucket*).

**Why deferred:** the metric is `1 − (untagged tokens / total tokens)` per team over a date range, but no route in Data Model — *API Routes* supplies those numbers, and Settings has no date-range control. 4.9 shipped without it. **Does not block Phase 5.**

**Tasks:**
- [ ] Spec the data path first (Rule 00): either (a) `taggedTokens` / `totalTokens` on `TeamsResponseSchema` rows, reusing `/api/teams`, or (b) a new `GET /api/tag-coverage`; and the date range the Settings section uses
- [ ] Build `TagCoverageBar` component (progress bar per team) — tagged vs `_untagged` percentage from `byService`
- [ ] Tests: tag coverage calculation (including a team with no usage — no data, not 0%; Rule 20.12 spirit)
- [ ] Verify: tag coverage renders

---

## Phase 4R — Access & Platform (decided 2026-11-10)

**Goal:** role-based, scope-limited access from Entra ID and AWS hosting, per the [Access Control spec](2026-11-10-access-control.md) and the [Platform spec](2026-11-10-platform.md). Sub-phases run in order RP → R1 → R2 → R3 → R4 → R5, one branch and squash commit each (Rule 30.4), after 4.9 and before the LiteLLM units and Phase 5. Each runs the Rule 70 loop; R1–R4 add `ecc:security-reviewer` when installed, and R3–R4 add a dedicated policy-breaking review briefed with the threat model.

`APP_ENV` (`dev` | `prod`) is added to *Environment Configuration* by 4R.1 (Access Control — *Environment*).

**LiteLLM units (L0–L8)** follow Phase 4R and precede Phase 5; they are specced in the [LiteLLM spec](2026-11-10-litellm.md) and listed under *LiteLLM units* below.

### Phase 4R.P — Platform (`feature/phase-4r-p-platform`)

- [x] `infra/` CDK app: FoundationStack (table, CMK, cluster, ECR, SSM parameters) and DashboardServiceStack (task definition, Fargate service, execution role, task role with Reads and `ACCT#*` writes (`IDENT#*` added 2026-11-11, security review), security group, target group, listener rule, audit log group, alarms, CI deploy role); both ALB modes
- [x] `/api/health` with dependency checks; the structural test allows exactly this unauthenticated route
- [x] DashboardServiceStack deploy job in CI (`workflow_dispatch`, GitHub OIDC deploy role; run by the user)
- [x] Verify: `cdk synth` and assertions for both ALB modes, the execution role, the task-role shell and every "not created" resource; nothing deployed

### Phase 4R.1 — Identity, roles and sign-in (`feature/phase-4r-1-rbac-identity`)

- [x] `lib/auth` role model (global + scoped, union, `internal-viewer` default, legacy `Admin` alias, fail-closed parsing of `roles`/`groups`/`oid`/`tid`); identity record; session caps 8 h / 4 h / 1 h
- [x] `APP_ENV` in `env.ts` with placeholders in `build:ci` and `.env.example`; master user (Argon2id, TOTP, lockout, security events); local login with role choice; "no access" page; `AUTH_ACCESS_MODE`; dev login and e2e helper for every role
- [x] Verify: threat-model tests T1, T4, T7 (local login and env rejection), T20 (hash, TOTP, lockout, 1 h, security events), T21 pass
- *Split (2026-11-10, R1):* the persistent audit record and alarm for master-user events land in 4R.2; stored local users (data) in 4R.2 and `/api/local-users` with its Settings section in 4R.4 — *superseded 2026-11-14*: local users became password users (Access Control — *Password users*), data and sign-in in 4R.2, management in 4R.4. R1's local login offers the four global roles.
- *Security review fixes (2026-11-11, `fix/security-review-findings`; user direction):* delivered ahead of their phases — the task role's `IDENT#*` write leading key (4R.2; Platform spec — *Ownership*), `Cache-Control: private, no-store` on every `/api/*` response (4R.3) and the write same-origin and JSON content-type checks (4R.4; Access Control spec — *Enforcement* items 4 and 6). Also: the execution role's `kms:ViaService` condition, the response security headers (Platform spec — *Runtime*), `id` path-parameter validation on the team and department detail routes (Data Model spec — *API Routes*), the `403` message naming `internal-admin`, the sign-in error recorded on the span, and `OTEL_SERVICE_NAME` read through `env.ts`.

### Phase 4R.2 — Authorization data (`feature/phase-4r-2-rbac-data`)

*Split 2026-11-14 (user):* 4R.2 is delivered in three slices, each through
the Rule 70 loop. **R2a — access data layer and audit** (storage boundary,
affiliations with atomic move, admin scopes, pending items, role grants,
identity links with usage-key claims, audit records incl. `denied`, signed
cursors) and **R2c — platform** (pre-SSO inputs, Entra CDK inputs optional,
task-role statements, table resource policy, key policy, prod warning) are
delivered and on `main`. **R2b — sign-in** (group mappings, visibility,
sign-in resolution and sync, pending bind, password users, SSO binding,
sign-in/sign-out records, security-event persistence, the app side of the
CloudWatch audit copy and its `audit.delivery_failed` line, `requireAdmin`
→ `denied` wiring) remains, on `feature/phase-4r-2b-rbac-signin`. The tasks
below stay open until R2b lands; Verify runs once for the whole phase.
*Done 2026-11-14:* the integration items below were delivered on
`feature/phase-4r-2-integration` (approved) and the Verify passed locally
(`pnpm check` 3229 tests incl. DynamoDB Local integration). *Update 2026-11-14:* R2b-1 (sign-in) and R2b-2 (password users and SSO
binding) are approved and on `main`. Still open before the phase Verify:
register the `password` and `password-setup` providers in `auth.ts` (password
sign-ins recorded with method `password`); pass the shared audit sequence to
the `auth.signin.error` record; `withRoute` treats a session without
`user.oid` as unauthenticated; one-line clarification of resolution case 6
(pending admin-scope invite during overage).

- [x] Entities and `server-only` data access (affiliation, admin scopes, role grants, pending items, group mappings, visibility, password users with SSO reservations and references, identity links, audit); canonical usage identity in `packages/shared`; sign-in resolution and bind; atomic move; versioned writes with the audit item in the same transaction; the task-role DynamoDB policy added to the DashboardServiceStack and asserted (T19); seeds per role
- [x] Wire R1's security events (`auth.master.*`, `auth.signin.error`) to the audit record and the alarm (T20); the dev login rejected while Entra is configured (T7)
- [x] Pre-SSO mode and password users (Access Control — *Pre-SSO mode*, *Password users*, *SSO reference and binding*; D19–D25; amended 2026-11-14): `resolveSignInProviders` accepts `APP_ENV=prod` without Entra when the master user with TOTP is configured; Auth.js `password` and `password-setup` credentials providers (Argon2id, common-password list, per-user lockout, dummy-hash path, TOTP enrolment and replay check, envelope-encrypted secret); bind at Entra sign-in with the one-transaction move; CDK: Entra inputs optional as a pair, no Entra secret or grant without them, synth requires Entra or `masterUsername`, `SSOEXPECT#*`/`SSOREF#*` write leading keys
- [x] Storage boundary and data isolation (Access Control — *Storage boundary*, D21, D26; Platform — *Data isolation*; amended 2026-11-14): access-control data behind `lib/data/access/**` domain functions, access-control key builders moved out of `packages/shared`, opaque list cursors, behaviour-level integration tests; FoundationStack table resource policy and CMK key policy limited to the named roles, task role fixed name, optional `opsRoleArn` and `dynamodbVpcEndpointId` inputs (`prod` synth warning when `opsRoleArn` is unset); deployment guide and operations runbook steps for the break-glass permission set, CloudTrail data events and the `dev` isolation check
- [x] Audit additions (Access Control — *Audit log*, D17, D18; amended 2026-11-14): `denied` result with per-minute suppression and the `DeniedSuppressed` metric; `denied` record on `requireAdmin` refusals of the existing account write routes; `auth.signin.success` and `auth.signout` for every sign-in method
- [x] Verify: T2, T7, T8, T17, T18, T19, T21, T22 (record type and `requireAdmin` refusals; response bodies unchanged), T23, T24, T26, T27, T28, T29 (policy and key-policy assertions; no route, page or `auth.ts` import of the DynamoDB client or key builders — structural test) pass; integration tests against DynamoDB Local

### Phase 4R.3 — Server-side scoping (`feature/phase-4r-3-rbac-scope`)

- [x] `resolveScope`/`can` with the evaluation order and inheritance caps; every read route and Server Component filtered; aggregates after filtering; `404` parity; `Cache-Control: private, no-store`; scoped CSV, search and command menu; `/api/me` and `/api/me/usage`
- [x] Verify: role × route matrix and leak tests (T5, T6, T12–T16) pass; seeded probe per role recorded in the run report

### Phase 4R.4 — Management UI and writes (`feature/phase-4r-4-rbac-settings`)

- [x] Settings access sections (Design System — *Settings Page*); write routes with permission, origin, re-auth and `409`; structural write-route test updated; **Password users** section and routes (`/api/password-users`, reset, TOTP reset, `/api/account/password`, `/api/governance/password-sign-in`); sign-in form and `/account/setup` page; auth and deployment guides (Pre-SSO setup, enabling SSO later, turning password sign-in off)
- [x] Usage-identity mapping rules (Access Control — *Usage-identity mapping rules*, D27; amended 2026-11-14): rules editor in Settings (`GOVERNANCE`/`IDENTITY_MAP_RULES`, versioned, audited), suggested links for non-person usage keys, confirm one or all per rule, stored as exact aliases with `UsageKeyClaim` (`409` on duplicates); tests: `{name}-sso` → `{name}@company.com` suggests only existing identities, never auto-links, never grants access
- [x] Verify (review blockers fixed and approved, delta round 3, 2026-11-16): write matrix and T3, T9–T11, T16, T22 (one `denied` per authorization refusal, none on `400`), T7 (switch), T23, T24 (e2e setup), T25, T28 pass; axe clean; seeded probe per role

### Phase 4R.5 — UI gating and copy (`feature/phase-4r-5-rbac-ui`)

- [x] *My usage* page (`/dashboard/me`) and *My teams* landing; scoped labels, "not visible" / "no team" / "no access" states, role-aware landing, no dead links
- [x] Verify: e2e per role; seeded probe per role

> **Note (2026-11-16, mock-up review).** The navigation data (`lib/nav.ts`,
> `AppSidebar`, `AppHeader`, `CommandMenu`) belongs to this phase until it
> lands; the Phase 5 *UI refresh — compact workspace* builds the Management
> section, the role filter and the landing pages on top of it. The lead
> landing is now *My usage* (decided 2026-11-16, user; Access Control —
> *Navigation and landing by role*). The lead-scoped Bedrock/AWS cost view in
> the first task (*My teams*, "your teams" labels for a lead) was **removed
> in Slice B1 (decided 2026-11-17, coordinator under the user's
> delegation)**: a lead has no Bedrock/AWS cost view of its teams.

## LiteLLM units (L0–L8; decided 2026-11-10)

**Goal:** team and user administration of the existing LiteLLM proxy and LiteLLM-reported cost, per the [LiteLLM spec](2026-11-10-litellm.md). One branch and squash commit per unit (Rule 30.4), in order. L0 has no dependency. **L1 and L2 need 4R.1–4R.2 on `main` and the Phase 4.9 Settings shell, and may run in parallel with 4R.3–4R.5 (user direction 2026-11-14; Rule 30):** the L1 Settings → LiteLLM panel is its own `internal-admin` section in the existing shell and does not wait for the 4R.4 access sections. L3 needs L2 and 4R.3; L3b and L3c (added 2026-11-16, user) follow L3 and come before L4; L4 needs L3, L3b, 4R.3 and 4R.4; L5–L8 follow in order. A parallel L-unit owns `lib/litellm/**`, `app/api/litellm/**`, its Settings section and its `env.ts` and infra additions; it does not edit the policy module, existing Route Handlers or pages that 4R.3 changes. Each code unit runs the Rule 70 loop; L1, L2 and L4 add a dedicated security review against the spec's threat model (LT1–LT18). The fake LiteLLM (in-process HTTP or MSW, both editions) implements the allowlisted operations exactly per `docs/litellm/openapi.json`; no test reaches the internet (Rule 60.24).

### L0 — Spec, version pin, contract (`docs/litellm-admin`)

- [x] Contract snapshot `docs/litellm/openapi.json` (1.108.3, fetched 2026-11-10, SHA-256 recorded); endpoints and fields confirmed; allowlist table with toggle defaults; service-key `allowed_routes`; threat model; decisions LD1–LD13
- [x] Amendments: System Architecture (*LiteLLM Integration*), Data Model, Access Control error codes, Design System (*LiteLLM Page*), Platform, Rule 10; runbook `docs/guides/litellm-admin.md`
- [x] Verify: `spec-guardian` APPROVE

### L1 — Secrets, connection and permissions (`feature/phase-l1-litellm-connection`)

- [x] `env.ts`: `LITELLM_SERVICE_KEY` (server-only, optional; missing → "not configured") and `LITELLM_ALLOWED_HOSTS`, with placeholders in `build:ci` and `.env.example` (no real values); `edition` derived from `APP_ENV`
- [ ] Local development connection (LiteLLM spec — LD17; amended 2026-11-14): `.env.example` documents `LITELLM_ALLOWED_HOSTS=localhost:4000` and an empty `LITELLM_SERVICE_KEY` (value only in `.env.local`); connection test against the local LiteLLM; confirm a Management key honours `allowed_routes`; refresh `docs/litellm/openapi.json` from the live 1.109.1 instance before L2
- [x] `lib/litellm/client.ts` (`server-only`): base URL from `LiteLLMConnection`, host allowlist, `https` in prod, no userinfo/query/fragment, 10 s timeout, GET retries ≤ 2, writes never retried, sanitised error mapping (`LITELLM_UNAVAILABLE`); every LiteLLM route `403` in `open` mode
- [x] `/api/litellm/connection` (GET/PUT, test-before-save, versioned, audited) and `/api/litellm/connection/test`; Settings → LiteLLM panel (status, URL, edition, test; no key entry)
- [x] DashboardServiceStack: `LITELLM_SERVICE_KEY` in the task definition's `secrets`; the task role gains the `LITELLM#*` write leading key (moved from L2, 2026-11-14) (`valueFrom` the parameter ARN); execution role `ssm:GetParameters` on that ARN and `kms:Decrypt` on the CMK with `kms:ViaService`; no SSM or KMS permission on the task role; `TaskSecurityGroupId` stack output for LiteLLM's ingress rule (no egress rule; same subnets, amended 2026-11-14); the connection test probes the templated routes through the temporary `/team/*` and `/key/*` wildcards (LD4, amended 2026-11-15), and on OSS it skips the Enterprise-only regenerate route (Edition, amended 2026-11-15); synthesised and asserted, never deployed
- [x] Verify: LT1 (bundle and static-output grep, response/log/span scans), LT2, LT6, LT11, LT12 pass; CDK assertions (execution role only, one ARN, no `ssm:PutParameter`, secret never in `environment`); `401` → "rotate and redeploy", no retry

### L2 — Gateway and toggles (`feature/phase-l2-litellm-gateway`)

- [x] `lib/litellm/` one typed function per allowlisted operation (fixed method and path, strict Zod builders, Zod-parsed responses); edition gate; `OperationToggles` (versioned, audited, defaults per the spec); `TeamLink` + `TeamLinkClaim`; `/api/litellm/toggles`, `/api/litellm/team-links` (the task role's `LITELLM#*` write key landed in L1)
- [x] Fake LiteLLM for both editions; contract test of every call against the snapshot
- [x] `litellm-changed-by` on every write call, built from the session (LiteLLM spec — *Audit*, LD14)
- [ ] Gateway guardrails (LiteLLM spec — *Gateway guardrails*, LD4, LD18; decided 2026-11-15): one outbound choke point, path-parameter validation and encoding, hard-limit denylist test, exact bodies, wildcard warning on the panel; the runbook records the key setting that refuses inference (LD18)
- [x] Guardrail configuration (LiteLLM spec — *Guardrail configuration*, LD19; decided 2026-11-15): `apps/dashboard/config/litellm-gateway.json` + `LiteLLMGatewayConfigSchema` (startup validation, narrow only); read toggles; effective value + source per operation and the read-only guardrail summary on the Settings → LiteLLM panel; reset to file defaults (audited). *Amended 2026-11-17 (unit CFG, user decision D1): the file moves to `config/config.yaml` and wins over the UI for the operations it sets; the reset keeps file-set operations (LiteLLM spec — LD19).*
- [x] Verify: structural allowlist test; `allowed_routes` list = runbook = gateway paths; LT3, LT4, LT7, LT14, LT15, LT17, LT19; disabled operation (write or read) → `403 OPERATION_DISABLED` with no call; precedence UI > file > LD10 (superseded 2026-11-17 by unit CFG: file > UI > LD10 for file-set operations, user decision D1; LiteLLM spec — LD19); the config schema rejects an unknown operation, route or field and any `enabled: true`; connection-test probes ignore read toggles

### L3 — Read views (`feature/phase-l3-litellm-views`)

- [x] Scoped read routes (`/api/litellm/me`, `/teams/[teamId]`, members, keys metadata, spend logs, models); `/dashboard/litellm` with *My usage*, *Team spend & budgets*, *Members*, *Keys*, *Model access* (read), *LiteLLM audit* (`/api/litellm/audit`, Admin and Auditor, audited view; LD15), each in its own Suspense + ErrorBoundary; "LiteLLM-reported" labels; outage and "not connected" states; nav item
- [ ] Verify (landed without the phase review, user one-off skip 2026-11-15; e2e probe ran against stubs only): role × read matrix (unauthenticated, no role, Viewer own/other, Lead own/other/department incl. moved team, Auditor, Admin) with `404` parity; LT8 labels; LT20; outage leaves other pages working; e2e probe (fake unless a non-production LiteLLM is provided)

### L3b — Views by role and Settings tabs (`feature/phase-l3b-litellm-role-views`)

*Added 2026-11-16 at the user's direction ("add the following improvements"); runs after L3 and before L4.*

- [x] `/dashboard/litellm` as tabs (nuqs `tab` URL state): *My usage* (all roles), *Team* (Lead in scope, org-admin, Admin, Auditor: team spend, members' usage, keys, model access), *Organisation* (org-admin, Admin, Auditor: totals across linked teams and a per-team table), *Users* (search; Lead within its teams, org-admin, Admin, Auditor), *Audit* (Admin, Auditor); a tab the caller cannot use is not rendered (LiteLLM spec — *Views by role*)
- [x] Routes `/api/litellm/org` and `/api/litellm/users` (search) and `/api/litellm/users/[litellmUserId]` (one user's usage); new allowlist row `searchUsers`; *My usage* resolves an unlinked caller by `findUserByEmail` on the session email (read only)
- [x] Settings → LiteLLM as tabs: *Connection*, *Guardrails*, *Team links* (with a team search), *Users* (the same user search) (*superseded 2026-11-17:* L6 added *Gateway*, and management improvements MI-D3 moves *Team links* and *Users* to Management → LiteLLM, so Settings → LiteLLM keeps *Connection*, *Guardrails* and *Gateway* — unit M1)
- [ ] Verify (landed before its review blockers B1–B3 and G5 were fixed, user direction 2026-11-16; fix list temp/run-l3b/review-blockers.md): role × tab and role × route matrix (Viewer, Lead own/other/department, org-admin, Auditor, Admin) incl. `searchUsers` scoping for Leads (LT21); axe clean; e2e per role

### L3c — Dev identity login (`feature/phase-l3c-dev-identity-login`)

*Split from L3b (agent decision, 2026-11-16: `auth.ts` is held for the 4R.4 fix, so the views ship first; reversible).*

- [x] Dev login as a chosen identity (Access Control — *Dev login*, amended 2026-11-16), additive to `auth.ts` once the 4R.4 fix is on `main`
- [ ] Verify (landed 2026-11-16 at the user's direction; the e2e case dev-login.spec.ts:73 waits for the L3b fix B4; the stored-roles change follows as L3c2): an existing identity's email or `oid` signs in as that identity with its stored `lastSeenRoles` (amended L3c2: the form role is ignored when an identity is given, an unknown email or `oid` is refused, no `dev-` identity); with no identity the form role decides access; rejected in `prod` and with Entra configured (T7, LT21)

### L3d — Org-admin config writes (`feature/phase-l3d-org-admin-config`)

*Added 2026-11-16 at the user's direction (LiteLLM spec LD24); after L3c, before L4.*

- [x] `internal-org-admin` may `PUT /api/litellm/toggles` (including reset) and write team links; `PUT /api/litellm/connection` and `POST /api/litellm/connection/test` stay `internal-admin` only; reads add org-admin; Rules 10.3 and 50.4 amended
- [x] **L3d2 — Settings → LiteLLM panel for org-admin** (per-section edit flags: toggles and team links editable, connection read-only), built in unit A (improvements) together with the Auditor read-only view (agent decision, 2026-11-16, coordinator: `components/settings/**` belongs to unit A, which already reworks the panel's visibility); delivered by unit A1 (`feature/unit-a1-litellm-panel-roles`, 2026-11-16) with `litellmPanelCapabilities` in `lib/auth/` and the grouped Guardrails tab (Design System — *LiteLLM Page*)
- [x] Verify: `write-routes.integration.test.ts` allowed (org-admin toggles, team links) and refused (org-admin connection `PUT` and test `403`, one `denied` record; Viewer, Lead `403`) cases; LT22

### L4 — Lead and admin writes (`feature/phase-l4-litellm-writes`)

- [x] Write routes for every allowlisted write (members, budgets, resets, enable/disable, keys incl. shown-once generate and edition-aware rotate, team models, team/member/key limits, team budget, team create and link); limit and budget validation against current team values; audit records; orphaned-member list route `/api/litellm/orphans` (workflow pilot candidate — *Workflow pilots*); its Settings display goes to unit A with the panel (agent decision, 2026-11-16: `components/settings/**` belongs to unit A)
- [x] Team configuration page `/dashboard/litellm/team-config`, interim until ui-compact Slice B mounts the same `components/litellm/team/*` on Management → Team (LiteLLM spec — *Team configuration page*, LD25; user, 2026-11-16): Lead in scope, org-admin, Admin; Viewer, member, Auditor and out-of-scope `404`; a "Configure team" link in the *Team* tab; no `lib/nav.ts` edit
- [x] Team members: Leads create, update and delete members (`addTeamMember` with the add-member candidates picker, `removeTeamMember` default on; LD10, LD16, LD26)
- [ ] Team join link: `inviteTeamMember`, added only after the operators confirm the endpoint and the snapshot is refreshed (LD16); until then the UI invites through `addTeamMember` — not built (waits on the operators)
- [ ] Verify: write matrix; LT5, LT9, LT10, LT13, LT16, LT18 (privileged member → `409`, no key or membership write); one audit record per success/failure, one `denied` per authorization refusal (incl. `409 PRIVILEGED_TARGET`) and none on other rejections; structural write-route test includes every LiteLLM write route; e2e probe

> **Note (2026-11-16, mock-up review).** The Team page (Management → Team;
> Design System — *Management pages*) carries this unit's member, budget and
> reset-spend controls: edit budget, reset spend per member row and the bulk
> "Reset spend for all members", add and remove member, each destructive one
> behind a named confirmation. They are built with this unit; until an
> operation is enabled the control is absent, not dead (`resetMemberSpend`
> default **off**, LD10). The page adds no LiteLLM call of its own (Rule 10).

### L4b — App-team spend (`feature/phase-l4b-app-team-spend`)

*Added 2026-11-17 at the user's direction ([App Teams spec](2026-11-17-app-teams.md); LiteLLM spec LD29–LD35); after L4, before L5. Depends on L3b, L4 and the Management → Team page (ui-compact Slice B2) being on `main`.*

- [x] Fold the App Teams spec into the LiteLLM spec (roles, reads, identity mapping, cost, routes, views, decisions LD29–LD35, threat model LT23–LT28, residual risks), this unit, Rule 00's index, CLAUDE.md's spec list and `docs/future-improvements.md`
- [x] Schemas in `packages/shared`: `spendSource`, `memberSum`, coverage, the Organisation response (valid and invalid cases, Rule 60.22)
- [x] `lib/litellm/member-sum.ts` (`server-only`): bound of 5 concurrent reads (`runBounded`), 200 members per team (`422 TOO_MANY_MEMBERS`), no partial sum on a failed read
- [x] Routes `GET /api/litellm/teams/[teamId]` (`spendSource`, `memberSum`, `?include=memberSum` for Admin, org-admin, Auditor) and `GET /api/litellm/org` (`litellmTeams[]`, `appTeams[]`, 200-read budget, `open-team`); `TOO_MANY_MEMBERS` joins the error codes; no new route
- [x] UI: Team page (source badge, coverage line, member table and app membership add and remove on an unlinked team, second figure for Admin, org-admin and Auditor on a linked team), Organisation page (two tables), Settings → LiteLLM → Team links "Spend source" column
- [x] Runbook `docs/guides/litellm-admin.md`: linked and unlinked teams, what each figure means
- [x] Verify: an unlinked team gives a Lead `spendSource: "member-sum"` with daily rows, a total equal to the member rows and coverage counting matched, unmatched and pending members
- [x] Verify: a linked team gives a Lead the LiteLLM team figures and no `memberSum`, with or without `include=memberSum`; Admin, org-admin and Auditor get both with it
- [x] Verify: out-of-scope and missing teams return the same `404`; a Viewer gets no team view
- [x] Verify: under the Organisation cap member rows carry no `spend` and the total is present
- [x] Verify: 201 members gives `422 TOO_MANY_MEMBERS` and no LiteLLM call; one failing member read fails the request; `getUserDailySpend` off gives `403 OPERATION_DISABLED`
- [x] Verify: Organisation total equals the sum of the LiteLLM teams rows for the selected range (LD36); an unlinked LiteLLM team appears; an app team beyond the read budget (200 LiteLLM calls, LD34) shows `open-team`
- [x] Verify: no LiteLLM control renders on an unlinked team's page and every L4 write route still refuses an unlinked team
- [x] Verify: `lib/litellm/structure.test.ts` passes with the same operation set; no new route in `test/route-registry.ts`
- [x] Verify: LT23–LT28 (ATT1–ATT6) each have a test; an e2e smoke covers the Team page for one linked and one unlinked team
- [x] Verify: branch gate green (Rule 70.12)

### L5 — Polish and verification (`feature/phase-l5-litellm-polish`)

- [x] Spec: LiteLLM spec — *Polish and verification (L5)* (scope, accessibility floor, responsive, the role × operation matrix, the probe, the runbook outline; agent decisions, 2026-11-17)
- [x] **L5b** (after ui-compact B2 lands; split 2026-11-17, coordinator): accessibility floor and responsive checks on the LiteLLM pages at their `/dashboard/manage/*` routes and My usage (axe per role, keyboard walk of the team selector, the Audit source filter and every dialog, text for every state, cards below `md` for every LiteLLM table with a UI; `e2e/litellm-a11y.spec.ts`). Not built here: the Team page view tabs and member search (moved to B2b, below); spend logs have no UI; the Lead is exercised as org-admin in the main e2e project (the real team-scope Lead runs in role-probe)
- [x] Role × operation matrix test from the spec table, against the fake (workflow pilot candidate — *Workflow pilots*; built without a workflow; the page row moves to L5b)
- [x] Runbook `docs/guides/litellm-admin.md` completed per the spec outline (§11's page path is updated in L5b after B2)
- [x] Probe: `pnpm probe:litellm` (opt-in `LITELLM_PROBE=1`, local `localhost:4000` only, never `prod`; outside `pnpm test:e2e`, `pnpm check` and CI) on the `llmul-probe` fixture team, with the fake mode `pnpm probe:litellm:fake` (LiteLLM spec LD28)
- [x] Verify (L5): matrix green; the probe run in the named fake mode (`pnpm probe:litellm:fake`, 9/9, 2026-11-17) with its keys and member cleaned up and toggles restored; a real local LiteLLM run is a user action
- [x] Verify (L5b): axe clean per role and dialog state; no horizontal scroll at 375 / 768 / 1024 / 1440 / 1920 (1920 in `litellm-a11y.spec.ts`, the rest in the B2 specs); cards below `md`
- Moved to **B2b** (coordinator, 2026-11-17): the keyboard walk of the Team page's view tabs and member search, with the features themselves (Design System — *Management pages*)
- [x] **Built in B2b** (`feature/ui-slice-b2b-team-tabs`, 2026-11-17): the Team page view tabs (Members, Budgets, Keys; `?view=` with history push; Members only for an unlinked or not-configured team), member search, G1 member daily spend (linked teams; existing users route), G2 Organisation → Team links, Rotate focus return, axe on the 375 cards and at 1920, the LD37 card test, shared `MemberActions`/`KeyActions`, and the keyboard walk of the view tabs and search (Design System — *Management pages* → *Team page views and links*)

### L6 — Combined usage and *My usage* (`feature/phase-l6-litellm-combined`)
 *(M5-D2, 2026-11-18: the Teams "Combined with LiteLLM" panel was removed, because D17 forbids a mixed Combined column; `GET /api/litellm/combined/teams` stays with no UI consumer.)*
- [x] `GatewayConfig` (`/api/litellm/gateway`, audited; Settings → LiteLLM → Gateway sub-tab); combined totals on Overview, Teams and Team Detail per shared contract §5 (parts shown, gateway slice, reconciliation, unconfigured warning); *My usage* combined card; R5 landings extended (Overview and My usage open on the combined headline); `getUserDailySpend` paging fix
- [x] Users: the person's combined figure on Management → Users (user detail, under the Organisation cap); **not built:** a combined column on the Users list (one LiteLLM call per row; LD38 — a bulk read is a future improvement)
- **Declined (user decision U1, 2026-11-17: no):** the organisation's LiteLLM part covers LiteLLM teams only; spend on keys outside any team would need a proxy-wide read that widens the allowlist, so it is not built
- [x] Spec: LiteLLM spec — *Combined usage and My usage (L6)*, LD38, LT29–LT34 (agent decisions, 2026-11-17); user decisions U1 (proxy-wide read: no, 2026-11-17) and U2 (production gateway values: open) recorded
- [x] Verify: counted-once fixture (gateway traffic not doubled; `lib/litellm/combined.test.ts`, both gateway forms); hidden combined totals without a gateway for Viewers and Leads (route matrix, server-side hidden body; e2e My usage); warning for Admins and Auditors (and org-admin, LD38; route matrix, e2e Overview)

### L7 — Self-service key requests (`feature/phase-l7-litellm-key-requests`)

- [ ] `KeyRequest` entity and routes; request (models ⊆ team, limits ≤ member, required expiry ≤ ceiling), Lead approve/reject, requester-only "Create and reveal once"; 7-day expiry; ≤ 3 open per person; toggle off by default
- [ ] Verify: Lead never receives the value; rejected/expired requests cannot be revealed; LT18 at reveal (privileged requester → `409`); audit per step

### L8 — Monthly statement (`feature/phase-l8-finance-statement`)

- [ ] `/api/finance/statement` CSV per shared contract §9 (department, team, Bedrock exact finalised, LiteLLM-reported, combined, reconciliation, provisional flag) for Admin, Auditor and Leads in scope; downloads audited
- [ ] Verify: totals equal the combined rules; scope filtering; provisional flag for unfinalised months

---

## Settings admin area (unit D; decided 2026-11-16)

### D — Settings split into tabbed route pages (`feature/settings-admin-area`)

*Added 2026-11-16 at the user's direction ("the Settings screenshot is too large"); [Design System — *Settings Page*](2026-05-15-design-system.md). Structure only: routes, tab rows, visibility, redirects. It uses the existing `Tabs` and section components and waits for no ui-compact component (scope limit).*

- [x] Routes `/dashboard/settings/{accounts,sync,litellm,audit}` and `/dashboard/settings/access/{people,visibility,roles,identities,sign-in}`; `/dashboard/settings` and `/dashboard/settings/access` redirect on the server to the first visible tab or sub-tab; a tab the caller cannot use is not rendered and its URL returns the same `404` as a missing page (each page authorizes itself per request)
- [x] Pure visibility function in `lib/settings-tabs.ts` driven by `accessCapabilities`; tab row and Access sub-tab row on the existing `Tabs`, active by route, horizontal scroll at 375
- [x] Hash resolver: old `/dashboard/settings#<section-slug>` links (including `#role-grants`, `#password-users`) land on the right tab and sub-tab; the step-up itself returns to the final tab URL (Access Control D33a)
- [x] Verify: per-role tabs and sub-tabs exactly as the matrix (admin, org-admin, auditor, team admin, viewer without scope, master user); a forbidden tab URL is `404`; hash redirects; Back works across tabs; every tab axe clean and without horizontal page scroll at 375/768/1024/1440; no tab taller than about two screens at 1440×900; every old per-role section assertion still holds on its new tab

## App config file (unit CFG; decided 2026-11-17)

### CFG — app config file (`feature/app-config-yaml`)

*Added 2026-11-17 at the user's request (2026-11-16: configure the app from a `config.yaml` that wins over database configuration, is loaded at startup and ships in the Docker image; clarified the same day that it does not replace `.env`); [System Architecture — *Configuration file*](2026-05-15-system-architecture.md) is authoritative, with decisions D1–D3, Q1–Q3 and A1–A16 recorded there. Runs at the coordinator's direction (landed in `5484f125`; its run plan was removed on 2026-11-18); its locked-state UI sits on the Settings tabs of unit D and the toggle routes of L3d. One branch, one squash commit (Rule 30.4).*

- [x] Spec amendment: System Architecture *Configuration file*; LiteLLM spec LD19 and *Guardrail configuration* (file > UI > LD10 for file-set operations); Data Model *Settings shadowed by the configuration file* and the retention key; Platform *Runtime* image contents; Design System stack and Rule 40 (`yaml`); Access Control T35–T39 and the `CONFIG_FILE_LOCKED` error code; this block
- [x] `AppConfigSchema` and its inferred type in `packages/shared` (strict; `litellm.operations` is the former `LiteLLMGatewayConfigSchema`; `display.defaultDateRange`, `display.orgName`, `data.retention.dailyRollupDays`; secret-shaped and authorization keys rejected)
- [x] `apps/dashboard/lib/config/app-config.ts` (`server-only`): reads `config/config.yaml` or `APP_CONFIG_FILE` once, `yaml` with safe options and a 64 KiB cap, validates, freezes; typed accessors and `isFileSet(keyPath)`; startup emits file-set key paths (names only) through OpenTelemetry
- [x] `config/litellm-gateway.json` converted into `config/config.yaml`: its two `litellm.operations` entries kept as commented examples, not set (A16), every other key documented as a comment; the JSON file and its import deleted; `loadGatewayConfig()` unchanged for callers
- [x] One resolver per v1 setting (operation toggles; default date range; organisation name with the deprecated `NEXT_PUBLIC_ORG_NAME` fallback; rollup retention shown on Settings → *Sync and data*)
- [x] `PUT /api/litellm/toggles`: `409 CONFIG_FILE_LOCKED` for a file-set operation after `401`/`403`/`400`, before any write, one `denied` audit; `reset` keeps the saved values of file-set operations; registered in the shared route-contract suite (Rule 60.23)
- [x] Settings → LiteLLM *Guardrails*: "Set in config.yaml" badge and disabled toggle for file-set operations (source `file`)
- [x] `apps/dashboard/Dockerfile` copies the file into the runner stage at the loader's path, owned by `root:root`, mode `0444` (the runtime `app` user can read it but not change or chmod it); `outputFileTracingIncludes` added if the `standalone` output needs it; `infra/` changes only if the task definition must set `APP_CONFIG_FILE` *(Built 2026-11-17: the COPY is required, since the standalone trace does not include the file; `outputFileTracingIncludes` is not needed and `infra/` is unchanged. `docker build` not run, because Docker is not installed on the build machine.)*
- [x] `APP_CONFIG_FILE` in `env.ts` and `.env.example`; `NEXT_PUBLIC_ORG_NAME` marked deprecated; docs: `docs/guides/operations.md` (edit the file, rebuild, redeploy; restart needed), `docs/guides/dashboard-deployment.md`, `README.md` *(Built 2026-11-17: `.env.example`, `env.ts` and the three guides; `NEXT_PUBLIC_ORG_NAME` is optional with no default so the variable step of the order is reachable.)*
- [ ] Verify: schema rejects an unknown key, a wrong type, a duplicate key, a secret-shaped key, each authorization key and `enabled: true` (T35, T36, T38); loader: missing default file → empty config, missing `APP_CONFIG_FILE` file → throws, invalid or oversize file → throws naming the key path with no value, the file is read once (T38); the converted file yields exactly the former gateway config; precedence per v1 setting against DynamoDB Local — file only, database only, both (file wins), neither (default), and removing the key restores the stored value; `409 CONFIG_FILE_LOCKED` with no write and one `denied` audit, `401` and `403` first, a write to an unset operation still succeeds (T39); badge and disabled control on a file-set operation, an unset one editable (T37); one headless e2e spec with a fixture file shows the locked setting and the app starts with the checked-in file; gitleaks green on the file (T36); `pnpm build:ci` green; `docker build` puts the file at the expected path (or Docker's absence is reported); `cdk synth` clean if `infra/` changed

---

## Base path (unit BP; decided 2026-11-17)

### BP — serve the dashboard under a URL prefix (`feature/base-path`)

*Added 2026-11-17 at the user's direction ("all path for the app should start with a prefix, i.e: llm-lens/ … create a rule"): the POC adds a listener rule to an existing ALB listener on port 443 that another application already uses. Outside the phase order (Rule 30). [Platform spec — *Base path*](2026-11-10-platform.md) records BP-D1 to BP-D7, BP-D9, BP-D13, BP-D15 and Q1 to Q3; [Access Control — *Decisions*](2026-11-10-access-control.md) records BP-D8, BP-D10 to BP-D12 and BP-D14 and threat items T40 to T43. Q1 (`/llm-lens` is final) and Q2 (the ECS platform does not serve under the prefix) are user answers, 2026-11-17; Q3 (listener ARN, free rule priority, no clash under `/llm-lens`) is open and lives only in gitignored `poc/stack.env`. Runs at the coordinator's direction (landed in `ae9c4c95`; its run plan was removed on 2026-11-18). One branch, one squash commit (Rule 30.4).*

- [x] Spec amendment: Platform *Base path*, *Runtime* and *Load balancer*; Access Control *Decisions* and *Threat model*; `docs/guides/auth-setup.md`; `docs/guides/testing.md`; Rule 50.2 exception; this block
- [x] App: `lib/base-path.ts` (BP-D13); `NEXT_PUBLIC_BASE_PATH` in `env.ts`, `.env.example` and `next.config.ts` (BP-D1, BP-D2); `withBasePath` at the raw-URL sites (BP-D3); `auth.ts` (`basePath`, `pages`, `redirect` callback, `authorized`, cookie names and path: BP-D9 to BP-D12); `[...nextauth]` route wrapper; `sidebar_state` path; Dockerfile `ARG`/`ENV` (BP-D6); sign-out menu item keeps its form mounted (BP-D14)
- [x] `infra/`: optional `basePath` context; health path and `NEXT_PUBLIC_APP_URL` carry the prefix when one is configured, `AUTH_URL` stays origin-only (BP-D9); synth output unchanged with none (Q2, T12)
- [x] POC: rule mode in `poc/cloudformation.yml`, deploy and build scripts, `stack.env.example`, Compose healthcheck, `.env.example` and `README.md` (BP-D5 to BP-D7, BP-D15; T13)
- [x] Prefixed Playwright project (port 3214, started on request — BP-D15; [testing guide](../guides/testing.md) — *Prefixed e2e project*)
- [ ] Verify: with `NEXT_PUBLIC_BASE_PATH=/llm-lens`, every URL the app serves or links to starts with `/llm-lens` and nothing outside it answers (`/`, `/api/health`, `/dashboard`, `/llm-lens-other/...` are `404`) — T5 to T11; with the variable empty, behaviour is unchanged (branch gate green with `main` merged in, unprefixed full e2e passed once); the POC template has rule mode and T13 passed, and `poc/README.md` commands match the template, scripts and Compose file; the review approved, including the security pass on BP-D8, BP-D11 and BP-D12 (T7, T8); no AWS deploy, ALB change, image push or Entra registration was done (user actions)

---

## Management improvements (units M0–M5; user-directed 2026-11-17)

*Added 2026-11-17 at the user's direction: sixteen requests about the LiteLLM area, app teams, users, the source of each cost figure and on-demand budget resets, run now, before L7, L8 and the rest of Phase 5 (M0–M5 have landed; their run plan was removed on 2026-11-18). Decisions D1–D7 and D14–D19 (with D4a and D16a) are recorded in the specs below with their reasons (MI-D… in Access Control and the LiteLLM spec); user decisions are marked, the answers Q1–Q4 are user decisions, and Q7 (a LiteLLM "service" dimension) was answered no by the user on 2026-11-17 (D19). Unit **M4** (budget reset requests, the reset ledger and notifications, D8–D13) records its own block and its spec sections; the run directions (order, tests near the end, workflow) are below. One branch and one squash commit per unit (Rule 30.4); M1, M2, M3 and M5 branch from `main` once M0 is on it, or from M0's tip at the coordinator's word.*

**Run directions (user, 2026-11-17)**, for the management-improvements run
(units M0–M5; M0 records the other units):

1. **Priority.** All sixteen items of the run (units M0–M5) run now, before
   L7, L8 and the rest of Phase 5 (Rule 30 — *Build order*, exception).
2. **Parallel agents and workflows.** "multiple subagent in parallel and
   workflows" — the user's opt-in for the workflows of the run (*Workflow
   pilots*).
3. **Tests near the end.** "avoid to add tests on each step, add test near
   to the end." For units M1–M5 and M4, each unit is built first and tested
   in one pass at its end (Rule 70, exception). It changes the order, not
   the bar: every row of the test table below is still proved.
4. **The coordinator reviews.** "coordinator will run quality and security
   checks." The worker runs no review agent and stops at a green branch
   gate (Rule 70.12 — *Batched under a coordinator*).
5. **The budget reset button first.** "I want the budget reset button as
   top priority." M4 starts at once, gets agents first and is handed over
   first; it lands next, and a unit that lands after it merges `main`.
   Amended 2026-11-18 (coordinator): "landed first" is superseded because
   M0 and M1 had already landed before M4 was ready.

### M0 — Spec for the management items (`docs/management-improvements`)

- [x] Design System: *Navigation (Sidebar)* order and items (D1, D2, D7), *Routes and redirects* (D3), *Source panels on Cost by team, Cost by user and Cost by service* (D17–D19), *Settings Page* LiteLLM sub-tabs (D3), *Management pages* Team page without its spend (D7) and *Management improvements* (LiteLLM area, D4a pickers, Team usage, the table "where each role reads team spend", New team, Users and Add user, the LiteLLM users list and link states, the team lead option — renamed from "dev lead" at the user's direction, 2026-11-18)
- [x] Access Control: *Hierarchy* (created teams), *Roles* and *Configuration* (org-admin writes), *Dev login* (D14), *Navigation and landing by role* (MI-D1 to MI-D4, MI-D7 with the `teamUsage` flag), permission matrix rows (create an app team; the LiteLLM user link), *LiteLLM user links*, *Created app teams*, *Data model additions* (`AppTeam`, `AppTeamNameClaim`, `LiteLLMUserClaim`), *API routes*, threat items T-MI1 to T-MI4, one residual risk
- [x] LiteLLM spec: *Roles and rights*, `searchUsers` with an optional search text, the `createUser` write row and its rules, `linkUser`/`unlinkUser`, *Identity mapping and members*, *API routes*, *Views as Management routes* (the LiteLLM area), the L5 matrix rows, decisions MI-D2 to MI-D17–D19 and Q7, threat items LT-MI1 to LT-MI4
- [x] App Teams spec (*Teams without an AWS account*, *UI*), Data Model (*Entity: AppTeam*, *API Routes*), System Architecture (*Organizational Hierarchy*), `docs/guides/litellm-admin.md` (§9, §9b), `docs/future-improvements.md` (app team rename and delete; the LiteLLM service dimension)
- [x] Rules 40 (sidebar order), 10 and 50 (the new write routes and who may call them)
- [ ] Verify: every changed statement grepped in `docs/specs/**` and `.claude/rules/**` and updated or marked superseded (Rule 70.12 — *Ready self-check*); no rule contradicts its spec; `pnpm format:check` green; the coordinator's review approved

### M1 — Navigation and the LiteLLM area (`feature/manage-litellm-area`)

*Items 2, 4, 9, 10, 11, 15; decisions D1–D4a (Design System — *Navigation (Sidebar)*, *Management improvements*; Access Control — MI-D1 to MI-D4; LiteLLM spec — *Views as Management routes*).*

- [x] `lib/nav.ts`: Usage order Overview, My usage, Team usage, Ranking, Cost by department, Cost by team, Cost by service, Cost by user; Management order Users, Team, LiteLLM, Audit; no Organisation item; the sidebar, `PageTitle` and `CommandMenu` share the one filter — **built except** the Team usage item, which is present but hidden behind `TEAM_USAGE_ROUTE = false` until M2 lands its page (done 2026-11-18, line below)
- [x] Team usage nav item shown (`TEAM_USAGE_ROUTE = true`, set with `/dashboard/team-usage` in the M2 merge, 2026-11-18)
- [x] `lib/manage-access.ts`: the `teamUsage` flag (MI-D7: a global reader, or a caller with a live admin scope) and the `litellm` flag replacing `organisation` (MI-D2); a read failure closes every flag
- [x] `/dashboard/manage/litellm/{organisation,teams,users}` route tabs on the one `Tabs` component; the index redirects to the first visible tab; Organisation content moved; Team links (with **New LiteLLM team** for `internal-admin`) on *LiteLLM teams*; the *LiteLLM users* tab mounts M3's components by import only — **built except** M3's components: the *LiteLLM users* tab mounts today's `LiteLLMUsersSection` until M3 lands
- [ ] *LiteLLM users* tab mounts M3's components (by import, when M3 is on `main`)
- [x] Settings → LiteLLM keeps Connection and Guardrails (and L6's Gateway); the four old URLs redirect on the server and keep their query
- [x] Team link form: both ids from searchable lists (D4a), linked ones shown and not selectable, no free-text id field, an unreadable LiteLLM list says so; `litellmTeams` on `GET /api/litellm/team-links`
- [ ] Verify (one test pass at the end; Design System — *Navigation (Sidebar)*, *Routes and redirects*, *Management improvements*; Access Control — *Navigation and landing by role*, MI-D1 to MI-D4, MI-D7; LiteLLM spec — *Views as Management routes*, LT-MI3): the order of both groups per role (admin, org-admin, auditor, lead, user, a global reader with a scope); the Team usage item present for admin, org-admin, auditor and a lead with a live scope, absent for a user and a lead whose only scope is suspended (`teamUsage`); the LiteLLM item and each tab per role — present, read-only, absent and `404`; every old URL redirects and keeps its query; team-link writes: admin and org-admin allowed, auditor and lead `403`; the link form offers every app team and every LiteLLM team, marks linked ones as not selectable, has no free-text id field, and the server still refuses an unknown id and a duplicate (LT-MI3); full e2e once at the green gate (shared files); branch gate green with `main` merged in (Rule 70.12)

### M2 — App teams and the Team page (`feature/app-team-create`)

*Items 3, 5; decisions D5–D7 (App Teams spec — *Teams without an AWS account*, *UI*; Access Control — *Created app teams*, MI-D7; Data Model — *Entity: AppTeam*).*

*Ownership (M0 review round 1, 2026-11-17):* besides the files in the prompt's M2 row, M2 owns the created-team name check in the account routes — `app/api/accounts/route.ts` and `app/api/accounts/[id]/route.ts` (and their tests): `POST` and `PATCH` refuse a created team's name (`409`; Data Model — *Entity: AppTeam*). The Organisation view's `open-team` link to Team usage sits in `components/litellm/OrganisationSection*`, which M4 owns: M2 sends `overlap mg-2: components/litellm/OrganisationSection*` to the coordinator before that one-line change.

- [x] `AppTeam` and `AppTeamNameClaim` through `lib/data/access/app-teams.ts` (storage boundary, D26); schema in `packages/shared`; the reserved `appteam-` prefix refused by the account input schemas
- [x] `POST /api/teams`: `internal-admin` and `internal-org-admin`, `403` before parsing with one `denied` record, Zod body, `409` on a duplicate name, generated id, audit in the same transaction, `revalidateTag` for the team-list tags; registered in `test/route-registry.ts`
- [x] `GET /api/access/org-units` lists created teams with `hasAwsAccount`; the policy module covers a created team through its stored department
- [x] Team page: **New team** (admin, org-admin); `TeamSpendPanel` removed for every role
- [x] `POST /api/accounts` and `PATCH /api/accounts/[id]`: a `teamName` equal to a created team's name is `409`, no write (both-ways name check; Access Control — *Created app teams*)
- [x] `/dashboard/team-usage`: team picker over the caller's scope (a lead) or every team (a global reader); linked and unlinked figures as the panel showed, labelled "LiteLLM-reported"; for a global reader `include=memberSum` (the linked team's second figure on request). *Built 2026-11-18; the page gates on `managementAccessFor(...).team`, now `teamUsage`, the same rule (agent decision below).*
- [x] `/dashboard/team-usage` gate reads the `teamUsage` flag; the Organisation `open-team` row links to `/dashboard/team-usage?team=<id>` (`components/litellm/OrganisationSection.tsx`, overlap approved by the coordinator 2026-11-18)
- [ ] Verify (one test pass at the end; Access Control — *Created app teams*, MI-D7, T-MI3, T-MI4; Data Model — *Entity: AppTeam*; App Teams spec — *Teams without an AWS account*, *UI*, AT6): create — who may, `403` before parsing, duplicate name against created and registry teams `409`, id never collides with a registry team (T-MI3); `POST /api/accounts` and `PATCH /api/accounts/[id]` with a created team's name `409`, no write (T-MI3); the new team appears in the team list and can take members and a link; no `$0` Bedrock row for it; the Team spend panel is gone from the Team page for every role; Team usage: a lead sees only the teams in its scope (leak test, T-MI4), a global reader without a scope sees every team, a user with no scope gets `404`, a Lead gets no `memberSum` with or without `include=memberSum` (LT28), the `open-team` row opens Team usage for that team, and the linked and unlinked figures equal what the panel showed; targeted e2e once; branch gate green with `main` merged in

*Agent decisions (M2 build, 2026-11-18; Rule 00.3):*

- **Team directory.** `lib/api/team-directory.ts` is the one merge of registry teams (`AccountMeta`) and created teams (`AppTeam`); every "does this team exist, its name, its department" lookup reads it. Rollup and Bedrock reads stay on the registry, so a created team never gets a `$0` row. A team's name and department are organisation data, not authorization data (Rule 60.10), so the created-team list is cached like the registry list, under the tag `app-teams`, which `POST /api/teams` revalidates; `GET /api/access/org-units`, the app-membership team lookup (`lib/api/org-lookup.ts`) and the Team page's department-lead check read that cached directory. The LiteLLM read views, team writes and routes keep reading the store per request, as they read the registry before; the one exception is `lib/litellm/member-write.ts`, which resolves the team through the cached directory (organisation data only, never authorization data). Scopes, grants and roles are still read per request. Reason: one place to merge, one-call swaps elsewhere, no change to the rollup routes.
- **Strict create body.** `CreateAppTeamInputSchema` is a strict object: a body `teamId`, or any other extra key, is `400`, not ignored. Reason: a refused id is easier to prove than an ignored one (T-MI3).
- **Team usage gate.** `/dashboard/team-usage` gates on `managementAccessFor(session).team` until M1's `teamUsage` flag is on `main`; the two are the same rule (a global reader, or a live team or department admin scope; MI-D7). The swap is one line after M1 lands. Reason: `lib/manage-access.ts` is M1's file. **Done 2026-11-18 (merge with M1):** the page now gates on `managementAccessFor(session).teamUsage`, same `404` (MI-D7).
- **`include=memberSum` on the client.** `TeamSpendPanel` takes `includeMemberSum` and sends `include=memberSum` only when it is true; the page sets it from the global-reader flag. The server rule (LT28, AT6) is unchanged and still refuses it for a Lead. Reason: a Lead's page should not ask for what the server will refuse.
- **`OrgUnitsResponseSchema`** is a new schema in `packages/shared/src/schemas/app-team.ts`, with `hasAwsAccount` required on team rows, rather than an edit of the existing org-units schema. Reason: one new schema file per unit; M5 reads this contract.
- **Seed.** The default seed holds one created team, `appteam-00000000-0000-4000-8000-000000000001` "Platform Guild" in `dept-engineering`, with its name claim. Reason: the e2e specs and the Organisation view need a team with no AWS account.
- **Not built in M2:** the Organisation `open-team` link to Team usage (`components/litellm/OrganisationSection*`, M4's file; done after M4 lands) and the sidebar item and top-bar title for Team usage (M1's `lib/nav.ts`). Until then the page is reachable by URL only. **Both done 2026-11-18 after M1 and M4 landed:** `TEAM_USAGE_ROUTE = true`, and the `open-team` link is in place.
- **Merge wiring (2026-11-18, coordinator ruling).** `GET /api/litellm/team-links` lists `appTeams` from the team directory so created teams appear (MI-D4a); `lib/litellm/member-write.ts` resolves the team with `findTeamEntry` so member writes work on a linked created team. Reason: the registry-only lookup returned `404` for created teams.

### M3 — Users, user links and the team lead sign-in (`feature/manage-users-links`)

*The "dev lead sign-in" is the team lead sign-in (the `internal-team-admin` role), renamed at the user's direction, 2026-11-18.*

*Items 1, 12, 13, 16; decisions D14–D16a (Access Control — *Dev login*, *LiteLLM user links*, *API routes*; LiteLLM spec — `createUser`, `searchUsers`, *Views as Management routes*; Design System — *Management improvements*).*

- [x] Dev sign-in **Team lead** option through the stored-identity path; the seed stores `local:team-lead@localhost` with a team scope
- [x] Management → Users: the people list (`GET /api/identities/directory`) and **Add user** composing the existing password-user, member and link writes, each step shown only to a caller who may do it *(built 2026-11-18: steps 1–2 in the dialog; the link step is the row's link action once the person exists — Design System D15 note)*
- [x] `PUT`/`DELETE /api/identities/[oid]/litellm-link` (admin, org-admin; never own `oid`; match, manual with a reason; `LiteLLMUserClaim`; privileged targets refused; audited); `PUT /api/identities/[oid]/links` writes `litellmUserId` through the same domain function
- [x] `createUser` allowlist row, toggle (default on), builder and structural test entry; `POST /api/litellm/users` (create and link, OSS only); `/user/new` confirmed in `allowed_routes`
- [x] `searchUsers` with optional search text; `GET /api/litellm/users` without `q` and with `team=`; the *LiteLLM users* tab list (All users / Members of one team) with link states
- [ ] Verify (one test pass at the end; Access Control — *Dev login*, *LiteLLM user links*, *API routes*, T-MI1, T-MI2; LiteLLM spec — `createUser`, *Views as Management routes*, LT-MI1, LT-MI2; Design System — *Management improvements*): team lead sign-in gets a real scope from the store and none from typed text; off in production and with Entra configured (T-MI2); Add user shows only the steps the caller may do; link: admin and org-admin may link, auditor and lead `403`, nobody links their own identity (on `POST /api/litellm/users` the own-`oid` `403` comes after parsing and is tested by the route's own file), usage aliases stay admin-only, no automatic link, approval needed, manual link needs a reason, duplicate `409`, a privileged target (`proxy_admin`, `proxy_admin_viewer`, the service user) `409 PRIVILEGED_TARGET` with no link written, the audit record of a set and a remove carries the mode, both ids and the reason, no user creation on Enterprise, body has `auto_create_key: false` (T-MI1, LT-MI1); the LiteLLM users list: all users pages on the server (25 a page) with no search text, the team filter shows exactly that team's members, "not in LiteLLM" is never `$0`, per-user cost is hidden under the cap, and a lead or a user gets `404` (LT-MI2); full e2e once at the green gate (shared files); branch gate green with `main` merged in

### M4 — budget reset requests (`feature/budget-reset-requests`)

*Added 2026-11-17 at the user's direction, from the
management improvements run plan (items 6, 7 and 8; the plan was removed
on 2026-11-18, after the unit landed in `50f51c63`). Spec:
[LiteLLM — *Budget reset requests*](2026-11-10-litellm.md) and decisions
MG-D8 to MG-D13 (with MG-D11a, MG-D12a); [Data Model — *Budget reset
entities (unit M4)*](2026-05-15-data-model.md) and its *API Routes* rows;
[Access Control — *Permission matrix* → *Budget reset requests* and threat
items BR1–BR10](2026-11-10-access-control.md). The user's answers Q5 (the
reset that lets the member spend again; no limit) and Q6 (per-member counts
follow the per-user approval; 400-day ledger) are recorded there as user
decisions.*

One branch, one squash commit (Rule 30.4). Owned files: as landed in `50f51c63`.
Coordinator constraint (2026-11-17): `lib/litellm/**` is L6's until L6 is on
`main`, so slice A edits no file there; the approve route calls the existing
`resetMemberSpend` and helpers by import, and writes the ledger from
`lib/data/budget-resets.ts`.

- [x] Spec: LiteLLM *Budget reset requests*, the `requestBudgetReset` row in
  *Writes*, MG-D8–MG-D13; Data Model entities, access patterns and routes;
  Access Control permission rows, role × operation table, audit actions and
  BR1–BR10; Rule 30 order exception; Rule 70 "tests near the end"
  exception; *Workflow pilots* row; this block
- [x] **Slice A — the button's path:** "Request a budget reset" on *My
  usage* (beside "Request a budget increase", which stays) → the request →
  the deciders' notifications → Approve or Deny from the bell and from the
  Team page's Budgets view (`AlertDialog` naming the person and the effect)
  → `resetMemberSpend` → the `BudgetReset` ledger item (`trigger:
  "request"`) → the requester's notification. Schemas in
  `packages/shared/src/schemas/budget-reset.ts`; storage in
  `lib/data/budget-reset-requests*`, `lib/data/budget-resets*`,
  `lib/data/notifications*`; routes `app/api/budget-reset-requests/**`,
  `app/api/notifications/**`, registered in `test/route-registry.ts`; UI in
  `components/budget-resets/**`, `components/notifications/**` (the bell in
  `components/layout/AppHeader`)
- [x] **Slice B — ledger everywhere and counts** (built in this run after L6 landed; no M4b):
  the ledger on the direct reset paths, which the bulk reset also uses
  (recorded as `direct`, MG-D8 amended 2026-11-18)
  (`lib/litellm/member-write.ts`, the two reset routes); `requestBudgetReset`
  registered as a route-less operation (MG-D11a); `GET /api/budget-resets`
  and the counts on *My usage*, the Team page's Budgets view and the
  Organisation tab (MG-D10). ~~If it does not fit this run it becomes **M4b**
  (`feature/budget-reset-counts`), recorded here and in the run report~~
  (superseded 2026-11-18: built in M4, no M4b)
- [x] Verify (slice A): the full role × operation matrix for request,
  approve, deny and the reads (Access Control — *Budget reset requests*;
  complete, it is security); self-approval refused (BR2); an out-of-scope
  request id is the same `404` as a missing one (BR5); two approvals give
  one `reset_spend` call and one ledger item (BR3); permission, membership,
  link or toggle lost between request and decision is refused (BR4); a
  LiteLLM failure leaves the request open, writes no ledger item and
  notifies nobody (BR9); expiry after 7 days and the requester's "expired"
  notification; one open request per person per team (BR6); the control is
  absent on an unlinked team and while `requestBudgetReset` or
  `resetMemberSpend` is off; the approval sends exactly
  `POST /team/{team_id}/member/{user_id}/reset_spend` with
  `{ "reset_to": 0 }` and never `reset_budget` (MG-D11); a notification
  reaches only its recipients, only its owner can list or mark it, and it
  hides the request after its recipient lost access (BR5, BR8); the reason
  renders as text and is length-capped (BR7)
- [x] Verify (slice B): one ledger item per reset on all three paths, with
  the amount read before the reset; no item when LiteLLM fails; the 400-day
  expiry; count and amount per role scope — a user never sees another
  person's, a Lead never another team's (BR10 leak tests); only team totals
  before the per-user approval; the 90-day range cap
- [x] Verify: branch gate green with `main` merged in (Rule 70.12),
  including the full e2e once (`components/layout/AppHeader*` is a shared
  file, *E2E budget*)
- [ ] Verify: the coordinator's review approved, including the security pass
  on BR1–BR10

### M5 — Source panels on the Usage pages (`feature/usage-source-panels`)

*Item 14; decisions D17–D19 (Design System — *Source panels on Cost by team, Cost by user and Cost by service*; LiteLLM spec — MI-D17–D19). Needs L6 on `main` (its combined routes and components).*

- [x] Cost by team, Cost by user, Cost by service: a Bedrock panel ("AWS-billed") and a LiteLLM panel ("LiteLLM-reported"), each with its own Suspense and ErrorBoundary; the three figures Bedrock, LiteLLM, Combined from L6's routes and `components/litellm/combined/*`
- [x] Built (2026-11-18): Cost by team's LiteLLM panel with the app teams, "Sum of members" on request for global readers on a linked row and an `open-team` row (`GET /api/litellm/teams/[teamId]?include=memberSum`, MI-D7); Cost by user's LiteLLM users list; Cost by service's honest gap line
- [x] **Built after M2 (2026-11-18):** created teams as "No AWS account" rows in the Bedrock panel read M2's `hasAwsAccount` on `GET /api/access/org-units` through the shared `OrgUnitsResponseSchema` (the tolerant local schema is removed; M5-D3). e2e keeps stubs
- [ ] Verify (one test pass at the end; Design System — *Source panels on Cost by team, Cost by user and Cost by service*; LiteLLM spec — MI-D17–D19, LT-MI4; App Teams spec — AT6): no chart or column holds both sources; "Sum of members" is requested only when a global reader asks for it (no member reads on the panel's first load) and works for a linked row and an `open-team` row; the three figures; Combined equals L6's rule on the counted-once fixture (LT-MI4); the warning and the hidden total without a gateway; a LiteLLM outage leaves the Bedrock panel working; "not in LiteLLM" is never `$0`; targeted e2e once; branch gate green with `main` merged in

### RS1 — Reset spend on the LiteLLM users tab and the Users page (`feature/reset-spend-users`)

*User request, 2026-11-18; coordinator decisions D1–D7 (Design System — *Reset spend from the LiteLLM users tab and the Users page*, *LiteLLM members with no app membership*; LiteLLM spec — `resetMemberSpend` row). Tests first (Rule 70).*

- [x] *Reset spend* row action on Management → LiteLLM → *LiteLLM users* and Management → Users (linked users), shown only when `resetMemberSpend` is enabled, the row has an `oid` and the caller may write members (D4) (superseded 2026-11-19 for the *LiteLLM users* tab by RS2: every row, by LiteLLM ids); a dialog listing the person's resettable team memberships (spend, budget or "No budget") with a confirm per team and *Reset all listed* (one call at a time, a result per team); every reset through the existing reset-spend route
- [x] Any new read for the memberships: `GET /api/litellm/users/[litellmUserId]/memberships`, a scoped GET (LD37, route registry, `404` parity)
- [x] Team page: the note and **Add to team** for LiteLLM members with no app membership (D6); member matching by `litellmUserId` too (D7)
- [ ] Verify: component tests (shown/absent by toggle, `oid` and role; only resettable teams listed; the D6 note and action); integration (any new GET: `401`, scope, `404` parity; the `litellmUserId` match); e2e, one mocked case per page (open, confirm, the reset-spend POST sent) and axe at 375 with the dialog open; branch gate with `main` merged in (Rule 70.12)

### INV1 — Accept a pending invite (`feature/invite-accept`)

*Added 2026-11-18 at the user's direction ("Admin and team lead should be able to accept a 'sent by them' invitation to the team"); user decisions on what accept means and who may accept, agent decisions on the candidate list, the sender's scope and member-only scope (Access Control — *Accept a pending invite*, permission matrix, *API routes*, T-INV1 to T-INV6; Design System — *Management improvements*). Runs after M3.*

- [x] Data: one `TransactWriteItems` bind (pending delete on `version`, affiliation by `oid`, `affiliation.invite.accept` audit); the candidate read from the pending key; never cached
- [x] `POST /api/teams/[id]/members/pending/[key]/accept` `{ oid, reason }` and `GET …/candidates`; `403` before parsing; registered in `test/route-registry.ts`
- [x] UI: Accept on each pending member invitation where pending items show (Team page access sections, Settings → Access); dialog with the candidates (and directory search for admin and org-admin), the key-against-UPN/email mismatch, a required reason, an `AlertDialog` naming the person and the team
- [ ] Verify: the role × action matrix for accept (complete); T-INV1 to T-INV6 each with a test; a happy-path e2e; branch gate green with `main` merged in (Rule 70.12)

### RS2 — Reset any LiteLLM user (`feature/reset-any-litellm-user`)

*User request item 18, 2026-11-18; user answers Q16–Q19, 2026-11-19 (LiteLLM spec — LD39, LT35–LT37, `resetUserSpend` row, API routes; Access Control — *Reset by LiteLLM ids*; Data Model — BudgetReset; Design System — *Reset any LiteLLM user*). Plan: `docs/plans/20261118_teams_users_and_litellm_sync.md` §3 *RS2*. Tests first (Rule 70).*

- [x] Gateway: `resetUserSpend` (`POST /user/update`, body exactly `{ user_id, spend: 0 }` through a strict Zod schema, default off); `/user/delete` stays forbidden
- [x] Ledger: BudgetReset union on `scope` (`member` | `user`); keys `BRESET#LTEAM#` and `BRESET#LUSER#`, GSI1 only with an `oid`; a legacy item with no `scope` reads as `member`; no task-role change (`BRESET#*`)
- [x] Routes: `POST /api/litellm/users/[litellmUserId]/reset-spend`, `POST /api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-spend` and `/reset-budget`, `GET /api/litellm/proxy-teams/[litellmTeamId]/members`; registered in `test/route-registry.ts`
- [x] UI: Reset spend on every *LiteLLM users* row; the LiteLLM teams table opens a members panel with the two resets; the Team page's unlinked member row gains them; every reset dialog offers "User spend (all of LiteLLM)"
- [ ] Verify: T-RS1 to T-RS8 each with a test (Access Control — *Reset by LiteLLM ids*, *Tests (T-RS1–T-RS8)*), including the lead's Team-page reset, both scopes; e2e `reset-spend-users` (unlinked users row; a LiteLLM team's members); branch gate green with `main` merged in (Rule 70.12); security review at the merge

---

## Decision policy (decided 2026-11-15, user)

When a unit meets an open decision — a spec gap, an ambiguity, a choice
between designs — the agent **decides it** with common industry practice and
the project's existing patterns and recommendations (OWASP, WCAG, the AWS
and Next.js guidance the specs cite, the nearest precedent in the specs),
then keeps working. It does not stop to ask. For each decision it:

1. records it where it belongs — a spec line or decision row marked
   "(agent decision, <date>: <one-line reason>)" (Rule 00.2), with tests
   when it changes behaviour;
2. lists it in the run report under §7 *Decisions taken* (decision,
   options considered, reason, reversibility);
3. the coordinator relays the list to the user at the next status, who may
   overturn any of them.

**Still the user's:** pushing, deploying, AWS/Entra/LiteLLM production
configuration, secrets, legal or privacy wording, switching production to
`enforce`, anything irreversible or outward-facing, and any choice that
weakens a security control, a threat-model mitigation or the test bar
(those are recorded as user actions, never decided by the agent).

## Maintenance — test consolidation (queued 2026-11-15, user)

Runs as its own `chore/test-consolidation` branch once 4R.4 has landed and
before L4, never during a unit that edits the same files (Rule 60.24a).

- [x] Shared route-contract suite (Rule 60.23): a registry of every
  `app/api/**` route and one parameterised suite for the `401` shape,
  `403` before parsing, `400` shape, `no-store` and one `denied` audit per
  refused write; remove the per-route copies it supersedes
- [x] Merge the per-run files into their canonical test files
  (`auth.r1`/`auth.r2` → `auth.test.ts`, `env.r1`/`env.r2`, `roles.r1`,
  `operations.review`, `connection-test.warnings`), dropping duplicate
  cases (`auth.r1` was merged last, by the test-structure chore on
  2026-11-17, as its own describe block with per-test mocks; no per-run
  file remains. `auth.recent-auth` is kept as a named aspect —
  `docs/guides/testing.md`)
- [x] One layer per behaviour: remove component or e2e cases that only
  repeat an integration-level assertion (audited 2026-11-16: five
  `departments.spec.ts` cases that re-ran `DepartmentsContent.test.tsx`
  with a stubbed API were removed; the other e2e specs assert shell,
  navigation, responsive or axe behaviour a component test cannot see)
- [ ] Verify: `pnpm check` green in CI on push and the full `pnpm test:e2e`
  green in CI (Rule 70.12 — *E2E budget*); no spec
  rule, rule item or threat item loses its last test (coverage
  list per removed case: done, in the finish report); test lines and run time
  before and after reported

## Workflow pilots (decided 2026-11-15, user)

Claude Code workflows (multi-agent orchestration; [Dynamic workflows guide](../guides/dynamic-workflows.md))
were first planned only where a unit has many independent pieces against one
test bar (the table below). From 2026-11-18 every worker runs its plan units
as a workflow, a small one when a unit has nothing to fan out
(`.claude/prompts/coordinator_prompt.md` §3a; user, 2026-11-18). Every workflow keeps
the rules: one branch and one squash commit per unit (Rule 30.4), Rule 70
roles (tdd-test-engineer writes tests, typescript-developer writes code,
reviewers read only), the one shared agent pool — at most 80 agents running at
once, summed across all sessions, distributed dynamically by the coordinator
(user, 2026-11-18; `.claude/prompts/coordinator_prompt.md` §3a,
[session roles](../guides/session-roles.md) — *Limits*), so the sessions running
parallel units share it — the user's opt-in per run, and the usage freeze
(`.claude/prompts/coordinator_prompt.md` §3). Superseded 2026-11-18: the 5-agent cap
and its raise for M0–M5 only; reason: the user gave the pool as the general
rule, not one run's exception. A workflow speeds
up building inside a unit; it never merges or skips the review.

| Where | Fan-out | Fit |
|---|---|---|
| Coordinator merge review (every merge, from the next one) | the reviewers Rule 70.12 calls for, in parallel, then adversarial checks of the BLOCKERs batched within the coordinator's allocation of the pool | high — first pilot |
| L4 write routes | one slice per route group (members, budgets/limits, keys, team), all against the structural write-route test and the write matrix | high |
| L5 role × operation matrix | one agent per role row against the fake LiteLLM | high |
| Phase 5 polish | one agent per page: ErrorBoundary per section, axe fixes, breakpoints, empty states | high (guide §4.1) |
| 4R.4 Settings access sections, L3 page sections | one agent per section once its routes exist | medium — only if a run is short of time |
| Phase 6 collector | the three source adapters (Cost Explorer, CloudTrail Lake, CloudWatch) against fixtures; the merge stays serial | medium |
| Management improvements M0–M5 (user opt-in, 2026-11-17: "multiple subagent in parallel and workflows") | M4 slice A: up to three build agents (request and decision routes with the ledger write; notification routes and the bell; the *My usage* and Team page controls), then *Test pass → Fix → Gate*; wave 1: one *Build → Test pass → Fix → Gate* pipeline per unit (M1, M2, M3, M5) with M4 slice B in the fifth place; the coordinator reviews | high — user-directed run (*Budget reset requests* — run directions) |
| 4R.5, L6–L8, Phase 1-style bootstraps | — | none: small or sequential |

---

## Phase 5 — Polish & Accessibility

**Goal:** Production-quality error handling, accessibility compliance, and responsive verification across all pages.

### Tasks

- [ ] **WCAG 2.5.3 Label in Name on the shared shell, then axe 4.14** (coordinator, 2026-11-18, found by SEC1; queued for unit C2). `@axe-core/playwright` is held at `~4.11.3` because axe 4.14 newly enforces `label-content-name-mismatch` on the sidebar brand link (visible organisation name, accessible name "LLM Usage Lens — go to overview"), the user menu (visible initials, "Open user menu"), the date presets (visible "7D/30D/90D", "Last N days") and Search. Fix: each `aria-label` starts with the control's visible text; then raise `@axe-core/playwright` to 4.14 and keep the full e2e axe-clean. The hold is not a security fix (SEC1's dependency audit is unaffected).
- [ ] **Dev-only advisory accepted: `picomatch` ReDoS** (high, CVE-2026-112366, vulnerable `<=4.0.7`; coordinator, 2026-11-18, SEC1). No patched release exists (4.0.7 is the latest); it reaches only dev tooling (Vite through Vitest, lint-staged), and `pnpm audit --prod` is clean. Re-check trigger: a `picomatch` release above 4.0.7, or any `pnpm audit --prod` finding — then upgrade (or override) and tick this.

- [x] UI refresh — fluid workspace (user direction 2026-11-11; delivered 85609ea; Design System — *Layout*). It may run before the rest of Phase 5, on `feature/ui-fluid-workspace`, at the user's direction; one branch, one squash commit
  - Remove the 1280px cap from the `/dashboard` layout; gutters 16 / 24 / 32px
  - Overview on the 12-column panel grid (16px gap; 8 + 4 column rows); the Overview KPI row five across from 1440
  - Every table on a card surface with border-token dividers and row hover
  - Compact 16px padding on KPI cards and panels
  - `max-w-[72ch]` on `EmptyState` description text and the Settings forms
  - User menu shows the role label(s) and the sign-in method, from the label maps in `lib/auth/roles.ts`
  - Sidebar brand reads "LLM Usage Lens"
  - `e2e/responsive.spec.ts` also covers 1920: no horizontal scroll; the content container's width equals the `SidebarInset` width and its left and right padding is 32px
- [ ] UI refresh — compact workspace (user direction 2026-11-15; Design System — *Typography*, *Layout*, *Navigation*, *Settings Page*, *Control Patterns*, amended 2026-11-16). It may run before the rest of Phase 5, on `feature/ui-compact-workspace`, at the user's direction (Rule 30); one branch, one squash commit; **lands only after the user validates the UI in person**. Two slices: A is built, B is not.
  - [x] **Slice A (built)** — presentation only:
    - [x] Tokens and density in `app/globals.css` (neutral canvas, muted ≠ border, `--color-focus-ring`, `--color-link`, `--color-input` 3:1, `--color-warning-text`, compact text, spacing, radius and overlay-shadow tokens); primitives under `components/ui/` consume them; reduced-motion base rule
    - [x] Shell sizing: sidebar 224px, 32px items, neutral active state, collapse icon button; top bar global controls only, two rows below `md`
    - [x] Shared primitives: `PageHeader`, `PageTabs`, `Panel`, `KeyValueList`, `TableToolbar`, column helpers (right-aligned numerics), skeletons matching layout, chart legend; shadcn Breadcrumb, Collapsible, Switch, Alert; no new npm dependency
    - [x] Pages: Overview (compact KPI row, Panels), Ranking (tabs in the header, one toolbar row), Departments (table) and detail (breadcrumb, KPI strip), Teams and detail, Services and Users (search, Columns, Export)
    - [x] Every existing URL, accessible name, nuqs name, query key and role gate unchanged (the U1 "nothing lost" checklist, `temp/run-ui/ui-inventory.md`)
    - [ ] Verify: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, impacted Vitest, the full `pnpm test:e2e`, `pnpm build:ci`; axe clean on every page; no horizontal scroll at 375 / 768 / 1024 / 1440 / 1920; keyboard walk of sidebar, tabs and one dialog; before/after screenshots; user validation
  - [ ] **Slice B (not built)** — the sidebar groups and Management routes change navigation, landing and some behaviour, so "presentation only" does not apply to this slice:
    - [ ] **B1 — shell and navigation** (split 2026-11-17, coordinator, at the user's request: B1 runs before LiteLLM unit L4 and unit D land; B2 waits for both; branch `feature/ui-slice-b1-shell`):
      - [x] Sidebar groups Usage / Management / Administration with Settings out of the footer; Usage labels "Cost by department / team / service / user" and matching page titles; Usage holds My usage, last, for every signed-in caller (user, 2026-11-17: moved from Management); Management holds, until B2, the existing LiteLLM item
      - [x] Role gating on the stored scope: the six organisation-level Usage items render only for a global reader (My usage, last in Usage, for everyone — B1-14), and every one of their routes (list and detail) returns `404` for anyone else; `/dashboard` and `/dashboard/home` send a lead or user to My usage; `?view=overview` and the *My teams* relabel removed (Access Control — *Navigation and landing by role*, B1 decisions)
      - [x] `ScopeLine` component and its `PageHeader` slot, replacing the 4R.5 notice markup; sync badges hidden for lead and user; the date range stays on every page
      - [x] `PageHeader` on Overview and My usage; the sign-in auth card on the Slice A primitives; the Account page on `PageHeader` and `Panel`
      - [x] The command menu and top bar follow the same groups, labels and gating (one filter)
      - [x] Tests: the per-role navigation suite, the Usage-route `404` matrix, one e2e journey per role (admin, lead, user), axe clean and no horizontal scroll at 375 / 768 / 1024 / 1440
    - [ ] **B2 — Management pages** (waits for L4 and D): Management routes and redirects, the Team page, `BudgetBar`, `AlertDialog` (reuse L4's `components/ui/alert-dialog.tsx`), the single Audit page, `PageHeader` on LiteLLM and Settings, removal of the LiteLLM item and its tab row; **the Settings route gate (`404` for lead and user) and hiding the Settings item for them, in one change** (coordinator ruling, 2026-11-17: the nav mirrors the server, so B1 keeps the Settings item for every signed-in caller while the route still serves them). Branch `feature/ui-slice-b2-management`; decisions B2-1 … B2-3 in Access Control — *Navigation and landing by role*:
      - [x] `/dashboard/manage/{team,organisation,users,audit}` gated by one server capability function, each hidden route `404`
      - [x] Redirects from `/dashboard/litellm` (`?tab=`), `/dashboard/litellm/team-config` and `/dashboard/settings/audit`; the LiteLLM tab row and its item removed
      - [x] Management nav (Team, Organisation, Users, Audit by role); Settings hidden and `404` for lead and user
      - [x] Team page: team selector (*superseded 2026-11-23 by unit TM1: a team list, then `/dashboard/manage/team/[teamId]`; Design System — List, then the team*), `ScopeLine`, L4 panels mounted, `BudgetBar` and the "Near or over budget" filter, named `AlertDialog` confirmations and the bulk reset, the lead's access sections
      - [x] Audit page with the App · Gateway source filter; Organisation and Users pages; `PageHeader` on the Management pages and Settings
      - [x] My usage: spend-by-day and spend-by-model charts, "Request a budget increase" link
      - [x] Tests: the per-role Management and Settings `404` matrix, the redirects, one e2e journey per role (admin, org admin, auditor, lead, user), axe and no horizontal scroll at 375 / 768 / 1024 / 1440 on each new page
    - Mock-up review (decided 2026-11-16, user; Design System — *Navigation (Sidebar)*, *Management pages*, *Settings Page*; Access Control — *Navigation and landing by role*; LiteLLM spec — *Views as Management routes*):
      - Sidebar groups Usage (organisation-level items for global readers; My usage for everyone), Management (Team · Organisation · Users · Audit; My usage moved to Usage, last, 2026-11-17, user) and Administration (Settings, last); Usage labels "Cost by department / team / service / user" with matching page titles, and every test and e2e selector that names them updated; landing admin and org admin → Cost overview, lead and user → My usage; a hidden item is absent and its route `404`
      - Management routes `/dashboard/me` and `/dashboard/manage/{team,organisation,users,audit}`; `/dashboard/litellm` (any `?tab=`) and the Settings audit entry redirect; the LiteLLM tab row removed; one `Tabs` component for the remaining in-page tabs (Ranking, Team page) and the Settings route tabs
      - One Team page (usage and management; team selector — *superseded 2026-11-23, TM1: list, then the team* —, member search, `BudgetBar` and the "Near or over budget" filter, named `AlertDialog` confirmations, bulk reset); its write controls arrive with L4 and are absent until enabled; no LiteLLM call of its own
      - My usage: spend-by-day chart and spend-by-model breakdown (lazy Recharts, model tokens), "Request a budget increase" link (`mailto:` or copyable address)
      - One Audit page with an App · Gateway source filter (composition; each source keeps its permission)
      - `ScopeLine` on scoped pages; sync badges hidden for lead and user; the date range stays on every page
      - Settings route tabs (AWS accounts, Sync and data, LiteLLM, Access) and the second row inside Access are built by unit D of the LiteLLM role-views run; the second row inside LiteLLM is owned by unit A2 (agent decision, 2026-11-17, coordinator); this task keeps their look consistent only
      - **Depends on Phase 4R.5** (navigation data, role filter, landing pages) and **LiteLLM unit L4** (Team page writes); until each lands, the dependent part waits
      - **Decided 2026-11-17 (coordinator, under the user's delegation):** a lead has no "AWS-billed cost" tile (least privilege; AWS billing is account-level) and loses the Bedrock/AWS cost view of its teams (Access Control — *Navigation and landing by role*); the tile is not built
      - Tests (Rule 60.24a): one per-role navigation suite (each item absent and its route `404` for a role that may not see it); one e2e journey per role (admin, lead, user); axe clean and no horizontal scroll at 375 / 768 / 1024 / 1440
- [ ] Add `ErrorBoundary` per section on every page (one chart failing doesn't crash the page) (workflow pilot candidate, one agent per page — *Workflow pilots*)
- [ ] Accessibility audit
  > Smoke-level a11y is enforced continuously before Phase 5:
  > `apps/dashboard/e2e/accessibility.spec.ts` fails the suite on any
  > serious/critical axe (WCAG 2.0/2.1 A+AA) violation on every nav page.
  > This phase performs the full audit below on top of that floor.
  - Contrast: 4.5:1 minimum (WCAG AA), target 7:1 (AAA) for key text
  - Keyboard navigation: all interactive elements reachable via Tab
  - aria-labels: icon-only buttons, charts, status indicators
  - Focus rings: 2-4px, visible on all interactive elements, at least 3:1 against the adjacent background, and kept in forced-colors mode (`--color-focus-ring`, Design System — *Interaction & States*; `outline-hidden`, not `outline-none`; decided 2026-11-06 from the run 6 audit) — this includes the shadcn primitives under `components/ui/`, patched locally and re-applied after any `shadcn add` (as for `Sidebar`)
  - Screen reader: meaningful alt text, aria-live regions for dynamic updates (except `SyncCountdown`, a `timer` with implicit `aria-live="off"` — Design System *Component Inventory*)
- [ ] Responsive testing at all breakpoints (375 / 768 / 1024 / 1440)
  > The no-horizontal-scroll check runs continuously before Phase 5
  > (`apps/dashboard/e2e/responsive.spec.ts`, all four breakpoints, every
  > nav page); this phase adds the visual checks below.
  - No horizontal scroll on any viewport
  - Charts resize correctly via `ResponsiveContainer`
  - Sidebar behavior correct per breakpoint
  - Touch targets: minimum 44x44px on mobile
- [ ] Empty states for all pages and sections (verify with `seed-empty.ts`)
- [ ] Performance and caching (user direction 2026-11-17: **specified only — no unit starts until the user says so**). Sources: Design System — *Caching Strategy* and *Component Inventory* (`RefreshButton`), Data Model — *Access Patterns* (account list), LiteLLM spec — *Caching*, Platform — *Runtime*. Each unit is one branch and one squash commit (Rule 30.4) through the Rule 70 loop, in this order; call counts are the regression guard and timings are reported, never asserted (Rule 60.24). The units keep Rule 30's order: they are Phase 5 work and start after the LiteLLM units (L8). An earlier start needs the user's direction recorded as a dated exception in Rule 30, like the two UI-refresh exceptions; none is recorded
  - [ ] **PERF-0 — Baseline** (`feature/phase-5-perf-0-baseline`; the spec amendments landed separately on `docs/perf-caching-spec`, 2026-11-17). A call-budget test helper that counts DynamoDB commands and LiteLLM gateway calls per route, and `scripts/perf-baseline.ts`, which times each read route against a production build seeded with `db:seed:large` and `db:seed:ranking` and writes a table to `temp/`. Includes the former "performance testing with large dataset" checks: tables paginate at scale, charts render without lag, no memory issue at 50 accounts × 90 days, and the per-day rollup entries stay in Next's cache in the built container (`cacheMaxMemorySize` set in `next.config.ts` if they do not)
  - [ ] **PERF-1 — Server: remove repeated reads** (no new staleness beyond the existing 1-hour account cache, no security change). Request memo in `withRoute` for `GET`; LiteLLM read and write paths read the account list through `getAllAccountsCached`, as the Phase 4R write routes already do (the account registry is not authorization data; residual risk recorded in Data Model — *Access Patterns*); `getVisibility` joins the parallel reads in `loadAuthorization`; add-member candidates use `BatchGetItem` (closes the LD26 follow-up); identical concurrent read-path LiteLLM `GET`s of the cacheable operations share one in-flight call, and a write path never joins one (LiteLLM spec — *Caching*). Security-scoped review (it touches `lib/api/respond.ts` and the authorization reads)
  - [ ] **PERF-1b — Account registry index** (Data Model — *Access Patterns*): `AccountMeta` on the `ACCOUNTS` GSI1 partition; account writes, seeds and `scripts/create-table.ts` follow; the idempotent backfill script and the dual read (Query, with the Scan as fallback until the backfill marker exists); the runbook gets the backfill step. Running the backfill against a deployed table is a user action and a user decision (Data Model — *Access Patterns*)
  - [ ] **PERF-2 — Client: TanStack Query tuning.** Key factory and `queryOptions`; `gcTime` 30 minutes; previous data kept on date-range changes; rollup queries stale after 10 minutes and invalidated on a new sync; LiteLLM queries stale after 60 seconds; sidebar prefetch on hover and focus
  - [ ] **PERF-R — Refresh button** (after PERF-2). `RefreshButton` in the top bar; `Cache-Control: no-cache` on the refresh round; `GET /api/sync-status` honours it, at most once per 10 seconds per key and task; the rollup cache key gains the last sync run. `AppHeader` is a shared file, so the full e2e runs once at the green gate (Rule 70.12)
  - [ ] **PERF-3 — LiteLLM read cache** (LiteLLM spec — *Caching*; user decision 2026-11-17). The fixed cached list, the size cap, eviction on writes, the `no-cache` bypass with its 10-second minimum refresh interval, and the structural test that pins the list. Security-scoped review
  - [ ] **PERF-4 — Server prefetch pilot** (Overview only). The route body becomes a loader shared with the page; measured with PERF-0's script; other pages follow only if the gain is clear
  - [ ] **PERF-5 — Shared cache (Valkey)**: not built unless a trigger in `docs/future-improvements.md` — *Shared cache (Valkey)* is met
  - Decided with this task (user, 2026-11-17): the dashboard does not read LiteLLM's database (LiteLLM spec — *Network* stands); query data is not persisted in browser storage; `/api/*` stays `private, no-store`; DAX and CloudFront stay unused (Design System — *Technology decisions*)
  - Verify: the call-budget tests pass with the lowered budgets of each unit; back-to-back callers with different scopes get different rows from one cache entry (T14); a write followed by a read returns the new value; no write-path read comes from a cache or joins an in-flight read, except the account list (`getAllAccountsCached`, which is not authorization data); a second `no-cache` request for one key inside 10 seconds makes no upstream call; the LiteLLM read cache never exceeds its cap; a refresh with no new sync performs no rollup `Query`; after PERF-1b, an account written before it is still listed before and after the backfill
- [ ] Verify `prefers-reduced-motion` is respected (animations disabled/reduced)
- [ ] App-wide AEDT display (LiteLLM spec — LD20, decided 2026-11-15): render timestamps in `Australia/Sydney` with the zone label on every page (`SyncStatusBadge`, `format-last-run.ts`, tables); day buckets stay UTC (Rule 20.1); amend Rule 20 and the Design System *Component inventory* first
- [ ] Populate `CommandMenu` with real data (departments, teams, users, services)
- [ ] E2E tests with Playwright
  > The Playwright harness itself lands **before** Phase 5: the agent loop
  > (Rule 70) ships a headless smoke spec with every UI component or page
  > addition/modification, in `apps/dashboard/e2e/` against
  > `apps/dashboard/playwright.config.ts` (headless Chromium — the
  > devcontainer has no display server). Authentication uses a forged
  > Auth.js session cookie signed with the E2E dev server's `AUTH_SECRET`
  > (`e2e/support/session.ts`) — real JWT verification, no production
  > bypass. Phase 5 builds the full user journeys below on that harness.
  - Login flow (the auth gate redirect is smoke-covered; the full Entra ID
    round-trip stays out of E2E — forged-session sign-in instead)
  - Overview page loads
  - Ranking tab switching
  - Department → detail drill-down
  - Settings CRUD flow
  - Date filter changes update all data
- [x] Add Playwright to GitHub Actions CI (pulled forward 2026-11-17, branch `ci/playwright-e2e`)

### Dependencies

Phase 4 (all sub-phases complete).

---

## Phase 6 — AWS Lambda Collector

**Goal:** Serverless data pipeline that collects real Bedrock usage and cost data hourly and writes to DynamoDB. Runs in a dedicated observability account as a **separate deployable** (`apps/collector`), sharing `packages/shared` with the dashboard.

### One-Time AWS Setup

- [ ] Provision (or designate) a dedicated observability account — if the org uses Control Tower, its existing *Log Archive* account fits
- [ ] Enable CloudWatch cross-account observability
  - Observability account = monitoring account
  - Enable source links organization-wide so current and future member accounts auto-link
- [ ] Configure the organization CloudTrail; set the observability account as CloudTrail delegated administrator (CloudTrail Lake event data store queried locally)
- [ ] Deploy `CostExplorerReadRole` to the management account (single plain-CloudFormation stack, separate from the collector SAM stack)
  - **Open (user, 2026-11-14; ask before Phase 6):** confirm company policy allows a role in the management account with `ce:GetCostAndUsage`. If it does not, Cost Explorer is unavailable and every day's cost becomes a list-price estimate from the price table (`costFinalized` never `true`); that is a System Architecture amendment before the collector is built
  - `ce:GetCostAndUsage`
  - Trust: `BedrockCollectorLambdaRole` in the observability account
- [ ] Evaluate Bedrock **model invocation logs** as an attribution source (user sample 2026-11-14, `schemaType: ModelInvocationLog`): each record carries `identity.arn`, `modelId` (inference-profile ARN, e.g. `au.` profiles), input, output and cache token counts and `inferenceRegion` — compare with CloudTrail Lake for per-user attribution and cache-token pricing; adopting it is a System Architecture amendment
- [ ] Create the GitHub Actions OIDC deploy role(s) — one in the observability account (collector SAM stack) and deploy permissions in the management account (`CostExplorerReadRole` stack); used by the CD `deploy` job, no static AWS keys in CI

### Tasks

- [ ] Create Lambda project in `apps/collector` (Node.js 22.x, TypeScript), depends on `@llm-usage-lens/shared`
- [ ] Implement Lambda handler (`bedrock-cost-collector`)
  - Read account registry from DynamoDB (all active accounts)
  - Assume `CostExplorerReadRole` in the management account, query Cost Explorer
    - `GetCostAndUsage` for yesterday (finalized) + today (partial)
    - Filtered to `AmazonBedrock` service (placeholder until the `SERVICE` ground-truth check — System Architecture spec — *Proposed collector amendments (audit A2)* item 4)
    - Grouped by `LINKED_ACCOUNT` and `USAGE_TYPE`, requesting `UnblendedCost` + `UsageQuantity`
    - Request usage records only: Cost Explorer can return negative amounts (credits, refunds), and the v1 `nonModel` schema is nonnegative. Exact `RECORD_TYPE` filter handling is unverified; confirm it here (Data Model spec — *Schema decisions*)
    - Classify each usage type with `classifyUsageType` (`@llm-usage-lens/shared`): model → `models[<key>]`, charge category → `nonModel[<category>]`, unknown → `nonModel.unclassified` (System Architecture spec — *Cost Explorer `USAGE_TYPE` classification*)
  - Query CloudTrail Lake locally (org event data store)
    - `StartQuery`, then poll `GetQueryResults` until complete (async SQL)
    - Bedrock InvokeModel/InvokeModelWithResponseStream calls grouped by account, SSO username, inference profile (→ service), model ID
    - Time range: yesterday + today
  - Query CloudWatch via cross-account observability
    - `GetMetricData` with account-scoped queries for all source accounts — no role assumption
    - Per ModelId: InputTokenCount, OutputTokenCount, Invocations, InvocationLatency
  - Normalize raw Bedrock model IDs to canonical keys (`@llm-usage-lens/shared`)
  - Apply today's cost fallback when Cost Explorer returns zero (shared price table + token counts)
  - Effective-dated price table (System Architecture — *Price table (effective-dated)*, amended 2026-11-14): `BedrockPriceEntrySchema` with valid and invalid cases (duplicates, negative, non-UTC); first Sydney Geo and In-region entries for every model in use, read from the pricing page; hourly lookup with a mid-day price change split at the hour; `priceMissing` instead of `0`; `priceEffectiveFrom` recorded; the Admin/Auditor list-price comparison on finalised days (computed on read, labelled "list-price estimate"); check whether the AWS Price List exposes Geo/In-region rates and, if so, a `scripts/` generator; monthly upkeep step in the AWS infrastructure runbook
  - Write `nextScheduledAt` on SyncStatus (next UTC hour boundary)
  - Merge all three data sources per account per day (System Architecture spec — Three-source merge rules)
  - Resolve inference profile tags per Tag resolution appendix
  - Write/overwrite DailyRollup items to DynamoDB via `BatchWriteItem` (25/batch), each carrying `date` and validated with `DailyRollupItemSchema` (Data Model spec — *`date` attribute*)
  - Update SyncStatus item
- [ ] Implement two-day refresh strategy (UTC calendar days)
  - Yesterday: costFinalized = true
  - Today: costFinalized = false
- [ ] Verify the 3.1a classification table against reality, then replace the placeholder patterns:
  - capture a real `GetCostAndUsage` response (grouped by `USAGE_TYPE`) from an account with Guardrails, Provisioned Throughput, batch, and prompt-cache usage — the bedrock-simulator sandbox can generate these
  - record the exact usage-type strings and units in the shared table
  - list the distinct Cost Explorer `SERVICE` values that carry Bedrock usage, including any third-party Marketplace-style service names, and set the filter accordingly
- [ ] Decide and, if adopted, implement the System Architecture spec *Proposed collector amendments (audit A2)*:
  - ARN → foundation-model resolution before normalization
  - `Converse`/`ConverseStream` in the CloudTrail filter
  - `_unattributed` zero-denominator rule
  - read-only `aws ce get-dimension-values --dimension SERVICE` ground-truth check in the simulator sandbox
- [ ] Write rollups for accounts whose only charge that day is a recurring non-model cost (idle Provisioned Throughput / storage), so they are not skipped
- [ ] Log every `nonModel.unclassified` and `models.other` usage type as a structured warning
- [ ] Implement per-user and per-service cost estimation
  - `cost = (entityTokensForModel / accountTotalTokensForModel) x accountModelCost`
  - All per-user and per-service values: costEstimated = true
- [ ] Author the SAM template (`apps/collector/template.yaml`) — see System Architecture spec **Infrastructure as Code**
  - `AWS::Serverless::Function` `bedrock-cost-collector`: Node.js 22.x, 5-min timeout, 512 MB memory, reserved concurrency 1
  - Inline `Schedule` event — EventBridge cron, every 1 hour
  - `BedrockCollectorLambdaRole` execution policy: `cloudwatch:GetMetricData`/`ListMetrics`, `cloudtrail:StartQuery`/`GetQueryResults`, `sts:AssumeRole` on `CostExplorerReadRole`, `dynamodb:PutItem`/`BatchWriteItem`/`GetItem`/`Query`/`Scan` on the `bedrock-usage` table, CloudWatch Logs
  - `AWS::DynamoDB::Table` `bedrock-usage` (PK/SK + GSI1, TTL on `DailyRollup`) — production table owned by this stack; `scripts/create-table.ts` stays DynamoDB-Local-only
  - `AWS::CloudWatch::Alarm` on EventBridge/Lambda invocation failures
- [ ] Configure SAM `BuildMethod: esbuild` to bundle the `@llm-usage-lens/shared` workspace dependency into the artifact; verify the built bundle contains the shared code
- [ ] Error handling: partial failures (some accounts fail, others succeed → SyncStatus = "partial")
- [ ] Tests: unit tests for model normalization, usage-type classification (against captured real usage types), the `cost` invariant, data merging, cost estimation formula
- [ ] Deploy to the observability account via `sam build && sam deploy` (CD `deploy` job, OIDC-assumed role)
- [ ] Verify: Lambda runs on schedule, DailyRollup items appear in DynamoDB, SyncStatus updates
- [ ] Switch Next.js app from DynamoDB Local to the production DynamoDB table
- [ ] Settings → Sync: a **Refresh now** button that starts a collection on demand (`internal-admin`; user, 2026-11-18)

### Dependencies

Phase 3 (Data Layer — Zod schemas in `packages/shared`, and DynamoDB table structure shared).

> **Build note.** Structure the collector around the `UsageProvider` interface
> (System Architecture spec — *Alternative usage source: OpenTelemetry*): the
> CloudWatch + CloudTrail logic above is the v1 `CloudWatchCloudTrailProvider`
> implementation, and the merge / Cost Explorer / DynamoDB-write steps stay
> provider-agnostic. This is an internal seam only — it does not change v1
> behaviour or scope.

---

## Post-v1 — OpenTelemetry usage source (optional)

Documented enhancement, not part of the v1 phase plan. Adds an
`OtelPrometheusProvider` implementation of the `UsageProvider` interface that
sources tokens and attribution from OpenTelemetry GenAI metrics via PromQL,
selected with `USAGE_SOURCE=otel`. Cost Explorer remains the cost source. See
the System Architecture spec — *Alternative usage source: OpenTelemetry* — for
the provider abstraction and the application instrumentation contract.
Prerequisite: organization-wide OTel instrumentation of every Bedrock caller.

---

## Environment Configuration

### Environment Files

| File | Purpose | Git Tracked |
|---|---|---|
| `.env.example` | Template with all variable names. Copied to `.env` it runs `pnpm dev` as-is: `APP_ENV=dev`, the dev-only local login, a non-secret `AUTH_SECRET` placeholder, Entra lines commented out. No real secret values | Yes |
| `.env` | Shared local defaults; `APP_ENV` here selects `.env.dev` or `.env.prod` | No |
| `.env.dev` | Loaded when `APP_ENV=dev` | No |
| `.env.prod` | Loaded when `APP_ENV=prod` (Entra ID config, real `AUTH_SECRET`) | No |
| `.env.local` | Personal overrides and secrets | No |
| `.env.test` | Test configuration (DynamoDB Local, mock auth) | No |

Decided 2026-11-13. The files live in `apps/dashboard/`. Precedence, highest
first: the process environment, `.env.<NODE_ENV>.local`, `.env.local`,
`.env.<APP_ENV>`, `.env.<NODE_ENV>`, `.env`. Next.js loads all but
`.env.<APP_ENV>`, which `next.config.ts` layers in at startup
(`lib/env-files.ts`), so editing `.env.dev` or `.env.prod` needs a dev-server
restart; it is skipped under `NODE_ENV=test`, and a file cannot change
`APP_ENV`. The `AUTH_SECRET` placeholder fails env validation when
`APP_ENV=prod` or `NODE_ENV=production`. Deployed environments take their
variables from the task definition, never from these files (Platform spec).

### Required Environment Variables

```
# Auth.js (NextAuth v5)
AUTH_SECRET=
AUTH_URL=http://localhost:3000

# Microsoft Entra ID (Auth.js provider) — all three or none; required in production
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_ISSUER=               # https://login.microsoftonline.com/<tenant GUID, lowercase>/v2.0; tenant-specific only
AUTH_DEV_LOGIN=                       # "true" enables the dev-only local login; rejected in production and when Entra is configured

# Environment and access (Phase 4R.1; Access Control spec — Environment, Rollout, Sign-in methods)
APP_ENV=dev                           # required: dev | prod — the only environment switch
AUTH_ACCESS_MODE=                     # open | enforce; unset or invalid → enforce; open rejected with APP_ENV=prod
AUTH_MASTER_USERNAME=                 # break-glass master user; with AUTH_MASTER_PASSWORD_HASH, or neither
AUTH_MASTER_PASSWORD_HASH=            # Argon2id PHC string ($argon2id$…); SSM SecureString in AWS
AUTH_MASTER_TOTP_SECRET=              # base32; required with APP_ENV=prod; SSM SecureString in AWS
AUDIT_LOG_GROUP_NAME=                 # optional (4R.2): CloudWatch audit log group; unset → the CloudWatch copy is skipped
TOTP_KMS_KEY_ID=                      # required when APP_ENV=prod (4R.2 R2b-2): the project CMK ARN, set by the DashboardServiceStack; encrypts password users' TOTP secrets (envelope)

# Base path (unit BP; build-time, optional; Platform spec — Base path)
NEXT_PUBLIC_BASE_PATH=                # empty (serve from /) or /llm-lens-style prefix; AUTH_URL stays origin-only

# AWS / DynamoDB
AWS_REGION=ap-southeast-2
AWS_PROFILE=                          # AWS SSO profile; run `aws sso login` first. Omit when using DynamoDB Local.
DYNAMODB_TABLE_NAME=bedrock-usage
DYNAMODB_ENDPOINT=                    # http://localhost:8000 for DynamoDB Local

# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=          # http://localhost:4318 for the devcontainer Collector
OTEL_SERVICE_NAME=llm-usage-lens

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ORG_NAME=                 # deprecated from unit CFG: set display.orgName in config.yaml; kept as a fallback for one release
APP_CONFIG_FILE=                      # optional (unit CFG): path to a mounted config.yaml; unset → the baked-in apps/dashboard/config/config.yaml

# Framework-set, never set manually; read through env.ts for the sign-in provider checks
# NODE_ENV, NEXT_PHASE
```

All validated at build time by @t3-oss/env-nextjs. Missing variables fail the build with a clear error.

## CI/CD — GitHub Actions

### Pipeline

```
on: [push, pull_request]

jobs:
  quality:
    steps:
      - Checkout
      - Setup pnpm + Node 24 (*was Node 22; upgraded 2026-11-18, user*)
      - Install dependencies (pnpm install --frozen-lockfile)
      - Lint (eslint .)
      - Format check (prettier --check .)
      - Type check (tsc --noEmit)
      - Secret scan (gitleaks detect)

  test:
    steps:
      - Checkout
      - Setup pnpm + Node 24 (*was Node 22; upgraded 2026-11-18, user*)
      - Start DynamoDB Local (Docker service)
      - Create table + seed data
      - Unit + component tests (vitest run)
      - E2E tests (playwright test) — smoke specs exist from Phase 2+; wired into CI (`llm-usage-lens-build.yml` job `e2e`, pulled forward from Phase 5)

  build:
    needs: [quality, test]
    steps:
      - Checkout
      - Setup pnpm + Node 24 (*was Node 22; upgraded 2026-11-18, user*)
      - Build (next build)

  deploy-collector:                    # Phase 6+ — runs on push to main only, never on pull_request
    needs: [build]
    if: github.ref == 'refs/heads/main'
    permissions:
      id-token: write                  # OIDC — assume the AWS deploy role, no static keys
      contents: read
    steps:
      - Checkout
      - Setup pnpm + Node 24 (*was Node 22; upgraded 2026-11-18, user*)
      - Configure AWS credentials (OIDC role assumption — observability account)
      - sam build (apps/collector — bundles @llm-usage-lens/shared via esbuild)
      - sam deploy --no-confirm-changeset (bedrock-cost-collector stack)
```

The `deploy-collector` job is added in Phase 6 — Phases 1–5 ship the `quality`/`test`/`build` jobs only. Dashboard hosting is AWS ECS Fargate (decided 2026-11-09; Platform spec): Phase 4R.P adds the `llm-usage-lens-deploy.yml` workflow (job `deploy`; `workflow_dispatch`, GitHub OIDC deploy role) that builds and pushes the image to ECR and deploys the DashboardServiceStack; deploying is the user's action.

## Conventions

### Conventional Commits

Enforced by commitlint via Husky:

| Prefix | Usage |
|---|---|
| `feat:` | New feature or component |
| `fix:` | Bug fix |
| `chore:` | Tooling, deps, config |
| `refactor:` | Code restructuring without behavior change |
| `test:` | Adding or updating tests |
| `docs:` | Documentation changes |
| `style:` | Formatting, whitespace (no logic change) |

### API Response Format

All Route Handlers return a standardized shape:

```typescript
// Success
{ data: T }

// Error
{ error: { code: string; message: string } }
```

Validated by Zod on both server (response) and client (TanStack Query).
