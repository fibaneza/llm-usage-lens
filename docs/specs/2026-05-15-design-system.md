# Design System Spec

**Status:** Draft
**Date:** 2026-05-15
**Scope:** Visual design system, UI/UX standards, and technology stack for the Bedrock Cost Dashboard

---

## Overview

Enterprise analytics dashboard for tracking AWS Bedrock usage and cost across an organization. Optimized for data density, readability, and dark mode.

## Technology Stack

| Layer | Technology | Version/Notes |
|-------|-----------|---------------|
| **Framework** | Next.js (App Router) | Latest stable, Server Components, Route Handlers |
| **Language** | TypeScript | Strict mode, 5.x |
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
| **Monitoring** | Sentry (@sentry/nextjs) | Error tracking, performance, tracing, session replay |
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
| **OpenTelemetry** | Not used (Sentry instead) | Sentry's Next.js SDK is more mature, easier to set up, and provides a dashboard out of the box. If OTel is needed later, Sentry can ingest OTel traces. |
| **DynamoDB DAX** | Not used | Data updates once per hour. Next.js server cache (1hr TTL) already reduces DynamoDB reads to ~1/hour per unique query. DAX adds cost with no benefit at this refresh rate. |
| **Redis / Valkey** | Not used | Same reasoning as DAX. Next.js built-in cache + TanStack Query client cache are sufficient for hourly-updating data. No extra infrastructure to manage. |
| **Vite** | Not used | Next.js has its own bundler (Turbopack in dev, Webpack in production). Adding Vite would conflict with Next.js's build pipeline. |
| **Docker** | Deferred to deployment phase | Not needed for local development — `pnpm dev` is simpler. Will add Dockerfile when deploying the Next.js app. DynamoDB Local does run in Docker (the one exception during development). |
| **Tremor** | Not used (Recharts instead) | Recharts gives finer control over chart internals and has a larger ecosystem. Tremor's component layer overlaps with shadcn/ui, which would create two competing component systems. |

## Authentication

- **Library:** Auth.js (NextAuth v5) — the provider abstraction. Switching identity providers is a config change in `apps/dashboard/auth.ts`; pages, middleware, and route guards use Auth.js session APIs and never change.
- **Identity provider:** Microsoft Entra ID. Recommended start: a free Entra tenant, developing against the real provider from day one.
- **Access model:** Open access — every authenticated member sees all data.
- **Session:** Auth.js encrypted JWT session cookie.
- **Middleware:** Auth.js middleware protects all `/dashboard/*` and `/api/*` routes.
- **Sign-in page:** Single "Sign in with Microsoft" action. No sign-up — identities are managed in Entra ID.
- **User menu:** Custom user menu in the top bar (avatar, name, sign out) backed by the Auth.js session.
- **Roles:** Not implemented in v1. Entra ID groups can be surfaced as token claims and mapped to app roles later (e.g. restrict Settings to admins) without a redesign.

## Data Access Boundary

DynamoDB and the AWS SDK are **server-only**. Client Components never access the database.

- Data-access functions live in `apps/dashboard/lib/data/` and import `server-only` — imported only by Route Handlers and Server Components. A client-side import is a build error.
- **Client Components** get data two ways: as props from a Server Component, or via TanStack Query calling a same-origin Route Handler over HTTP. They never import `apps/dashboard/lib/data/` or the AWS SDK.
- **Route Handlers** (`apps/dashboard/app/api/*`) are the only HTTP-reachable backend: validate input with Zod, check the Auth.js session, query DynamoDB, return the standardized `{ data }` / `{ error }` shape.
- AWS credentials and the AWS SDK never ship to the browser.

## Caching Strategy

Data updates once per hour (Lambda cycle), making caching highly effective:

| Layer | Tool | TTL | What it caches |
|---|---|---|---|
| **Server** | Next.js `unstable_cache` / fetch cache | 1 hour (matches Lambda cycle) | DynamoDB query results in Route Handlers |
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

## Style: Dark Mode (OLED)

Selected via UI UX Pro Max for enterprise SaaS analytics dashboards.

- **Mode support:** Dark primary, light secondary (future)
- **Performance:** Excellent
- **Accessibility:** WCAG AAA target
- **Key effects:** Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, high readability, visible focus states

## Color Palette

| Role | Hex | CSS Variable | Usage |
|------|-----|-------------|-------|
| Primary | `#1E40AF` | `--color-primary` | Navigation active states, primary buttons |
| On Primary | `#FFFFFF` | `--color-on-primary` | Text on primary color |
| Secondary | `#3B82F6` | `--color-secondary` | Links, secondary actions, chart accent |
| Accent/CTA | `#D97706` | `--color-accent` | Warnings, highlights, cost alerts |
| Background | `#0F172A` | `--color-background` | Page background (dark mode) |
| Foreground | `#F8FAFC` | `--color-foreground` | Primary text |
| Muted | `#334155` | `--color-muted` | Borders, secondary text backgrounds |
| Border | `#1E293B` | `--color-border` | Card borders, dividers |
| Destructive | `#DC2626` | `--color-destructive` | Error states, high cost alerts |
| Success | `#16A34A` | `--color-success` | Positive trends, low cost indicators |
| Ring | `#1E40AF` | `--color-ring` | Focus rings |

### Chart Colors (Per Model)

Each Bedrock model gets a consistent color across all charts:

| Model | Color | Hex |
|-------|-------|-----|
| Claude Opus | Deep purple | `#7C3AED` |
| Claude Sonnet | Blue | `#3B82F6` |
| Claude Haiku | Teal | `#14B8A6` |
| Other models | Amber | `#D97706` |

## Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Headings | Fira Code | 600-700 | Page titles, section headers, metric values |
| Body | Fira Sans | 300-500 | Paragraphs, labels, descriptions |
| Data/Numbers | Fira Code | 400-500 | Table cells, chart labels, token counts, costs |

**Google Fonts import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');
```

- **Type scale:** 12 / 14 / 16 / 18 / 24 / 32 / 48
- **Base:** 16px body
- **Line height:** 1.5 for body, 1.2 for headings
- **Number formatting:** Tabular/monospaced figures for data columns (Fira Code handles this natively)

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
+-----------------------------------------------------+
|  Top Bar: User Menu | Org Name | Sync Status         |
+----------+------------------------------------------+
|          |                                           |
| Sidebar  |  Content Area                             |
|          |  +--------------------------------------+ |
| Overview |  |  Page Header + Date Range Filter     | |
| Ranking  |  +--------------------------------------+ |
| Depts    |  |                                      | |
| Teams    |  |  Page Content                        | |
| Services |  |  (cards, charts, tables)             | |
| Users    |  +--------------------------------------+ |
| Settings |                                           |
|          |                                           |
+----------+------------------------------------------+
```

- Sidebar: collapsible, persistent on desktop, overlay on mobile
- Content area: max-width 1280px, centered
- Spacing: 4px/8px grid system

## Page Architecture

### Navigation (Sidebar)

| Item | Route | Description |
|------|-------|-------------|
| Overview | `/dashboard` | KPI cards, cost trend chart, top consumers |
| Ranking | `/dashboard/ranking` | Leaderboard with tabs + model filter |
| Departments | `/dashboard/departments` | Department cards grid |
| Department Detail | `/dashboard/departments/[id]` | Teams breakdown, cost over time |
| Teams | `/dashboard/teams` | Teams list, filterable by department |
| Team Detail | `/dashboard/teams/[id]` | Services + users breakdown |
| Services | `/dashboard/services` | All services across all accounts |
| Users | `/dashboard/users` | All users across all accounts |
| Settings | `/dashboard/settings` | Account registry, sync status, tag coverage |

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

- Account registry: add/edit/deactivate accounts, map to dept/team
- Sync status: last run time, success/error count, next scheduled run
- Tag coverage: per-team percentage of tagged vs untagged usage
- Data retention: TTL configuration display

## Responsive Tables

Data tables (`UsageTable`, `RankingList`) have up to 8 columns, which cannot fit a 375px viewport without horizontal scroll — an anti-pattern. Tables therefore adapt by breakpoint:

- **Desktop / tablet (≥ `md`, 768px+):** Full table — all columns, sortable headers.
- **Mobile (< `md`):** Each row collapses into a **card**. The entity name is the card title, Cost is shown prominently, and the remaining metrics render as label–value pairs. TanStack Table drives both renders from the same data, sorting, and pagination.

Sort and filter controls (`SearchInput`, `ModelFilter`, `ColumnToggle`, `Pagination`) remain available in both layouts. No horizontal scroll at any viewport.

## Date Filtering

Global date filter present in the page header of every dashboard page:

- **Presets:** 7 days, 30 days, 90 days, Custom range
- **Default:** Last 30 days
- **Component:** shadcn/ui `Calendar` + `Popover`
- **Date logic:** date-fns for arithmetic and formatting
- **Persistence:** nuqs stores selection in URL search params (shareable, bookmarkable)
- **Scope:** Applies to all charts and tables on the current page

## Component Inventory

### Layout & Navigation

| Component | Source | Purpose |
|-----------|--------|---------|
| `Sidebar` | shadcn/ui | Collapsible navigation with active state |
| `Breadcrumbs` | shadcn/ui | Navigation context on detail pages (Departments > Engineering > Payments) |
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
| `SyncStatusBadge` | Custom (shadcn Badge) | Last sync time + status indicator |
| `SyncCountdown` | Custom | "Next sync in 42 min" live countdown in top bar; uses `SyncStatus.nextScheduledAt` when present, otherwise `lastRunAt + 1h` |
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
- **Gridlines**: Low-contrast (gray-800 on dark bg) so they don't compete with data
- **Responsive charts**: Every chart wrapped in Recharts `ResponsiveContainer` + Tailwind container queries

### Animation

- **Duration**: 150-300ms for micro-interactions
- **Easing**: ease-out for entering, ease-in for exiting
- **Reduced motion**: Respect `prefers-reduced-motion`
- **Chart animation**: Entrance animations optional, data readable immediately

## Anti-Patterns to Avoid

- Light mode as default (dark mode primary for this product)
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
