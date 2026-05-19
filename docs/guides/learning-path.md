# Learning Path — Building the Bedrock Cost & Usage Dashboard

A guided, phase-by-phase walk-through of this project. It is both a **lesson**
— each phase explains the concepts behind what you build — and a **tracker** —
every task is a checkbox and every phase has a completion gate.

If you are new to the project, read [How the System Works](#how-the-system-works)
first, then work the phases in order.

---

## How to use this guide

**What the project is.** Two deliverables in a single **pnpm monorepo** that
share `packages/shared` (Zod schemas, model normalization, price table):

1. **Next.js dashboard** (`apps/dashboard`) — reads aggregated Bedrock
   cost/usage from DynamoDB and renders 9 pages. Built first (Phases 1–5),
   developed against **DynamoDB Local**.
2. **AWS Lambda collector** (`apps/collector`) — an hourly serverless pipeline
   that collects real Bedrock data and writes it to DynamoDB. Built last
   (Phase 6).

**The specs are the source of truth.** This guide *navigates* them — it does
not replace them. Read the relevant spec section before writing code:

- [`docs/specs/2026-05-15-system-architecture.md`](../specs/2026-05-15-system-architecture.md)
  — AWS pipeline, accounts, collector flow
- [`docs/specs/2026-05-15-data-model.md`](../specs/2026-05-15-data-model.md)
  — DynamoDB table, entities, access patterns, model normalization
- [`docs/specs/2026-05-15-design-system.md`](../specs/2026-05-15-design-system.md)
  — tech stack, visual system, component inventory, performance patterns
- [`docs/specs/2026-05-15-implementation-phases.md`](../specs/2026-05-15-implementation-phases.md)
  — the 6-phase build plan and per-phase Verify checklists
- [`docs/guides/auth-setup.md`](auth-setup.md) — Auth.js + Microsoft Entra ID
  and AWS credential setup
- [`docs/guides/aws-infrastructure.md`](aws-infrastructure.md) — collector
  operational runbook
- [`docs/guides/dashboard-deployment.md`](dashboard-deployment.md) — dashboard
  deployment runbook

**How to read a phase.** Every phase below has the same five parts:

| Part | What it gives you |
|---|---|
| **Lesson** | The concepts this phase teaches — read this before building |
| **Dependencies** | Which earlier phase(s) must have a green gate first |
| **Build tasks** | Every task as a `- [ ]` checkbox — check when the code exists |
| **Verify** | The spec's own checklist — check when each item passes |
| **Gate** | The 3-state completion marker for the whole phase |

**The completion rule.** Check a **task** when its code is written. A **phase**
is only *done* when its gate reads `[x] Works  [x] Tested  [x] Reviewed`:

- **Works** — the code runs and the Verify checklist passes.
- **Tested** — automated tests cover the behaviour and pass.
- **Reviewed** — a reviewer has approved it.

This mirrors the project's `typescript-developer → test-engineer → quality-reviewer` agent loop
(see `.claude/rules/70-agent-workflow.md`), which you can run with the
`/build-feature` command.

**Phase discipline.** Build phases in strict order — do not start a phase
whose dependencies are unmet. Components are built **where first needed** and
reused later; do not speculatively build ahead (see `.claude/rules/30-phase-discipline.md`).

---

## How the System Works

Read this before Phase 1 — it is the mental model the whole build serves.

### The big picture

```
AWS Organization
  │
  ├─ Management account     ── Organization CloudTrail + CostExplorerReadRole
  │
  ├─ Observability account  ── Lambda collector, DynamoDB, EventBridge cron
  │        │
  │        │  (every hour)
  │        ▼
  │   ┌─────────────────────────────────────────────┐
  │   │ bedrock-cost-collector  (Lambda)             │
  │   │   merges 3 AWS data sources:                 │
  │   │   • Cost Explorer  → $ per account & model   │
  │   │   • CloudWatch     → tokens / invocations    │
  │   │   • CloudTrail Lake→ per-user / per-service  │
  │   └─────────────────────────────────────────────┘
  │        │  writes DailyRollup items
  │        ▼
  │   ┌──────────────────────┐
  │   │ DynamoDB: bedrock-usage │  single table
  │   └──────────────────────┘
  │        │  read by server-only Route Handlers
  │        ▼
  │   ┌──────────────────────┐
  │   │ Next.js dashboard     │  9 pages, Auth.js-protected
  │   └──────────────────────┘
  │
  └─ Member accounts (one per team) ── CloudWatch source links + org CloudTrail
                                       (no custom IAM roles deployed)
```

An hourly Lambda **collector** runs in a dedicated *observability account*,
merges three AWS data sources, and writes one `DailyRollup` per account per day
into a single DynamoDB table. The Next.js **dashboard** reads those rollups
through server-only Route Handlers and renders them.

### Account layout and the single role hop

| Account | Role |
|---|---|
| **Management** | Hosts the organization CloudTrail and one read-only Cost Explorer role. No workloads. |
| **Observability** | Hosts the collector Lambda, DynamoDB, EventBridge, the CloudTrail Lake event data store, and is the CloudWatch monitoring account. |
| **Member** (one per team) | Linked as CloudWatch observability *source* accounts; Bedrock activity captured by org CloudTrail. **No custom IAM roles deployed.** |

The design has exactly **one** cross-account role assumption: the collector
assumes `CostExplorerReadRole` in the management account. CloudWatch metrics
arrive via cross-account observability (no role assumption), and CloudTrail
Lake is queried locally. This keeps cross-account coupling minimal and means a
new member account needs **no** per-account deployment.

### The data model in brief

One DynamoDB table, `bedrock-usage`, with a `PK`/`SK` primary key and one GSI
(`gsi1pk`/`gsi1sk`, projection `ALL`). Three entity types:

- **`AccountMeta`** — maps an AWS account to its department/team.
- **`DailyRollup`** — the core entity: one per account per day. Metrics are
  broken down **by model first**, with `byUser` and `byService` nested *inside*
  each model.
- **`SyncStatus`** — a single item tracking the collector's last run.

Rankings are computed **in memory** in the API route (fetch rollups for a date
range via GSI1, group, sort). GSI1 queries can exceed DynamoDB's 1 MB page
limit, so any GSI query loops on `LastEvaluatedKey`.

### Two credential concerns — never conflated

- **Dashboard login** (who the user is) → Auth.js v5 + Microsoft Entra ID.
- **AWS access** (how the server reads DynamoDB) → AWS SDK default credential
  chain. DynamoDB Local needs no real credentials; real AWS uses
  `aws sso login` + `AWS_PROFILE`. Never static access keys.

### Cost provenance

All cost is **USD**. Only **account-level and model-level** cost (from Cost
Explorer) is exact. **Per-user and per-service** cost is a proportional
estimate and always carries `costEstimated: true`. Yesterday's rollup is
`costFinalized: true` (Cost Explorer has caught up); today's is
`costFinalized: false` (estimated from token counts and a static price table).

---

## The Build Path

Six phases, strict order. Phase 4 expands into nine sub-phases.

```
1 Foundation → 2 Layout Shell → 3 Data Layer
  → 4 Pages (4.1 → 4.9, in order)
    → 5 Polish & Accessibility
      → 6 AWS Lambda Collector
```

---

### Phase 1 — Foundation

> Spec: [implementation-phases.md → Phase 1](../specs/2026-05-15-implementation-phases.md)

**Lesson.** This phase teaches the *toolchain*, not features. You learn how a
pnpm **monorepo workspace** is laid out (`apps/*` + `packages/shared`), how a
Next.js App Router project is scaffolded in TypeScript strict mode, and how
quality gates (ESLint, Prettier, Husky, gitleaks, commitlint) catch problems
before they reach a PR. You also wire **Auth.js v5 + Microsoft Entra ID** — the
identity-provider abstraction — and learn that switching providers later is a
change to `auth.ts` only. Env vars go through `@t3-oss/env-nextjs` so
misconfiguration fails at build time. The output is a skeleton: no pages yet.

**Dependencies.** None — this is the starting point.

**Build tasks.**

- [ ] Initialize the pnpm workspace monorepo with `packages/shared` and `apps/dashboard`
- [ ] Initialize Next.js (TypeScript strict mode, App Router)
- [ ] Configure Tailwind CSS v4 with dark mode (color tokens, Fira Code + Fira Sans fonts, 4px/8px grid)
- [ ] Initialize shadcn/ui with the dark theme
- [ ] Configure ESLint v9 (flat config), Prettier, Husky + lint-staged, gitleaks, commitlint
- [ ] Add the pre-push hook: `tsc --noEmit`
- [ ] Set up Auth.js (NextAuth v5) with the Microsoft Entra ID provider
- [ ] Build the sign-in page (`/sign-in`) — single "Sign in with Microsoft" action, no sign-up
- [ ] Protect `/dashboard/*` and `/api/*` routes via Auth.js middleware
- [ ] Configure `@t3-oss/env-nextjs` (type-safe env vars validated with Zod)
- [ ] Integrate OpenTelemetry (`@vercel/otel`)
- [ ] Create `.env.example` (tracked, no values), `.env.local` (ignored), `.env.test` (ignored)
- [ ] Set up GitHub Actions CI: lint, type check, secret scan, build

**Verify.**

- [ ] Project runs with `pnpm dev`
- [ ] Microsoft Entra ID sign-in works
- [ ] Dark theme renders

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

### Phase 2 — Layout Shell

> Spec: [implementation-phases.md → Phase 2](../specs/2026-05-15-implementation-phases.md)

**Lesson.** This phase teaches **responsive application layout**. Every page
later renders inside this shell, so you build it once: a sidebar (persistent on
desktop, overlay on mobile), a top bar, breadcrumbs, a Cmd+K command menu, and
a `DateRangePicker` whose state lives in the **URL** via `nuqs` (not React
state) — so a date range survives refresh and is shareable. You also learn the
breakpoint system (375 / 768 / 1024 / 1440) and the centered 1280px content
area. Components are placeholders where data is not available yet.

**Dependencies.** Phase 1 (green gate).

**Build tasks.**

- [ ] Build the `Sidebar` — 9 nav items with Lucide icons, active state, collapsible (desktop) / overlay (mobile)
- [ ] Build the top bar — user menu (avatar, name, sign out, Auth.js session) + organization name
- [ ] Add `SyncStatusBadge` and `SyncCountdown` placeholders to the top bar
- [ ] Build the responsive layout structure (breakpoints 375/768/1024/1440, content max-width 1280px centered)
- [ ] Build the `Breadcrumbs` component (shadcn/ui)
- [ ] Build the `CommandMenu` (shadcn/ui cmdk) with Cmd+K trigger and `Kbd` hint — skeleton search
- [ ] Build the `DateRangePicker` (shadcn Calendar + Popover): 7d / 30d / 90d / custom, default 30 days, persisted in URL via nuqs
- [ ] Build the page header layout (title + breadcrumbs + date filter)
- [ ] Create placeholder pages for all 9 routes

**Verify.**

- [ ] Navigation works
- [ ] Sidebar collapses
- [ ] Date filter persists in the URL
- [ ] Layout is responsive at all breakpoints

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

### Phase 3 — Data Layer

> Spec: [implementation-phases.md → Phase 3](../specs/2026-05-15-implementation-phases.md),
> [data-model.md](../specs/2026-05-15-data-model.md)

**Lesson.** This is the conceptual heart of the dashboard. You learn
**DynamoDB single-table design** — one table modelling three entities through
`PK`/`SK` plus a GSI — and why GSI1 uses projection `ALL`. You learn the
**server-only data boundary**: DynamoDB and the AWS SDK are touched *only* by
server code; data-access files import `server-only`; Client Components receive
data as props or fetch Route Handlers. You learn **validate-at-the-boundary**:
every Route Handler Zod-parses its input and returns the mandatory
`{ data }` / `{ error }` shape. You learn **GSI pagination** — any GSI1 query
must loop on `LastEvaluatedKey` because a page caps at 1 MB. And you learn
**model ID normalization** in `packages/shared` — raw Bedrock IDs map to
canonical keys (`claude-opus`, `claude-sonnet`, `claude-haiku`, `other`). The
collector (Phase 6) imports the same package, so the two never drift.

**Dependencies.** Phase 1, Phase 2 (green gates).

**Build tasks.**

- [ ] Set up DynamoDB Local via Docker (`docker-compose.yml`)
- [ ] Write `scripts/create-table.ts` — creates `bedrock-usage` (PK/SK + GSI1), idempotent
- [ ] Write Zod schemas in `packages/shared/src/`: `AccountMetaSchema`, `DailyRollupSchema`, `SyncStatusSchema`
- [ ] Write the query schemas: `RankingQuerySchema`, `DateRangeQuerySchema` (90-day cap), `TeamsQuerySchema`
- [ ] Write model ID normalization in `packages/shared/src/models.ts` (raw ID → canonical key → display name + chart CSS token)
- [ ] Write `scripts/seed.ts` — realistic data (3 depts, 5 teams, 10 users, 8 services, 30 days)
- [ ] Write `scripts/seed-empty.ts` — empty-state data
- [ ] Write `scripts/seed-large.ts` — stress data (50 accounts, 90 days, 20 users/team, 15 services)
- [ ] Build the DynamoDB client (`apps/dashboard/lib/dynamodb.ts`) — AWS SDK v3 document client, configurable endpoint
- [ ] Build data-access functions in `apps/dashboard/lib/data/` (each imports `server-only`): `getAccountMeta`, `getAllAccounts`, `getAccountsByDepartment`, `getDailyRollups`, `getRollupsByDate` (loops on `LastEvaluatedKey`), `getSyncStatus` (returns "never synced" when no item)
- [ ] Build the read Route Handlers: `/api/overview`, `/api/ranking`, `/api/departments`, `/api/departments/[id]`, `/api/teams`, `/api/teams/[id]`, `/api/services`, `/api/users`, `/api/sync-status`
- [ ] Build the account CRUD routes: `GET|POST /api/accounts`, `PATCH|DELETE /api/accounts/[id]`
- [ ] Enforce the standard response shape, Zod validation, the 90-day cap, and 1-hour server-cache revalidation
- [ ] Set up TanStack Query (`QueryClientProvider` in root layout, `staleTime` 5 min) and query hooks
- [ ] Add Vitest + React Testing Library; unit-test the Zod schemas and data-access functions against DynamoDB Local
- [ ] Add the GitHub Actions test step (Vitest + DynamoDB Local via Docker)

**Verify.**

- [ ] The seed script populates data
- [ ] Route Handlers return validated data
- [ ] TanStack Query hooks work

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

### Phase 4 — Pages (4.1 – 4.9)

> Spec: [implementation-phases.md → Phase 4](../specs/2026-05-15-implementation-phases.md),
> [design-system.md](../specs/2026-05-15-design-system.md)

**Lesson.** This phase teaches **component-driven page building**. Its guiding
rule: components are built **where first needed** and reused later — never
build ahead. The two heaviest pages come first (Overview, Ranking) because they
introduce the components every later page reuses. Each sub-phase is
independently deliverable — one Phase 4 sub-phase per PR.

**Component build order.**

| Sub-phase | New components introduced |
|---|---|
| 4.1 Overview | `MetricCard`, `DeltaBadge`, `CostTrendChart`, `ModelBreakdownChart`, `Skeleton`, Suspense boundaries |
| 4.2 Ranking | `UsageTable`, `RankingList`, `PercentOfTotalBar`, `SparklineCell`, `ModelFilter`, `SearchInput`, `ColumnToggle`, `Pagination`, `ExportButton`, `EmptyState` |
| 4.3 Departments | (reuses `MetricCard`, `EmptyState`) |
| 4.4 Department Detail | `PeriodComparison` (reuses `UsageTable`, `CostTrendChart`) |
| 4.5 Teams | (reuses `UsageTable`, `ModelFilter`) |
| 4.6 Team Detail | `ModelBadge`, `AccountIdBadge`, `UserAvatar` (reuses `UsageTable`) |
| 4.7 Services | (reuses `UsageTable`) |
| 4.8 Users | (reuses `UsageTable`, `UserAvatar`) |
| 4.9 Settings | `TagCoverageBar`, `CostEstimateIndicator` (CRUD forms, new) |

---

#### Phase 4.1 — Overview Page (`/dashboard`)

**Lesson.** The heaviest page. You learn **non-blocking section loading** —
each section wrapped in its own `<Suspense>` with a `Skeleton` fallback, so a
slow chart never blocks the KPI cards — and **lazy-loaded charts**: Recharts
loads via `next/dynamic` with `ssr: false` to avoid hydration errors, always
inside a `ResponsiveContainer`.

**Dependencies.** Phase 3.

**Build tasks.**

- [ ] Build the `MetricCard` component (shadcn Card + icon + value + trend)
- [ ] Build the `DeltaBadge` component ("+12.3%" green / "-5.1%" red)
- [ ] Build `CostTrendChart` (Recharts stacked area, `next/dynamic` `ssr:false`, `ResponsiveContainer`, prop `groupBy: 'model' | 'team'`)
- [ ] Build `ModelBreakdownChart` (Recharts donut, `next/dynamic`, `ResponsiveContainer`)
- [ ] Build the top-5-departments horizontal bar chart
- [ ] Connect `SyncStatusBadge` and `SyncCountdown` to real `SyncStatus` data
- [ ] Build `Skeleton` loading states for all 5 sections
- [ ] Wrap each of the 5 sections in `<Suspense>` with a Skeleton fallback
- [ ] Connect all components to TanStack Query hooks + the `DateRangePicker` filter
- [ ] Tests: component tests for `MetricCard` and `DeltaBadge`; integration test for overview data loading

**Verify.**

- [ ] Page renders with seed data
- [ ] Skeletons show during load
- [ ] The date filter updates all sections

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

#### Phase 4.2 — Ranking Page (`/dashboard/ranking`)

**Lesson.** The second-heaviest page. You build the **core table
infrastructure** (`UsageTable` on TanStack Table) that most later pages reuse:
sortable columns, debounced search, column toggle, pagination. Tab state lives
in the URL via `nuqs`.

**Dependencies.** Phase 4.1.

**Build tasks.**

- [ ] Build `UsageTable` (TanStack Table + shadcn Table): sortable columns, `Pagination` (20 rows), `SearchInput` (debounced), `ColumnToggle`
- [ ] Build the `RankingList` variant with medal icons for the top 3
- [ ] Build `PercentOfTotalBar` (inline proportion bar)
- [ ] Build `SparklineCell` (inline trend sparkline)
- [ ] Build `ModelFilter` (shadcn Select)
- [ ] Build `ExportButton` (CSV export)
- [ ] Build `EmptyState` (icon + message + optional CTA)
- [ ] Implement tab switching (Departments / Teams / Services / Users) via nuqs
- [ ] Connect to Route Handlers — ranking grouped by department/team/service/user
- [ ] Render columns: Rank, Name, Cost, Input Tokens, Output Tokens, Invocations, % of Total, Trend
- [ ] Tests: `UsageTable` sort/filter/paginate; `EmptyState` rendering

**Verify.**

- [ ] All 4 tabs load
- [ ] Sorting works
- [ ] The model filter updates results
- [ ] CSV exports correctly

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

#### Phase 4.3 — Departments Page (`/dashboard/departments`)

**Lesson.** A lighter page that reuses `MetricCard` and `EmptyState`. You learn
the **responsive card grid** (1 / 2 / 3 columns) and grouping account rollups
by department.

**Dependencies.** Phase 4.2.

**Build tasks.**

- [ ] Build the department cards grid (responsive: 1 col mobile, 2 tablet, 3 desktop)
- [ ] Render each card: department name, total cost (with `DeltaBadge`), total tokens, team count, top model
- [ ] Link each card to its department detail page
- [ ] Add `EmptyState` for no departments
- [ ] Connect to the Route Handler — all accounts grouped by department
- [ ] Tests: grid renders the correct card count; empty state when no departments

**Verify.**

- [ ] Cards render with seed data
- [ ] Links navigate to detail pages

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

#### Phase 4.4 — Department Detail Page (`/dashboard/departments/[id]`)

**Lesson.** You learn **dynamic route params** (`params` is a Promise in the
App Router — `await` it), reuse `CostTrendChart` with `groupBy: 'team'`, and
build `PeriodComparison` for "vs previous 30 days".

**Dependencies.** Phase 4.3.

**Build tasks.**

- [ ] Build the department header (name, total cost, tokens, invocations with `DeltaBadge`)
- [ ] Build the `PeriodComparison` component ("vs previous 30 days" side-by-side)
- [ ] Reuse `UsageTable` for the teams breakdown
- [ ] Reuse `CostTrendChart` stacked by team
- [ ] Build the top-users ranked list (reuse `RankingList`)
- [ ] Update `Breadcrumbs` (Departments > Engineering)
- [ ] Connect to Route Handlers — department rollups + team breakdown
- [ ] Tests: header stat calculation; breadcrumb rendering

**Verify.**

- [ ] Page loads for each department in seed data
- [ ] Charts and tables render correctly

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

#### Phase 4.5 — Teams Page (`/dashboard/teams`)

**Lesson.** A list page reusing `UsageTable`. You learn to add a secondary
filter (department) alongside the existing filter pattern.

**Dependencies.** Phase 4.4.

**Build tasks.**

- [ ] Reuse `UsageTable` for the teams list
- [ ] Add a department filter dropdown (reuse the `ModelFilter` pattern with department data)
- [ ] Render columns: Team Name, Department, Cost, Tokens, Invocations, Services count, Users count
- [ ] Link each team name to its team detail page
- [ ] Add `EmptyState` for no teams / no results
- [ ] Connect to the Route Handler — all accounts with optional department filter
- [ ] Tests: department filter narrows results; table sorting and pagination

**Verify.**

- [ ] All teams from seed data appear
- [ ] The filter narrows results

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

#### Phase 4.6 — Team Detail Page (`/dashboard/teams/[id]`)

**Lesson.** You build the identity components — `AccountIdBadge` (formatted AWS
account ID with copy), `ModelBadge` (name + color dot), `UserAvatar` (initials
with consistent color) — and learn that a team maps to exactly one AWS account.

**Dependencies.** Phase 4.5.

**Build tasks.**

- [ ] Build the team header with `AccountIdBadge` (formatted AWS account ID, copy button)
- [ ] Build the `ModelBadge` component (model name + assigned color dot)
- [ ] Build the `UserAvatar` component (initials avatar, consistent color per user)
- [ ] Reuse `UsageTable` for the services breakdown
- [ ] Reuse `UsageTable` for the users breakdown (with `UserAvatar` in the name column)
- [ ] Build the model-usage bar chart (Recharts, `next/dynamic`)
- [ ] Update `Breadcrumbs` (Teams > Payments Team)
- [ ] Connect to Route Handlers — team rollups with `byService` and `byUser` data
- [ ] Tests: `AccountIdBadge` copy; `UserAvatar` color consistency

**Verify.**

- [ ] Services and users tables populate from seed data
- [ ] The model chart renders

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

#### Phase 4.7 — Services Page (`/dashboard/services`)

**Lesson.** You learn **cross-account aggregation** — merging `byService` data
from every account's rollups into one table — and that untagged usage lands in
the `_untagged` bucket.

**Dependencies.** Phase 4.6.

**Build tasks.**

- [ ] Reuse `UsageTable` for the services list
- [ ] Render columns: Service Name, Team, Department, Cost, Tokens, Invocations, % of Total
- [ ] Aggregate `byService` data across all accounts and the date range
- [ ] Link each service to its parent team detail page
- [ ] Add `EmptyState` for no services / all untagged
- [ ] Connect to the Route Handler — services aggregated across all rollups
- [ ] Tests: cross-account aggregation correctness

**Verify.**

- [ ] Services from all teams appear
- [ ] Sorted by cost

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

#### Phase 4.8 — Users Page (`/dashboard/users`)

**Lesson.** Like Services, but for `byUser` data. You learn that **all per-user
cost is an estimate** — every value carries `CostEstimateIndicator` — because
cost is split proportionally from token ratios.

**Dependencies.** Phase 4.7.

**Build tasks.**

- [ ] Reuse `UsageTable` for the users list (with `UserAvatar`)
- [ ] Render columns: User (avatar + name), Team, Department, Cost, Tokens, Invocations, % of Total
- [ ] Attach `CostEstimateIndicator` to all per-user cost values
- [ ] Link each user to their parent team detail page
- [ ] Add `EmptyState` for no users
- [ ] Connect to the Route Handler — users aggregated across all rollups
- [ ] Tests: cross-account user aggregation; `CostEstimateIndicator` appears

**Verify.**

- [ ] Users from all teams appear
- [ ] The estimated-cost indicator is shown

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

#### Phase 4.9 — Settings Page (`/dashboard/settings`)

**Lesson.** The only page with **write operations**. You learn **Server
Actions** through `next-safe-action` — every action has a Zod input schema and
an Auth.js session check — and that a missing `SyncStatus` item is a valid
"never synced" state, not an error.

**Dependencies.** Phase 4.8.

**Build tasks.**

- [ ] Build the account registry table with add / edit / deactivate actions
- [ ] Build the add-account form (shadcn Dialog): account ID, name, department, team, region
- [ ] Build the edit-account form (shadcn Sheet)
- [ ] Build deactivate with a confirmation dialog
- [ ] Zod-validate all form inputs; route every Server Action through `next-safe-action`
- [ ] Build the sync status display (last run, status, accounts processed, duration, errors) and connect `SyncStatusBadge` / `SyncCountdown` to the `SyncStatus` entity
- [ ] Build the `TagCoverageBar` component (tagged vs `_untagged` percentage per team)
- [ ] Build the `CostEstimateIndicator` component (subtle badge for estimated cost)
- [ ] Build the data-retention display (TTL info, read-only)
- [ ] Tests: CRUD against DynamoDB Local; form validation; tag-coverage calculation

**Verify.**

- [ ] Can add / edit / deactivate accounts
- [ ] Sync status displays correctly
- [ ] Tag coverage renders

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

### Phase 5 — Polish & Accessibility

> Spec: [implementation-phases.md → Phase 5](../specs/2026-05-15-implementation-phases.md)

**Lesson.** This phase teaches **production resilience and inclusion**. You add
a per-section `ErrorBoundary` everywhere (one failing chart never crashes the
page), run a full **accessibility audit** (WCAG AA contrast, keyboard
navigation, aria-labels, visible focus rings), verify every breakpoint, test
empty and large datasets with the seed scripts, and write **Playwright E2E**
tests for the critical user journeys.

**Dependencies.** Phase 4 (all sub-phases, green gates).

**Build tasks.**

- [ ] Add a per-section `ErrorBoundary` on every page
- [ ] Accessibility: verify 4.5:1 contrast minimum (target 7:1 on key text)
- [ ] Accessibility: verify all interactive elements are keyboard-reachable
- [ ] Accessibility: add aria-labels to icon-only buttons, charts, status indicators
- [ ] Accessibility: verify 2–4px visible focus rings; meaningful alt text; aria-live regions for dynamic updates
- [ ] Responsive: verify all breakpoints (375 / 768 / 1024 / 1440), no horizontal scroll, charts resize, 44×44px touch targets
- [ ] Verify empty states on all pages with `seed-empty.ts`
- [ ] Performance-test with `seed-large.ts` (pagination at scale, chart render, no memory issues)
- [ ] Verify `prefers-reduced-motion` is respected
- [ ] Populate the `CommandMenu` with real data (departments, teams, users, services)
- [ ] Write Playwright E2E specs: login, Overview load, Ranking tab switching, department drill-down, Settings CRUD, date-filter propagation
- [ ] Add Playwright to GitHub Actions CI

**Verify.**

- [ ] All build tasks above complete and passing

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

### Phase 6 — AWS Lambda Collector

> Spec: [implementation-phases.md → Phase 6](../specs/2026-05-15-implementation-phases.md),
> [system-architecture.md](../specs/2026-05-15-system-architecture.md),
> [aws-infrastructure.md](aws-infrastructure.md)

**Lesson.** The final phase brings **real data**. You learn **CloudWatch
cross-account observability** and an **organization CloudTrail Lake** event
data store — how the collector reaches every member account with a *single*
cross-account role hop (assuming `CostExplorerReadRole`). You learn the
**three-source merge**: CloudWatch is authoritative for token/invocation
totals, CloudTrail Lake is the only source with per-user/per-service
attribution, Cost Explorer is authoritative for cost — with documented
precedence when they disagree. You learn the **two-day refresh** (yesterday
finalized, today estimated) and **proportional cost estimation**
(`userCost = userTokens / cloudWatchModelTokens × modelCost`). Infrastructure
is **SAM** for the collector and **plain CloudFormation** for the management
role. The collector imports the same `packages/shared` the dashboard uses, so
model normalization never drifts.

**Dependencies.** Phase 3 (the Zod schemas and model normalization in
`packages/shared`, and the shared DynamoDB table structure). Practically, the
dashboard (Phases 1–5) is finished first; Phase 6 is the last build.

**Build tasks — one-time AWS setup.**

- [ ] Designate a dedicated observability account (Control Tower *Log Archive* account fits)
- [ ] Enable CloudWatch cross-account observability (observability = monitoring account; source links org-wide)
- [ ] Configure the organization CloudTrail; set the observability account as CloudTrail delegated administrator
- [ ] Deploy `CostExplorerReadRole` to the management account (plain CloudFormation; `ce:GetCostAndUsage`; trusts `BedrockCollectorLambdaRole`)
- [ ] Create GitHub Actions OIDC deploy role(s) — no static AWS keys in CI

**Build tasks — Lambda implementation.**

- [ ] Create the Lambda project in `apps/collector` (Node.js 22.x, TypeScript), depending on `@bedrock-usage/shared`
- [ ] Read the account registry from DynamoDB (all active `AccountMeta` items)
- [ ] Query Cost Explorer (assume `CostExplorerReadRole`): `GetCostAndUsage` for yesterday + today, filtered to `AmazonBedrock`, grouped by `LINKED_ACCOUNT` and `USAGE_TYPE`
- [ ] Query CloudTrail Lake locally: `StartQuery` then poll `GetQueryResults`; Bedrock invocations grouped by account, SSO username, inference profile, model
- [ ] Query CloudWatch via cross-account observability: `GetMetricData` per `ModelId` (InputTokenCount, OutputTokenCount, Invocations, InvocationLatency)
- [ ] Normalize raw Bedrock model IDs to canonical keys via `@bedrock-usage/shared`
- [ ] Implement the today's-cost fallback (static price table × token counts when Cost Explorer returns zero)
- [ ] Merge all three sources per account per day, applying the three-source merge precedence rules
- [ ] Resolve inference profile `service=<name>` tags (CloudTrail event → `ListTagsForResource` → name convention → `_untagged`)
- [ ] Implement per-user / per-service proportional cost estimation (all carry `costEstimated: true`)
- [ ] Implement the two-day refresh (yesterday `costFinalized: true`, today `false`)
- [ ] Write/overwrite `DailyRollup` items via `BatchWriteItem` (25/batch); update the `SyncStatus` item with `nextScheduledAt`
- [ ] Author the SAM template (`apps/collector/template.yaml`): `bedrock-cost-collector` function, `BedrockCollectorLambdaRole`, EventBridge hourly cron, the `bedrock-usage` table (PK/SK + GSI1, TTL), a failure alarm
- [ ] Configure SAM `BuildMethod: esbuild` to bundle `@bedrock-usage/shared`; verify the built bundle contains shared code
- [ ] Handle partial failures (some accounts fail → `SyncStatus` status `"partial"`)
- [ ] Tests: unit tests for model normalization, data merging, the cost-estimation formula
- [ ] Deploy to the observability account via `sam build && sam deploy` (OIDC-assumed role)
- [ ] Switch the Next.js app from DynamoDB Local to the production DynamoDB table

**Verify.**

- [ ] The Lambda runs on schedule
- [ ] `DailyRollup` items appear in DynamoDB
- [ ] `SyncStatus` updates

**Gate:**  `[ ] Works   [ ] Tested   [ ] Reviewed`

---

## Dependency Map

```
Phase 1 ─▶ Phase 2 ─▶ Phase 3 ─┬─▶ Phase 4.1 ─▶ 4.2 ─▶ 4.3 ─▶ 4.4 ─▶ 4.5
                               │      ─▶ 4.6 ─▶ 4.7 ─▶ 4.8 ─▶ 4.9
                               │           │
                               │           ▼
                               │       Phase 5 ─▶ Phase 6
                               │                    ▲
                               └────────────────────┘
                          Phase 6 also depends directly on the
                          Phase 3 schemas in packages/shared.
```

| Phase | Depends on | Notes |
|---|---|---|
| 1 Foundation | — | Starting point |
| 2 Layout Shell | 1 | — |
| 3 Data Layer | 1, 2 | Schemas in `packages/shared` are reused by Phase 6 |
| 4.1 – 4.9 Pages | 3, then each prior sub-phase | Strict order; one sub-phase per PR |
| 5 Polish | 4 (all sub-phases) | — |
| 6 Collector | 5 in practice; 3 for shared schemas | Last build; brings real data |

---

## Glossary — Key Concepts

| Term | Meaning |
|---|---|
| **Canonical model key** | Normalized Bedrock model ID — `claude-opus`, `claude-sonnet`, `claude-haiku`, or `other`. Mapping lives in `packages/shared/src/models.ts`. |
| **`DailyRollup`** | The core DynamoDB entity: one item per account per day. Metrics broken down by model first, with `byUser` / `byService` nested inside each model. |
| **`AccountMeta`** | DynamoDB entity mapping an AWS account to its department and team. |
| **`SyncStatus`** | Single DynamoDB item tracking the collector's last run. A *missing* item is the valid "never synced" state — never an error. |
| **GSI1** | The single global secondary index (`gsi1pk`/`gsi1sk`, projection `ALL`). Queries can exceed 1 MB — always loop on `LastEvaluatedKey`. |
| **Inference profile** | A tagged Bedrock application inference profile (`service=<name>`). Calls routed through one are attributable to that service. Untagged usage → `_untagged`. |
| **`costEstimated`** | `true` when a cost value is a proportional estimate (always true for per-user and per-service cost). |
| **`costFinalized`** | `false` for today's rollup (cost estimated from tokens), `true` for yesterday's (exact, from Cost Explorer). |
| **Observability account** | The dedicated AWS account hosting the collector, DynamoDB, EventBridge, CloudTrail Lake, and CloudWatch monitoring. |
| **Server-only boundary** | DynamoDB and the AWS SDK are touched only by server code; data-access files import `server-only`; credentials never reach the browser. |
| **Three-source merge** | Combining Cost Explorer (cost), CloudWatch (token/invocation totals), and CloudTrail Lake (per-user/per-service attribution) into one rollup. |
