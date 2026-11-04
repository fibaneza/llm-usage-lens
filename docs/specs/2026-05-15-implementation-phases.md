# Implementation Phases Spec

**Status:** Draft
**Date:** 2026-05-15
**Scope:** Phased implementation plan for the Bedrock Cost Dashboard, designed for small-batch delivery

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
  - Typography (Space Grotesk + JetBrains Mono via Google Fonts)
  - Spacing scale (4px/8px grid)
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
  - Content area max-width 1280px, centered
  - Mobile: single column, collapsible sidebar
  - Tablet: sidebar overlay
  - Desktop: persistent sidebar + content
- [x] Build top bar
  - User menu (avatar, name, sign out, Auth.js session) + organization name (`NEXT_PUBLIC_ORG_NAME`)
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
  - `scripts/seed.ts` — realistic data: 3 departments, 5 teams, 10 users, 8 services, 30 days of rollups, multiple models
  - `scripts/seed-empty.ts` — empty state: accounts exist but no rollups (tests empty states)
  - `scripts/seed-large.ts` — stress test: 50 accounts, 90 days, 20 users/team, 15 services
  - `scripts/seed-ranking.ts` (optional) — 100 accounts × 30 days to validate ranking performance at v1 upper bound
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
| 4.9 Settings | TagCoverageBar (CRUD forms, new) |

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
- [x] Connect to Route Handler: all accounts grouped by department
- [x] Tests: grid renders correct number of cards; empty state when no departments
- [x] Verify: cards render with seed data, links navigate to detail pages

---

### Phase 4.4 — Department Detail Page (`/dashboard/departments/[id]`)

**Goal:** Deep dive into a single department — teams breakdown, cost over time, top users.

**Sections (4):**
1. Department header (name, total cost, tokens, invocations with DeltaBadge)
2. Teams breakdown table (sortable)
3. Cost over time: stacked area chart by team
4. Top users in this department: ranked list

**Tasks:**
- [ ] Build department header with summary stats
- [ ] Build `PeriodComparison` component ("vs previous 30 days" side-by-side)
- [ ] Reuse `UsageTable` for teams breakdown
- [ ] Reuse `CostTrendChart` (stacked by team instead of model)
- [ ] Top users ranked list (reuse `RankingList`)
- [ ] Connect to Route Handlers: department rollups + team breakdown
- [ ] Tests: header stats calculation
- [ ] Verify: page loads for each department in seed data, charts and tables render correctly

---

### Phase 4.5 — Teams Page (`/dashboard/teams`)

**Goal:** Filterable list of all teams across all departments.

**Sections (1):**
1. Teams table with department filter

**Tasks:**
- [ ] Reuse `UsageTable` for teams list
- [ ] Add department filter dropdown (reuse `ModelFilter` pattern with department data)
- [ ] Columns: Team Name, Department, Cost, Tokens, Invocations, Services count, Users count
- [ ] Link team name to team detail page
- [ ] `EmptyState` for no teams / no results
- [ ] Connect to Route Handler: all accounts with optional department filter
- [ ] Tests: department filter works; table sorting and pagination
- [ ] Verify: all teams from seed data appear, filter narrows results

---

### Phase 4.6 — Team Detail Page (`/dashboard/teams/[id]`)

**Goal:** Deep dive into a single team — services, users, model breakdown.

**Sections (4):**
1. Team header (name, account ID, total cost, tokens)
2. Services breakdown table
3. Users breakdown table
4. Model usage breakdown: bar chart

**Tasks:**
- [ ] Build team header with `AccountIdBadge` (formatted AWS account ID with copy button)
- [ ] Build `ModelBadge` component (model name + assigned color dot)
- [ ] Build `UserAvatar` component (initials avatar with consistent color)
- [ ] Reuse `UsageTable` for services breakdown
- [ ] Reuse `UsageTable` for users breakdown (with `UserAvatar` in name column)
- [ ] Build model usage bar chart (reuse Recharts, `next/dynamic`)
- [ ] Connect to Route Handlers: team rollups with byService and byUser data
- [ ] Tests: AccountIdBadge copy functionality; UserAvatar color consistency
- [ ] Verify: services and users tables populated from seed data, model chart renders

---

### Phase 4.7 — Services Page (`/dashboard/services`)

**Goal:** All services across all accounts in one table.

**Sections (1):**
1. Services table

**Tasks:**
- [ ] Reuse `UsageTable` for services list
- [ ] Columns: Service Name, Team, Department, Cost, Tokens, Invocations, % of Total
- [ ] Aggregate byService data across all accounts and date range
- [ ] Link to parent team detail page
- [ ] `EmptyState` for no services / all untagged
- [ ] Connect to Route Handler: aggregated services across all rollups
- [ ] Tests: cross-account aggregation correctness
- [ ] Verify: services from all teams appear, sorted by cost

---

### Phase 4.8 — Users Page (`/dashboard/users`)

**Goal:** All users across all accounts in one table.

**Sections (1):**
1. Users table

**Tasks:**
- [ ] Reuse `UsageTable` for users list (with `UserAvatar`)
- [ ] Columns: User (avatar + name), Team, Department, Cost, Tokens, Invocations, % of Total
- [ ] Aggregate byUser data across all accounts and date range
- [ ] Cost values carry `CostEstimateIndicator` (all per-user costs are proportional estimates)
- [ ] Link to parent team detail page
- [ ] `EmptyState` for no users
- [ ] Connect to Route Handler: aggregated users across all rollups
- [ ] Tests: cross-account user aggregation; CostEstimateIndicator appears
- [ ] Verify: users from all teams appear, estimated cost indicator shown

---

### Phase 4.9 — Settings Page (`/dashboard/settings`)

**Goal:** Admin page for managing account registry, viewing sync status, and monitoring tag coverage. Only page with write operations (CRUD).

**Sections (4):**
1. Account registry (add / edit / deactivate accounts, map to department/team)
2. Sync status (last run time, success/error count, next scheduled run)
3. Tag coverage per team (% of tagged vs untagged usage)
4. Data retention (TTL configuration display)

**Tasks:**
- [ ] Build account registry table with add/edit/deactivate actions
  - Add account form (shadcn Dialog): account ID, name, department, team, region
  - Edit account form (shadcn Sheet)
  - Deactivate with confirmation dialog
  - Zod validation on all form inputs
  - `next-safe-action` for all Server Actions
  - The `/api/accounts` Route Handlers (Phase 3.3) are the Settings CRUD HTTP contract; a Server Action, if used, calls the same `lib/data/account-meta.ts` functions rather than a second write path (decided 2026-10-29)
  - **Account-mutation role (decided 2026-10-29):** only the `Admin` app role may create, edit and deactivate accounts (System Architecture — *Authentication & Access*). The `/api/accounts` write routes return `403 FORBIDDEN` without it (Phase 3.3 amendment); the Settings page hides the add/edit/deactivate controls from non-admins, and any Server Action checks the same role.
- [ ] Build sync status display
  - Connect `SyncStatusBadge` and `SyncCountdown` to SyncStatus entity
  - Show: last run time, status (success/partial/error), accounts processed, duration, errors list
- [ ] Build `TagCoverageBar` component (progress bar per team)
  - Calculate from byService data: tagged vs `_untagged` percentage
- [ ] Reuse `CostEstimateIndicator` (built in Phase 4.2) wherever Settings shows an estimated cost
- [ ] Build data retention display (TTL info, read-only)
- [ ] Tests: CRUD operations against DynamoDB Local; form validation; tag coverage calculation; a non-admin session sees no add/edit/deactivate controls and Server Actions reject it (e2e needs admin and non-admin forged sessions)
- [ ] Verify: can add/edit/deactivate accounts as `Admin`; a non-admin sees the registry read-only and gets `403` from the write routes; sync status displays correctly, tag coverage renders

---

## Phase 5 — Polish & Accessibility

**Goal:** Production-quality error handling, accessibility compliance, and responsive verification across all pages.

### Tasks

- [ ] Add `ErrorBoundary` per section on every page (one chart failing doesn't crash the page)
- [ ] Accessibility audit
  > Smoke-level a11y is enforced continuously before Phase 5:
  > `apps/dashboard/e2e/accessibility.spec.ts` fails the suite on any
  > serious/critical axe (WCAG 2.0/2.1 A+AA) violation on every nav page.
  > This phase performs the full audit below on top of that floor.
  - Contrast: 4.5:1 minimum (WCAG AA), target 7:1 (AAA) for key text
  - Keyboard navigation: all interactive elements reachable via Tab
  - aria-labels: icon-only buttons, charts, status indicators
  - Focus rings: 2-4px, visible on all interactive elements
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
- [ ] Performance testing with large dataset (verify with `seed-large.ts`)
  - Tables paginate correctly at scale
  - Charts render without lag
  - No memory issues with 50 accounts x 90 days
- [ ] Verify `prefers-reduced-motion` is respected (animations disabled/reduced)
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
- [ ] Add Playwright to GitHub Actions CI

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
  - `ce:GetCostAndUsage`
  - Trust: `BedrockCollectorLambdaRole` in the observability account
- [ ] Create the GitHub Actions OIDC deploy role(s) — one in the observability account (collector SAM stack) and deploy permissions in the management account (`CostExplorerReadRole` stack); used by the CD `deploy` job, no static AWS keys in CI

### Tasks

- [ ] Create Lambda project in `apps/collector` (Node.js 22.x, TypeScript), depends on `@bedrock-usage/shared`
- [ ] Implement Lambda handler (`bedrock-cost-collector`)
  - Read account registry from DynamoDB (all active accounts)
  - Assume `CostExplorerReadRole` in the management account, query Cost Explorer
    - `GetCostAndUsage` for yesterday (finalized) + today (partial)
    - Filtered to `AmazonBedrock` service (placeholder until the `SERVICE` ground-truth check — System Architecture spec — *Proposed collector amendments (audit A2)* item 4)
    - Grouped by `LINKED_ACCOUNT` and `USAGE_TYPE`, requesting `UnblendedCost` + `UsageQuantity`
    - Request usage records only: Cost Explorer can return negative amounts (credits, refunds), and the v1 `nonModel` schema is nonnegative. Exact `RECORD_TYPE` filter handling is unverified; confirm it here (Data Model spec — *Schema decisions*)
    - Classify each usage type with `classifyUsageType` (`@bedrock-usage/shared`): model → `models[<key>]`, charge category → `nonModel[<category>]`, unknown → `nonModel.unclassified` (System Architecture spec — *Cost Explorer `USAGE_TYPE` classification*)
  - Query CloudTrail Lake locally (org event data store)
    - `StartQuery`, then poll `GetQueryResults` until complete (async SQL)
    - Bedrock InvokeModel/InvokeModelWithResponseStream calls grouped by account, SSO username, inference profile (→ service), model ID
    - Time range: yesterday + today
  - Query CloudWatch via cross-account observability
    - `GetMetricData` with account-scoped queries for all source accounts — no role assumption
    - Per ModelId: InputTokenCount, OutputTokenCount, Invocations, InvocationLatency
  - Normalize raw Bedrock model IDs to canonical keys (`@bedrock-usage/shared`)
  - Apply today's cost fallback when Cost Explorer returns zero (shared price table + token counts)
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
- [ ] Configure SAM `BuildMethod: esbuild` to bundle the `@bedrock-usage/shared` workspace dependency into the artifact; verify the built bundle contains the shared code
- [ ] Error handling: partial failures (some accounts fail, others succeed → SyncStatus = "partial")
- [ ] Tests: unit tests for model normalization, usage-type classification (against captured real usage types), the `cost` invariant, data merging, cost estimation formula
- [ ] Deploy to the observability account via `sam build && sam deploy` (CD `deploy` job, OIDC-assumed role)
- [ ] Verify: Lambda runs on schedule, DailyRollup items appear in DynamoDB, SyncStatus updates
- [ ] Switch Next.js app from DynamoDB Local to the production DynamoDB table

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
| `.env.example` | Template with all required variable names (no values) | Yes |
| `.env.local` | Local development (Auth.js + Entra ID config, DynamoDB Local endpoint) | No |
| `.env.test` | Test configuration (DynamoDB Local, mock auth) | No |

### Required Environment Variables

```
# Auth.js (NextAuth v5)
AUTH_SECRET=
AUTH_URL=http://localhost:3000

# Microsoft Entra ID (Auth.js provider) — all three or none; required in production
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_ISSUER=               # https://login.microsoftonline.com/<tenant GUID, lowercase>/v2.0; tenant-specific only
AUTH_DEV_LOGIN=                       # "true" enables the dev-only local login; rejected in production

# AWS / DynamoDB
AWS_REGION=us-east-1
AWS_PROFILE=                          # AWS SSO profile; run `aws sso login` first. Omit when using DynamoDB Local.
DYNAMODB_TABLE_NAME=bedrock-usage
DYNAMODB_ENDPOINT=                    # http://localhost:8000 for DynamoDB Local

# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=          # http://localhost:4318 for the devcontainer Collector
OTEL_SERVICE_NAME=bedrock-cost-dashboard

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

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
      - Setup pnpm + Node 22
      - Install dependencies (pnpm install --frozen-lockfile)
      - Lint (eslint .)
      - Format check (prettier --check .)
      - Type check (tsc --noEmit)
      - Secret scan (gitleaks detect)

  test:
    steps:
      - Checkout
      - Setup pnpm + Node 22
      - Start DynamoDB Local (Docker service)
      - Create table + seed data
      - Unit + component tests (vitest run)
      - E2E tests (playwright test) — smoke specs exist from Phase 2+; wired into CI in Phase 5

  build:
    needs: [quality, test]
    steps:
      - Checkout
      - Setup pnpm + Node 22
      - Build (next build)

  deploy-collector:                    # Phase 6+ — runs on push to main only, never on pull_request
    needs: [build]
    if: github.ref == 'refs/heads/main'
    permissions:
      id-token: write                  # OIDC — assume the AWS deploy role, no static keys
      contents: read
    steps:
      - Checkout
      - Setup pnpm + Node 22
      - Configure AWS credentials (OIDC role assumption — observability account)
      - sam build (apps/collector — bundles @bedrock-usage/shared via esbuild)
      - sam deploy --no-confirm-changeset (bedrock-cost-collector stack)
```

The `deploy-collector` job is added in Phase 6 — Phases 1–5 ship the `quality`/`test`/`build` jobs only. Dashboard hosting is a future decision and has no deploy job in v1.

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
