# Design System Spec

**Status:** Draft
**Date:** 2026-05-15
**Scope:** Visual design system, UI/UX standards, and technology stack for the Bedrock Cost Dashboard

---

## Overview

Enterprise analytics dashboard for tracking AWS Bedrock usage and cost across an organization. Optimized for data density, readability, and light mode.

## Technology Stack

| Layer | Technology | Version/Notes |
|-------|-----------|---------------|
| **Framework** | Next.js (App Router) | Latest stable, Server Components, Route Handlers |
| **Language** | TypeScript | Strict mode, 6.x |
| **Runtime** | Node.js | 22 LTS |
| **Package Manager** | pnpm | Fast, disk-efficient, lockfile |
| **Styling** | Tailwind CSS | v4+ |
| **UI Components** | shadcn/ui | Copy-paste components on Radix UI primitives |
| **Design patterns** | UI UX Pro Max | Component patterns, accessibility, interactions |
| **Authentication** | Auth.js (NextAuth v5) | Microsoft Entra ID provider; provider-agnostic, swappable in `apps/dashboard/auth.ts` |
| **Validation** | Zod | v4, all API boundaries and form inputs |
| **Charts** | Recharts | Stacked area, bar, donut charts |
| **Icons** | Lucide React | SVG-based, consistent stroke width |
| **Tables** | TanStack Table | Sorting, filtering, pagination |
| **Data Fetching** | TanStack Query | Server state cache, auto-refetch, deduplication |
| **URL State** | nuqs | Type-safe search params (filters, date ranges, tabs) |
| **Dates** | date-fns | Tree-shakeable, TypeScript-native |
| **Class Merging** | tailwind-merge + clsx | Conditional Tailwind classes without conflicts |
| **AWS SDK** | @aws-sdk/lib-dynamodb | DynamoDB document client |
| **Monitoring** | OpenTelemetry (`@vercel/otel`) | OTLP export of errors, traces, and metrics to the Prometheus/Loki/Grafana stack (Grafana Cloud free tier in production) |
| **Env Validation** | @t3-oss/env-nextjs | Type-safe environment variables with Zod |
| **Server Actions** | next-safe-action | Type-safe actions with Zod validation and rate limiting |
| **Linting** | ESLint v9 | Flat config (`eslint.config.ts`) |
| **Formatting** | Prettier | Code formatting, paired with ESLint |
| **Git Hooks** | Husky + lint-staged | Pre-commit: ESLint + Prettier on staged files |
| **Secret Detection** | gitleaks | Pre-commit scan for AWS keys, `AUTH_SECRET`, OAuth client secrets, tokens |

## Technology Decisions

Decisions on technologies evaluated and excluded, with rationale:

| Technology | Decision | Rationale |
|---|---|---|
| **GraphQL** | Not used | One client, one data source (DynamoDB), fixed access patterns. Route Handlers with Zod validation are simpler and sufficient. GraphQL would add schema definitions, resolvers, and a server layer with no flexibility benefit. |
| **gRPC** | Not used | No service-to-service communication. Browser clients need a gRPC-Web proxy — extra infra for no gain. Dashboard refreshes hourly, not real-time streaming. Single language (TypeScript) across the stack. |
| **Redux** | Not used | Read-heavy dashboard with minimal client state. TanStack Query handles server state, nuqs handles URL state, React useState handles UI state. Redux would add boilerplate (store, slices, reducers) with nothing to manage. |
| **Zustand** | Not used | Same reasoning as Redux. No complex shared client state (no shopping cart, drag-and-drop, or real-time collaboration). If needed in the future, Zustand would be the lightweight choice over Redux. |
| **Sentry** | Not used (OpenTelemetry instead) | Sentry's free Developer tier is a 30-day trial only — beyond that it is a paid SaaS. The project already runs an OpenTelemetry Collector + Prometheus + Loki + Grafana stack (devcontainer) for Claude Code telemetry; exporting the dashboard's errors and traces to that same stack reuses existing infrastructure at no cost, with Grafana Cloud's free tier in production. |
| **DynamoDB DAX** | Not used | Data updates once per hour. Next.js server cache (1hr TTL) already reduces DynamoDB reads to ~1/hour per unique query. DAX adds cost with no benefit at this refresh rate. |
| **Redis / Valkey** | Not used | Same reasoning as DAX. Next.js built-in cache + TanStack Query client cache are sufficient for hourly-updating data. No extra infrastructure to manage. |
| **Vite** | Not used | Next.js has its own bundler (Turbopack in dev, Webpack in production). Adding Vite would conflict with Next.js's build pipeline. |
| **Docker** | Deferred to deployment phase | Not needed for local development — `pnpm dev` is simpler. Will add Dockerfile when deploying the Next.js app. DynamoDB Local does run in Docker (the one exception during development). |
| **Tremor** | Not used (Recharts instead) | Recharts gives finer control over chart internals and has a larger ecosystem. Tremor's component layer overlaps with shadcn/ui, which would create two competing component systems. |
| **Plain React SPA** | Not used (Next.js kept) | Replacing Next.js with a client-only React SPA (e.g. Vite) was evaluated. Rejected: the server-only data boundary (Rule 10) depends on Server Components and Route Handlers reading DynamoDB with the AWS SDK credential chain. A SPA pushes AWS access to the browser or forces a separate API Gateway + Lambda tier — extra infrastructure that duplicates what Next.js Route Handlers already provide. Auth.js session handling, the 1-hour server cache (matching the Lambda cycle), and per-section SSR/Suspense streaming are also lost in a SPA. Next.js stays. |

## Authentication

- **Library:** Auth.js (NextAuth v5) — the provider abstraction. Switching identity providers is a config change in `apps/dashboard/auth.ts` (plus its variables in `env.ts`); pages, proxy, and route guards use Auth.js session APIs and never change.
- **Identity provider:** Microsoft Entra ID in production. Recommended start: a free Entra tenant, developing against the real provider from day one; without a tenant, a dev-only local login is available outside production (System Architecture spec — *Authentication & Access*, decided 2026-10-29).
- **Access model:** Open read access — every authenticated member sees all data; account mutations require the `Admin` role (see *Roles*).
- **Session:** Auth.js encrypted JWT session cookie; it ends 8 hours after sign-in regardless of activity (System Architecture — *Authentication & Access*).
- **Proxy:** Auth.js in the Next.js proxy (`proxy.ts`) protects all `/dashboard/*` and `/api/*` routes.
- **Sign-in page:** One action per configured provider — "Sign in with Microsoft" when Entra ID is configured, a local dev sign-in only when the dev login is enabled outside production. No sign-up — identities are managed in Entra ID.
- **User menu:** Custom user menu in the top bar (avatar, name, sign out) backed by the Auth.js session.
- **Roles:** One app role, `Admin`, gates account mutations (System Architecture — *Authentication & Access*, decided 2026-10-29). Every signed-in member reads all pages; Settings hides add/edit/deactivate controls from non-admins, and the write routes return `403` regardless of the UI.

## Data Access Boundary

DynamoDB and the AWS SDK are **server-only**. Client Components never access the database.

- Data-access functions live in `apps/dashboard/lib/data/` and import `server-only` — imported only by Route Handlers and Server Components. A client-side import is a build error.
- **Client Components** get data two ways: as props from a Server Component, or via TanStack Query calling a same-origin Route Handler over HTTP. They never import `apps/dashboard/lib/data/` or the AWS SDK.
- **Route Handlers** (`apps/dashboard/app/api/*`) are the only HTTP-reachable backend: check the Auth.js session (and the `Admin` role on every write route), validate input with Zod, query DynamoDB, return the standardized `{ data }` / `{ error }` shape.
- AWS credentials and the AWS SDK never ship to the browser.

## Caching Strategy

Data updates once per hour (Lambda cycle), making caching highly effective:

| Layer | Tool | TTL | What it caches |
|---|---|---|---|
| **Server** | Next.js `unstable_cache` / fetch cache | 1 hour (matches Lambda cycle) | DynamoDB query results in Route Handlers — rollups cached per UTC day; account lists tagged and invalidated on account writes |
| **Server** | Next.js `unstable_cache` | 5 minutes | `SyncStatus` — `SyncCountdown` reads `nextScheduledAt`, and `unstable_cache` serves the stale value while it refreshes, so an hour would show a past time |
| **Client** | TanStack Query `staleTime` | 5-10 minutes | Prevents re-fetching on tab/filter switches |
| **Static** | Next.js static assets | Immutable | JS bundles, fonts, icons |

All users see the same data (no per-user cache fragmentation). Combined with TanStack Query deduplication, DynamoDB gets hit approximately once per hour per unique query pattern, not once per user request.

## Performance Patterns

### Suspense Boundaries (Non-Blocking Loads)

Each dashboard section loads independently. A slow chart does not block KPI cards:

```
┌──────────────────────────────────────────────┐
│ Header + DateRangePicker (instant)            │
├───────────┬───────────┬───────────┬──────────┤
│ <Suspense> │ <Suspense> │ <Suspense> │ <Suspense>│
│ MetricCard │ MetricCard │ MetricCard │ MetricCard│
├───────────┴───────────┴───────────┴──────────┤
│ <Suspense>                                    │
│ CostTrendChart (dynamic, ssr: false)          │
├──────────────────────┬───────────────────────┤
│ <Suspense>            │ <Suspense>             │
│ TopDepartments        │ ModelBreakdown         │
├──────────────────────┴───────────────────────┤
│ <Suspense>                                    │
│ UsageTable (paginated, 20 rows default)       │
└──────────────────────────────────────────────┘
```

### Patterns to Follow

- **Section data (Phase 4.1, adopted 2026-11-03):** a section's component reads its TanStack Query through `lib/query/section-data.ts` and draws its own Skeleton while pending; a failed query throws to the section's `SectionBoundary` (Suspense + error boundary), which resets when the date range changes or after any successful Retry. `<Suspense>` remains the fallback for lazy chart chunks. Later pages follow the same pattern.

| Problem | Pattern |
|---|---|
| **Rendering huge datasets** | TanStack Table with pagination (default 20 rows) + server-side `limit` param in Zod query schemas |
| **SSR chart hydration errors** | Lazy-load Recharts with `next/dynamic` + `ssr: false` — charts render client-only |
| **Too many API calls** | TanStack Query deduplication + staleTime (5-10min) + Next.js server cache (1hr) + nuqs prevents refetch on URL change |
| **Giant client-side bundles** | `next/dynamic` for charts + code splitting per route + tree-shakeable libraries (date-fns, Lucide) |
| **Global state everywhere** | No Redux/Zustand — server state in TanStack Query, URL state in nuqs, local state in useState |
| **Non-responsive charts** | Recharts `ResponsiveContainer` wrapping every chart + Tailwind container queries for card layout |
| **Blocking dashboard loads** | React Suspense boundaries per section — each section loads independently with skeleton fallbacks |

## Git Hooks

Pre-commit (Husky + lint-staged + gitleaks):
1. **lint-staged** — ESLint fix + Prettier format on staged files only
2. **gitleaks** — scans staged changes for secrets (AWS keys, `AUTH_SECRET`, `AUTH_*_SECRET`, tokens)

Pre-push:
- `tsc --noEmit` — TypeScript type check catches type errors before PR

## Style: Light Mode

Selected for enterprise SaaS analytics dashboards — clean, high-contrast, print-friendly.

- **Mode support:** Light primary
- **Performance:** Excellent
- **Accessibility:** WCAG AAA target for key text; muted/secondary text meets AA (4.5:1) on every surface it sits on
- **Key effects:** Soft indigo shadows, subtle surface layering, high readability, visible focus states

## Color Palette

| Role | Hex | CSS Variable | Usage |
|------|-----|-------------|-------|
| Primary | `#4F46E5` | `--color-primary` | Navigation active states, primary buttons |
| On Primary | `#FFFFFF` | `--color-on-primary` | Text on primary color |
| Secondary | `#6366F1` | `--color-secondary` | Links, secondary actions |
| Accent/CTA | `#D97706` | `--color-accent` | Warnings, highlights, cost alerts |
| Background | `#F5F7FF` | `--color-background` | Page background (soft blue-gray canvas) |
| Foreground | `#0F172A` | `--color-foreground` | Primary text |
| Muted foreground | `#566880` | `--color-muted-foreground` | Placeholders, muted text |
| Muted | `#E2E8F0` | `--color-muted` | Muted surfaces (subtle fills, tracks) |
| Border | `#E2E8F0` | `--color-border` | Card borders, dividers |
| Destructive | `#E11D48` | `--color-destructive` | Error states, high cost alerts |
| Success | `#059669` | `--color-success` | Positive trends, low cost indicators |
| Ring | `rgba(79,70,229,0.35)` | `--color-ring` | Focus rings |

**Muted foreground (changed 2026-10-29).** Raised from `#94A3B8` (2.0–2.6:1) to `#566880` so muted text meets WCAG AA 4.5:1 on card, background, muted, accent and sidebar surfaces (lowest: 4.62:1 on Muted `#E2E8F0`). `apps/dashboard/app/globals-contrast.test.ts` enforces it. The vendored `docs/design-system/` previews still show the old value; this table wins.

**Known divergence (pre-existing, Phase 1).** The table lists Accent/CTA `#D97706` as `--color-accent`, but `apps/dashboard/app/globals.css` defines `#D97706` as `--color-warning` and sets `--color-accent` to `#EEF2FF` (shadcn's neutral interactive surface). This spec does not resolve it; a follow-up decision should ratify one mapping and update either this table or the code.

### Chart Colors (Per Model)

Each Bedrock model gets a consistent color across all charts:

| Model | Color | Hex |
|-------|-------|-----|
| Claude Opus | Deep purple | `#7C3AED` |
| Claude Sonnet | Blue | `#3B82F6` |
| Claude Haiku | Teal | `#14B8A6` |
| Other models | Amber | `#D97706` |

**Non-model cost.** Bedrock charges that are not model token usage (Data Model spec — *Non-Model Charges*) use one dedicated semantic token, `--color-cost-non-model`, never a model token and never the `other` amber. Its value is `--color-cost-non-model: var(--color-foreground)` (slate `#0F172A`), chosen in Phase 3.1a: about 17.9:1 against the white card, so it passes WCAG 1.4.11's 3:1 non-text contrast minimum for chart series, and its neutral hue stays distinct from the purple, blue, teal and amber model series. It introduces no new raw hex; components reference the token only (Rule 40.2). Phase 5 may swap in a lighter neutral alias only if that alias still passes 3:1 against the card.

### Chart Colors (Per Team)

`CostTrendChart groupBy="team"` (Department Detail — "Cost over time: stacked area by team") colours each team series from a dedicated categorical palette, `--color-team-1` … `--color-team-8`, assigned in first-seen order and cycling after eight (adopted 2026-11-03). Teams are an open set, so colour alone never identifies a team: the legend, tooltip and the chart's screen-reader data table carry the team name (UX Standards — *Accessible colors*).

| Token | Hex |
|-------|-----|
| `--color-team-1` | `#0E7490` |
| `--color-team-2` | `#C2410C` |
| `--color-team-3` | `#4D7C0F` |
| `--color-team-4` | `#BE185D` |
| `--color-team-5` | `#0369A1` |
| `--color-team-6` | `#A16207` |
| `--color-team-7` | `#A21CAF` |
| `--color-team-8` | `#78716C` |

Every team token passes WCAG 1.4.11's 3:1 non-text minimum against the card (lowest: `--color-team-8`, 4.80:1). No team token reuses the value of a model token, `--color-cost-non-model`, `--color-primary`, `--color-success` or `--color-destructive`. A team series never uses a model token and a model series never uses a team token (Rule 40.2). Values are defined once in `apps/dashboard/app/globals.css`; components reference the tokens only. `apps/dashboard/app/globals-contrast.test.ts` enforces contrast and distinctness.

## Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Headings | Space Grotesk | 600-700 | Page titles, section headers, card titles |
| Body | Space Grotesk | 300-500 | Paragraphs, labels, descriptions |
| Data/Numbers | JetBrains Mono | 400-600 | Table cells, chart labels, token counts, costs, KPI values |

**Google Fonts import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
```

- **Type scale:** 12 / 14 / 16 / 18 / 24 / 32 / 48
- **Base:** 16px body
- **Line height:** 1.5 for body, 1.2 for headings
- **Number formatting:** Tabular/monospaced figures for data columns (JetBrains Mono handles this natively)

## Layout

### Breakpoints

| Name | Width | Layout |
|------|-------|--------|
| Mobile | 375px | Single column, collapsible sidebar |
| Tablet | 768px | Two columns, sidebar overlay |
| Desktop | 1024px | Full sidebar + content |
| Wide | 1440px | Full sidebar + content with max-width container |

### Structure

```
+----------+------------------------------------------+
| Brand    |  Top Bar: Page title · Sync | [7D 30D 90D] · User menu
+----------+------------------------------------------+
|  MAIN    |                                           |
| Overview |  Content Area                             |
|          |  +--------------------------------------+ |
| ATTRIB.  |  |  Page Content                        | |
| Ranking  |  |  (cards, charts, tables)             | |
| Depts    |  +--------------------------------------+ |
| Teams    |                                           |
| Services |                                           |
| Users    |                                           |
|          |                                           |
| Settings |                                           |
+----------+------------------------------------------+
```

- Brand (logo + product + org name) sits at the top of the sidebar, not in a
  full-width header; it collapses to the mark when the rail collapses.
- Top bar lives **inside** the content area, to the right of the sidebar. The
  active page title and its sync-status badge read as one unit on the left; the
  global `DateRangePicker`, command menu, sync countdown, and user menu sit on
  the right. The date filter lives here — not in a content-area band — so it
  reads as a single global control across every page (the earlier "Page Header +
  Date Range Filter" content band was dropped in favour of the top-bar toggle).
- Top bar responsiveness (decided 2026-10-29): below `md` (768) it may wrap to
  two rows; from `md` up it is one row whose bottom border aligns with the
  sidebar header. To fit, the sync-status badge and sync countdown show
  icon-only below `lg` (1024) and icon + text from `lg`; the command-menu
  trigger is icon-only from `md` to 1439 px and shows its "Search…" label and
  ⌘K hint from 1440. Compact forms keep their full meaning in `aria-label` and
  `title` (the search trigger also carries `aria-keyshortcuts`); nothing in the
  top bar is hidden from `md` up. Thresholds from `md` up use only the
  breakpoints below (Rule 40.6); below `md`, where the bar may wrap, the
  countdown is hidden under Tailwind's `sm` (640).
- Page title is the descriptive heading (e.g. "Cost overview"), not the short
  sidebar label ("Overview").
- Sidebar: collapsible, persistent on desktop, overlay on mobile; nav is grouped
  (**Main**, **Attribution**) with Settings pinned to the footer.
- Content area: max-width 1280px, centered
- Spacing: 4px/8px grid system

## Page Architecture

### Navigation (Sidebar)

Nav is grouped: **Main** (Overview) and **Attribution** (the per-dimension
breakdowns); Settings is pinned to the sidebar footer. Each item carries a short
rail label and a descriptive page title shown in the top bar.

| Group | Item (rail label) | Page title | Route | Description |
|-------|-------------------|------------|-------|-------------|
| Main | Overview | Cost overview | `/dashboard` | KPI cards, cost trend chart, top consumers |
| Attribution | Ranking | Cost ranking | `/dashboard/ranking` | Leaderboard with tabs + model filter |
| Attribution | Departments | Department breakdown | `/dashboard/departments` | Department cards grid |
| — | Department Detail | Department breakdown | `/dashboard/departments/[id]` | Teams breakdown, cost over time (drill-down, no rail item) |
| Attribution | Teams | Team breakdown | `/dashboard/teams` | Teams list, filterable by department |
| — | Team Detail | Team breakdown | `/dashboard/teams/[id]` | Services + users breakdown (drill-down, no rail item) |
| Attribution | Services | Service breakdown | `/dashboard/services` | All services across all accounts |
| Attribution | Users | User breakdown | `/dashboard/users` | All users across all accounts |
| Footer | Settings | Settings | `/dashboard/settings` | Account registry, sync status, tag coverage |

### Overview Page

KPI metric cards:
- Total Cost (with trend arrow vs previous period)
- Total Tokens (input + output combined)
- Total Invocations
- Most Used Model
- Active Accounts

Charts:
- Cost trend: stacked area chart by model (last 30 days)
- Top 5 departments by cost: horizontal bar chart
- Model distribution: donut chart
- Sync status indicator with last update time and countdown to next run
- Non-model cost (data from Phase 3.1a; built in Phase 4.1): Total Cost shows a model / non-model split, recurring categories carry a "recurring" indicator, non-model cost is its own series in the cost trend and model distribution charts, and totals carry the "Bedrock service charges only" scope note (Data Model spec — *Dashboard impact (v1)*).

### Ranking Page

```
Tabs:   [Departments] [Teams] [Services] [Users]
Filter: Model: [All Models v]  Date: [Last 30 days v]
```

Sortable data table columns:
- Rank (with medal icons for top 3)
- Name
- Cost ($)
- Input Tokens
- Output Tokens
- Invocations
- % of Total
- Trend (sparkline or arrow vs previous period)

### Department Detail Page

- Department header with total cost, tokens, invocations
- Teams breakdown table (sortable)
- Cost over time: stacked area by team
- Model usage breakdown: bar chart
- Top users in this department: ranked list

### Team Detail Page

- Team header with account ID, total cost, tokens
- Services breakdown table
- Users breakdown table
- Model usage breakdown: bar chart
- Cost over time: line chart

### Settings Page

- Account registry: add/edit/deactivate accounts, map to dept/team (`Admin` role; read-only for other members)
- Sync status: last run time, success/error count, next scheduled run
- Tag coverage: per-team percentage of tagged vs untagged usage
- Data retention: TTL configuration display

## Responsive Tables

Data tables (`UsageTable`, `RankingList`) have up to 8 columns, which cannot fit a 375px viewport without horizontal scroll — an anti-pattern. Tables therefore adapt by breakpoint:

- **Desktop / tablet (≥ `md`, 768px+):** Full table — all columns, sortable headers.
- **Mobile (< `md`):** Each row collapses into a **card**. The entity name is the card title, Cost is shown prominently, and the remaining metrics render as label–value pairs. TanStack Table drives both renders from the same data, sorting, and pagination.

Sort and filter controls (`SearchInput`, `ModelFilter`, `ColumnToggle`, `Pagination`) remain available in both layouts. No horizontal scroll at any viewport.

## Date Filtering

Global date filter rendered once in the top bar, shared by every dashboard page:

- **Presets:** 7 days, 30 days, 90 days, Custom range
- **Default:** Last 30 days
- **Control:** a segmented toggle (`7D / 30D / 90D / Custom`) on one bordered
  track; the active preset is filled with the brand primary, inactive segments
  are muted text (see **Control Patterns**). `Custom` opens a shadcn/ui
  `Calendar` in a `Popover`.
- **Date logic:** UTC calendar-day arithmetic (Rule 20.1); custom ranges clamp
  to a 90-day span (Rule 20.8). date-fns is used for display formatting only.
- **Persistence:** nuqs stores `dateFrom`/`dateTo` in URL search params
  (shareable, bookmarkable). The control sits under a `<Suspense>` boundary so
  pages still prerender statically.
- **Scope:** Applies to all charts and tables on the current page.

## Control Patterns

Conventions for interactive controls, established with the global
`DateRangePicker` and applied to every later phase. All use semantic tokens —
**no raw hex** (Rule 40.2).

- **Segmented toggles** (preset pickers, tab-like switches): a single bordered
  track (`border-border bg-card`) holding the options. The active option is
  filled `bg-primary text-primary-foreground`; inactive options are
  `text-muted-foreground` with a `hover:text-foreground` lift. Expose state with
  `aria-pressed`.
- **Icon / navigation buttons** (calendar arrows, close, chevrons): the `ghost`
  button variant — no bordered box. Muted by default, foreground on hover.
  Reserve `outline` (bordered) buttons for standalone secondary actions, not for
  inline icon affordances.
- **Popovers, dropdowns, and dialogs:** soft floating surfaces — `rounded-xl`,
  a light `border-border/60`, and `shadow-lg` on `bg-popover`. Avoid heavy
  full-strength borders on overlays.
- **Selection & ranges:** the selected item is `bg-primary`; a range band uses
  `accent`; "today"/current markers are a subtle `accent/60` chip, never a
  competing fill.
- **Focus:** keep the visible focus ring (`ring-ring/50`) on every interactive
  element (Rule 60.30); never remove it to tidy a layout.

## Component Inventory

### Layout & Navigation

| Component | Source | Purpose |
|-----------|--------|---------|
| `Sidebar` | shadcn/ui | Collapsible navigation with active state. Locally patched (2026-10-29): `components/ui/sidebar.tsx` renders desktop markup until hydrated, uses the `border-sidebar-border` token for its edge, and `hooks/use-mobile.ts` uses `useSyncExternalStore`, so a late-hydrating `<Suspense>` does not mismatch at mobile widths; the mobile sheet returns focus to the `SidebarTrigger` on close (`onCloseAutoFocus`), and `SidebarMenuButton` tooltips are held closed on mobile so a single Escape closes the sheet — re-apply after any `shadcn add sidebar`. Nav and brand links close the mobile sheet on click (`AppSidebar`); the footer toggle's accessible name, icon and tooltip follow its action ("Collapse" / "Expand"; always "Collapse" in the mobile sheet) (`AppSidebar`, 2026-10-30) |
| `CommandMenu` | shadcn/ui (cmdk) | Cmd+K quick search — jump to any department, team, user, service |
| `Kbd` | Custom | Keyboard shortcut hints |

### Data Display

| Component | Source | Purpose |
|-----------|--------|---------|
| `MetricCard` | Custom (shadcn Card) | KPI card with value, trend indicator, icon |
| `DeltaBadge` | Custom | "+12.3%" green arrow or "-5.1%" red arrow for trends |
| `UsageTable` | Custom (TanStack Table + shadcn Table) | Sortable, filterable data table with pagination; renders as a card list below the `md` breakpoint (see Responsive Tables) |
| `RankingList` | Custom | Leaderboard with medal icons and % of total bar |
| `SparklineCell` | Custom | Inline trend sparkline for table cells |
| `PercentOfTotalBar` | Custom | Inline bar showing proportion visually in ranking tables |
| `PeriodComparison` | Custom | "vs previous 30 days" side-by-side stat comparison |

### Charts

| Component | Source | Purpose |
|-----------|--------|---------|
| `CostTrendChart` | Recharts | Stacked area chart; `groupBy: 'model' \| 'team'` (loaded with `next/dynamic`, `ssr: false`) |
| `ModelBreakdownChart` | Recharts | Donut chart showing model distribution |

### Filters & Controls

| Component | Source | Purpose |
|-----------|--------|---------|
| `DateRangePicker` | shadcn/ui Calendar + Popover | Date range filter (7d, 30d, 90d, custom) |
| `ModelFilter` | shadcn/ui Select | Dropdown to filter by specific Bedrock model |
| `SearchInput` | shadcn/ui Input | Debounced text filter for tables |
| `ColumnToggle` | shadcn/ui DropdownMenu | Show/hide table columns |
| `Pagination` | shadcn/ui | Page through table results (default 20 rows) |
| `ExportButton` | Custom | Export table data to CSV |

### Status & Feedback

| Component | Source | Purpose |
|-----------|--------|---------|
| `SyncStatusBadge` | Custom (shadcn Badge) | Top-bar sync indicator on `GET /api/sync-status` (live from Phase 4.1). Shows Success / Partial / Error from `SyncStatus.status` (the tone colours the icon only; text stays a text token for 4.5:1), "No sync yet" when the item is missing (Rule 20.9), and neutral "Loading" / "Unavailable" while the request is pending or has failed — never an alert. `aria-label` and `title` carry the status and the last run time in UTC. ARIA `role="status"` (polite live region) |
| `SyncCountdown` | Custom | "Next sync in 42 min" countdown in top bar to `SyncStatus.nextScheduledAt` (required when the item exists — `SyncStatusSchema`, Rule 20.9); an overdue time reads "0 min", never negative; sync status refetches every 5 minutes (*Caching Strategy*). Neutral "Next sync: pending" while loading, when no sync has run, or when the request fails. ARIA `role="timer"` (implicit `aria-live="off"`), so ticks are not announced — never a `status` live region (decided 2026-10-29) |
| `CostEstimateIndicator` | Custom (shadcn Badge) | Subtle badge when cost is estimated (not finalized) |
| `TagCoverageBar` | Custom | Progress bar showing % of tagged usage per team |
| `EmptyState` | Custom | Reusable empty state with icon, message, and optional CTA |
| `ErrorBoundary` | Custom | Per-section error boundary — one chart failing doesn't crash the page |
| `Skeleton` | shadcn/ui | Loading placeholder for sections taking >300ms |

### Identity & Badges

| Component | Source | Purpose |
|-----------|--------|---------|
| `ModelBadge` | Custom | Model name with its assigned color dot |
| `AccountIdBadge` | Custom | Formatted AWS account ID with copy button (123-456-789-012) |
| `UserAvatar` | Custom | Initials avatar with consistent color per user |

## UX Standards (from UI UX Pro Max)

### Critical (Must Have)

- **Accessibility**: Contrast 4.5:1 minimum, alt text, keyboard navigation, aria-labels, focus rings (2-4px)
- **Touch targets**: Minimum 44x44px, 8px spacing between targets
- **Loading states**: Skeleton screens for >300ms loads, spinner on async buttons
- **Error feedback**: Clear messages near the problem field, recovery path included

### High Priority

- **Responsive**: Mobile-first, no horizontal scroll, viewport meta tag
- **Typography**: Base 16px, line-height 1.5, semantic color tokens (no raw hex in components)
- **Navigation**: Bottom nav max 5 items on mobile, predictable back behavior, active state highlighted

### Charts and Data (Dashboard-Specific)

- **Chart type matching**: Trend = line/area, comparison = bar, proportion = donut
- **Accessible colors**: Don't rely on color alone — add patterns/labels
- **Legends**: Always visible, near the chart, clickable to toggle series
- **Tooltips**: On hover (desktop) and tap (mobile) showing exact values
- **Empty states**: "No data yet" with guidance, not blank charts
- **Stacked charts**: Cost trend stacked by model, with legend toggle to show/hide series
- **Number formatting**: Locale-aware, tabular figures, abbreviated for large numbers ($12.5K)
- **Gridlines**: Low-contrast (`rgba(15,23,42,0.06)` on light bg) so they don't compete with data
- **Responsive charts**: Every chart wrapped in Recharts `ResponsiveContainer` + Tailwind container queries

### Animation

- **Duration**: 150-300ms for micro-interactions
- **Easing**: ease-out for entering, ease-in for exiting
- **Reduced motion**: Respect `prefers-reduced-motion`
- **Chart animation**: Entrance animations optional, data readable immediately

## Anti-Patterns to Avoid

- Dark mode as default (light mode primary for this product)
- Emoji as icons (use Lucide SVG icons)
- Placeholder-only form labels
- Gray-on-gray text
- Raw hex values in components (use semantic tokens)
- Horizontal scroll on any viewport
- Animations > 500ms
- Pie charts for > 5 categories (use bar chart instead)
- Color alone to convey meaning (always add icon or text)
- Decorative-only animations (every animation must express cause-effect)
- Rendering huge datasets without pagination
- SSR rendering of chart libraries (use `next/dynamic` with `ssr: false`)
- Global state libraries for read-heavy dashboards (use TanStack Query + nuqs)
- Blocking page loads (use Suspense boundaries per section)
- Treating a missing SyncStatus item (before the Lambda's first run) as an error — show a neutral "No sync has run yet" state
