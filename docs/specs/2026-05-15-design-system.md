# Design System Spec

**Status:** Draft
**Date:** 2026-05-15
**Scope:** Visual design system, UI/UX standards, and technology stack for the LLM Usage Lens

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
| **UI Components** | shadcn/ui | Copy-paste components on Radix UI primitives (the `radix-ui` umbrella package). The compact refresh adds Breadcrumb, Collapsible, Switch and Alert with no new npm dependency; Sonner, data grids, animation and layout libraries are not used (agent decision, 2026-11-16) |
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
| **Config File** | yaml | Parses `apps/dashboard/config/config.yaml` (YAML 1.2, safe options only), validated with Zod (`AppConfigSchema`); server-only (System Architecture — *Configuration file*; added 2026-11-17, unit CFG) |
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
| **Redis / Valkey** | Not used (re-evaluated 2026-11-17: gated) | Same reasoning as DAX. Next.js built-in cache + TanStack Query client cache are sufficient for hourly-updating data. No extra infrastructure to manage. Re-evaluated with the Phase 5 *Performance and caching* task: a shared cache only helps once the LiteLLM read cache exists and the two production tasks disagree after a write; it is built as unit PERF-5 only when a trigger in `docs/future-improvements.md` — *Shared cache (Valkey)* is met. |
| **Browser storage for query data** | Not used (decided 2026-11-17, user) | Persisting the TanStack Query cache to `localStorage` or `sessionStorage` would keep scoped cost data in the browser after sign-out, against the intent of `Cache-Control: private, no-store` (Access Control — *Enforcement* item 4, T14). The in-memory query cache covers in-app navigation. |
| **Vite** | Not used | Next.js has its own bundler (Turbopack in dev, Webpack in production). Adding Vite would conflict with Next.js's build pipeline. |
| **Docker** | Deferred to deployment phase | Not needed for local development — `pnpm dev` is simpler. Will add Dockerfile when deploying the Next.js app. DynamoDB Local does run in Docker (the one exception during development). |
| **Tremor** | Not used (Recharts instead) | Recharts gives finer control over chart internals and has a larger ecosystem. Tremor's component layer overlaps with shadcn/ui, which would create two competing component systems. |
| **Plain React SPA** | Not used (Next.js kept) | Replacing Next.js with a client-only React SPA (e.g. Vite) was evaluated. Rejected: the server-only data boundary (Rule 10) depends on Server Components and Route Handlers reading DynamoDB with the AWS SDK credential chain. A SPA pushes AWS access to the browser or forces a separate API Gateway + Lambda tier — extra infrastructure that duplicates what Next.js Route Handlers already provide. Auth.js session handling, the 1-hour server cache (matching the Lambda cycle), and per-section SSR/Suspense streaming are also lost in a SPA. Next.js stays. |

## Authentication

- **Library:** Auth.js (NextAuth v5) — the provider abstraction. Switching identity providers is a config change in `apps/dashboard/auth.ts` (plus its variables in `env.ts`); pages, proxy, and route guards use Auth.js session APIs and never change.
- **Identity provider:** Microsoft Entra ID in production. Recommended start: a free Entra tenant, developing against the real provider from day one; without a tenant, a dev-only local login is available outside production (System Architecture spec — *Authentication & Access*, decided 2026-10-29).
- **Access model:** role-based and scope-limited from Phase 4R ([Access Control spec](2026-11-10-access-control.md) — *Roles*, *Enforcement*); until then every authenticated member reads all data and account mutations require `Admin`.
- **Session:** Auth.js encrypted JWT session cookie; it ends 8 hours after sign-in regardless of activity (System Architecture — *Authentication & Access*).
- **Proxy:** Auth.js in the Next.js proxy (`proxy.ts`) protects all `/dashboard/*` and `/api/*` routes except `/api/health` (Platform spec).
- **Sign-in page:** One action per configured provider — "Sign in with Microsoft" when Entra ID is configured, a local dev sign-in only when the dev login is enabled outside production, and an email + password form (with a TOTP step when required) while password sign-in is on (Access Control — *Password users*, amended 2026-11-14). The master user has its own link. No sign-up — identities are managed in Entra ID or by an `internal-admin`. A setup page (`/account/setup`) sets a password user's password and enrols TOTP from a one-time link; signed-in password users change their password on the **Account page** (`/dashboard/account`, linked from the user menu; Access Control — *Password users*, D30).
- **User menu:** Custom user menu in the top bar backed by the Auth.js session: avatar, name, email, the caller's role label(s), the sign-in method and sign out. Role and sign-in method were added on 2026-11-11 (user direction).
  - **Role labels** come from one map in `lib/auth/roles.ts` (Rule 50.3), never from string literals in the component: `internal-admin` → "Admin", `internal-org-admin` → "Org admin", `internal-auditor` → "Auditor", `internal-viewer` → "Viewer". The menu shows the session's global roles in `GLOBAL_ROLES` order, comma-separated; a session role with no label is not shown. Scoped admin grants (`internal-team-admin`) are not shown: they are authorization data read per request, not session data (Access Control — *Enforcement*).
  - **Sign-in method labels** come from the same module: `entra` → "Microsoft Entra ID", `master` → "Master user (break-glass)", `local` → "Local login (dev)". A session without a valid `authMethod` shows no sign-in method line.
- **Roles:** global `internal-admin`, `internal-org-admin`, `internal-auditor`, `internal-viewer` and scoped `internal-team-admin` ([Access Control spec](2026-11-10-access-control.md) — *Roles*; replaces the single `Admin` role from Phase 4R). The UI hides what the caller cannot use; the server enforces it regardless of the UI.

## Data Access Boundary

DynamoDB and the AWS SDK are **server-only**. Client Components never access the database.

- Data-access functions live in `apps/dashboard/lib/data/` and import `server-only` — imported only by Route Handlers and Server Components. A client-side import is a build error.
- **Client Components** get data two ways: as props from a Server Component, or via TanStack Query calling a same-origin Route Handler over HTTP. They never import `apps/dashboard/lib/data/` or the AWS SDK.
- **Route Handlers** (`apps/dashboard/app/api/*`) are the only HTTP-reachable backend: check the Auth.js session and the caller's permission through the policy module (Access Control spec — *Enforcement*), validate input with Zod, query DynamoDB, return the standardized `{ data }` / `{ error }` shape.
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

**Additions (Phase 5 *Performance and caching*, user direction 2026-11-17; each row applies from the unit that builds it).**

| Layer | Tool | TTL | What it holds | Unit |
|---|---|---|---|---|
| **Server, one request** | Request memo (`lib/api/request-memo.ts`, `AsyncLocalStorage` opened by `withRoute` for `GET`) | The request | Repeated reads inside one request: the LiteLLM connection item, operation toggles, team links, role grants, the identity link, the caller's scope. Never shared between requests, so authorization data is still read per request (Access Control — *Enforcement* item 4) | PERF-1 |
| **Server** | `unstable_cache`, key includes the last sync run | 1 hour | Rollups per UTC day. A new sync changes the key, so new data shows on the next request on every task; with no new sync nothing is re-read | PERF-R |
| **Server, per task** | LiteLLM read cache (`lib/litellm/read-cache.ts`, in-process TTL + LRU) | 60 seconds; 5 minutes for the model list and email matches | Raw, scope-independent LiteLLM responses for the operations the LiteLLM spec — *Caching* lists; scope filtering, toggles and audit run after the read. Capped at 500 entries and 32 MB of response bodies; a body over 1 MB is not cached; the least recently used entry goes first. Reason: the Fargate task's memory is fixed and shared with Next.js's own cache (Platform — *Runtime*), so the cache must not grow with the number of teams, users or date ranges requested (agent decision, 2026-11-17; the numbers are checked against PERF-0's baseline when PERF-3 is built) | PERF-3 |
| **Client** | TanStack Query `gcTime` | 30 minutes | A page revisited within that time paints from memory while it revalidates. Reason: 30 minutes covers moving between pages in one working session and is shorter than the hourly sync; a painted entry is still revalidated by its `staleTime` and by the sync invalidation | PERF-2 |
| **Client** | TanStack Query `staleTime` | 10 minutes for rollup-derived queries; 60 seconds for LiteLLM queries | Rollup queries are also invalidated when the sync status reports a new run. Reason: rollups change only on a sync, so 10 minutes (the top of the existing 5-10 minute range) costs no freshness once the sync invalidates them; LiteLLM data changes on any write by any user, so 60 seconds matches the server read cache | PERF-2 |

- **Query keys** come from one factory (`lib/query/keys.ts`) with a `queryOptions` object per resource; hooks, prefetch and invalidation share it, so an invalidation cannot miss a query through a mistyped key (PERF-2).
- **Date-range changes keep the previous data on screen** (`placeholderData: keepPreviousData`) with the "updating" state the Ranking page shows, so a range change does not blank the page to skeletons (PERF-2).
- **Prefetch on intent:** a sidebar link prefetches its page's primary query on hover and focus, so the request starts before the click; it prefetches one query per link, not the whole page (PERF-2).
- **Refresh:** the top bar's `RefreshButton` (*Component Inventory*) invalidates every query and sends `Cache-Control: no-cache` on that round of requests. The server honours it in two places only: `GET /api/sync-status` skips its 5-minute cache, and the LiteLLM read cache is bypassed and its entries replaced. **Minimum refresh interval (agent decision, 2026-11-17):** the server honours a bypass for one key at most once per 10 seconds per task; a `no-cache` request inside that time gets the entry that was just refreshed. Reason: the header is set by the client, so the button's own throttle is not a control, and without a server-side limit any signed-in user could turn each request into an upstream LiteLLM call (the same denial-of-service reasoning as `revalidateTag` below). Residual, accepted: the refetch after a write can show a value up to 10 seconds old when it lands on the other task; the UI has already shown the write response. It never calls `revalidateTag`: any signed-in user could otherwise force a re-read of up to 90 days of rollups (cost, and a denial-of-service lever) (PERF-R).
- **Server prefetch** is piloted on the Overview only: the page reads through `lib/` (never `/api/*`), fills a per-request `QueryClient` and streams the pending query through `HydrationBoundary`. Other pages follow only if the measured gain is clear (PERF-4).
- **Never cached, on any layer above the request:** authorization data (Rule 60.10), LiteLLM key metadata, users, spend logs and the audit log, any error, and any read made by a write path. **One exception:** the account list (`getAllAccountsCached`, the 1-hour server row above) is read from its cache on read and write paths alike, as the Phase 4R write routes already do through `lib/api/org-lookup.ts`. The account registry is organisational structure, not authorization data; its accepted residual risk is recorded in Data Model — *Access Patterns*.

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

The diagram shows the loading pattern, not the exact arrangement. The Overview
arrangement (five KPI cards, then the 8 + 4 panel rows) is in *Layout —
Structure*.

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
- **Key effects:** Neutral surfaces separated by 1px borders (no shadows on cards or tables; a soft shadow only on overlays), one accent colour reserved for the primary action, active states and status, high readability, visible focus states (agent decision, 2026-11-16: compact workspace — an internal tool reads as a tool when chrome recedes; user direction 2026-11-15)

## Color Palette

| Role | Hex | CSS Variable | Usage |
|------|-----|-------------|-------|
| Primary | `#4F46E5` | `--color-primary` | Navigation active states, primary buttons |
| On Primary | `#FFFFFF` | `--color-on-primary` | Text on primary color |
| Secondary | `#F1F5F9` | `--color-secondary` | Neutral secondary buttons and `secondary` badge, foreground text `#0F172A` (16.30:1) (agent decision, 2026-11-16: a second saturated indigo competed with the primary) |
| Link | `#4338CA` | `--color-link` | Text links (the former secondary role): 7.90:1 on `#FFFFFF`, ≥7.4:1 on `#F8FAFC` (agent decision, 2026-11-16) |
| Accent/CTA | `#D97706` | `--color-accent` | Warnings, highlights, cost alerts |
| Background | `#F8FAFC` | `--color-background` | Page background (neutral canvas) (agent decision, 2026-11-16: the indigo-tinted canvas read as a template) |
| Foreground | `#0F172A` | `--color-foreground` | Primary text |
| Muted foreground | `#566880` | `--color-muted-foreground` | Placeholders, muted text |
| Muted | `#F1F5F9` | `--color-muted` | Muted surfaces (subtle fills, tracks, hover) — distinct from Border (agent decision, 2026-11-16: muted equal to border made fills look like rules) |
| Border | `#E2E8F0` | `--color-border` | Card borders, dividers |
| Destructive | `#BE123C` | `--color-destructive` | Error states, high cost alerts, `destructive` badge and button (white text): 6.29:1 on `#FFFFFF`, 6.01:1 on `#F8FAFC` (changed 2026-11-15, below; canvas ratio recomputed 2026-11-16 for the neutral canvas) |
| Success | `#059669` | `--color-success` | Positive trends, low cost indicators |
| Input | `#8391A7` | `--color-input` | Boundary of inputs, selects and switch tracks: 3.19:1 on `#FFFFFF` (WCAG 1.4.11) (agent decision, 2026-11-16) |
| Success text | `#047857` | `--color-success-text` | Success as text (5.48:1 on `#FFFFFF`); `--color-success` stays for icons (3.77:1 ≥ 3:1) (agent decision, 2026-11-16) |
| Primary subtle | `#EEF2FF` | `--color-primary-subtle` | Range band, selected-row tint (agent decision, 2026-11-16) |
| Ring | `rgba(79,70,229,0.35)` | `--color-ring` | Input focus glow (decorative; not the keyboard focus indicator) |
| Focus ring | `#4F46E5` | `--color-focus-ring` | Keyboard focus indicator: 6.29:1 on `#FFFFFF`, 6.01:1 on `#F8FAFC`, 5.74:1 on `#F1F5F9`. Landed with the compact refresh (agent decision, 2026-11-16: brought forward from Phase 5; `globals-contrast.test.ts` enforces it) |

**Muted foreground (changed 2026-10-29).** Raised from `#94A3B8` (2.0–2.6:1) to `#566880` so muted text meets WCAG AA 4.5:1 on card, background, muted, accent and sidebar surfaces (lowest: 4.62:1 on Muted `#E2E8F0`). `apps/dashboard/app/globals-contrast.test.ts` enforces it. The vendored `docs/design-system/` previews still show the old value; this table wins.

**Destructive and secondary (changed 2026-11-15; orchestrator, user delegated; WCAG 2.2 SC 1.4.3).** `--color-destructive` `#E11D48` (4.70:1 on `#FFFFFF`, 4.39:1 on `#F5F7FF`) and `--color-secondary` `#6366F1` (4.47:1 on `#FFFFFF`, 4.18:1 on `#F5F7FF`) failed AA 4.5:1 as text on the canvas and, for the secondary badge, as a fill behind white text. They become rose-700 `#BE123C` (6.29:1 on `#FFFFFF`, 5.88:1 on `#F5F7FF`, 5.10:1 on Muted `#E2E8F0`) and indigo-700 `#4338CA` (7.90:1 on `#FFFFFF`, 7.39:1 on `#F5F7FF`), which stays distinct from `--color-primary` `#4F46E5`. Their `-foreground` tokens stay `#FFFFFF`. `apps/dashboard/app/globals-contrast.test.ts` enforces 4.5:1 for both tokens against `#FFFFFF` and `--color-background`.

**Known divergence (pre-existing, Phase 1).** The table lists Accent/CTA `#D97706` as `--color-accent`, but `apps/dashboard/app/globals.css` defines `#D97706` as `--color-warning` and sets `--color-accent` to `#EEF2FF` (shadcn's neutral interactive surface). This spec does not resolve it; a follow-up decision should ratify one mapping and update either this table or the code.

**Compact refresh (agent decision, 2026-11-16).** `--color-accent` becomes the neutral `#F1F5F9` (shadcn's hover/focus surface), `--color-sidebar-accent` `#F1F5F9`, and `--color-sidebar-ring` the opaque `#4F46E5`. Muted foreground `#566880` still meets 4.5:1 on every surface (lowest 5.20:1 on Muted `#F1F5F9`). The `--color-avatar-*` family stays defined but tables render neutral avatars (*Avatar Colors*).

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

### Avatar Colors (Per User)

From the compact refresh, avatars in tables are neutral (20px, `--color-muted` fill, foreground initials) because the colour carried no information (agent decision, 2026-11-16). The palette below is kept for non-table uses until a later clean-up. `UserAvatar` (Team Detail users table, Phase 4.6; reused on Users, Phase 4.8) previously filled each initials avatar from a dedicated palette, `--color-avatar-1` … `--color-avatar-8`, chosen by a stable hash of the user id so the same user always gets the same colour (adopted 2026-11-06). The initials are white; every fill meets 4.5:1 against white. Avatars are decorative (`aria-hidden`): the user id is always shown as text beside them, so colour never identifies a user. `apps/dashboard/app/globals-contrast.test.ts` enforces the 4.5:1 contrast and the distinctness from the other families. This family is distinct from the model, team and non-model tokens and never stands in for them (Rule 40.2).

| Token | Hex |
|-------|-----|
| `--color-avatar-1` | `#B91C1C` |
| `--color-avatar-2` | `#1D4ED8` |
| `--color-avatar-3` | `#047857` |
| `--color-avatar-4` | `#6D28D9` |
| `--color-avatar-5` | `#B45309` |
| `--color-avatar-6` | `#0F766E` |
| `--color-avatar-7` | `#4338CA` |
| `--color-avatar-8` | `#9F1239` |

## Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Headings | Space Grotesk | 600-700 | Page titles, section headers, card titles |
| Body | Space Grotesk | 300-500 | Paragraphs, labels, descriptions |
| Data/Numbers | JetBrains Mono | 400-600 | Table cells, chart labels, token counts, costs, KPI values |

**Self-hosted fonts (decided 2026-11-06):** both families ship as npm packages (`@fontsource-variable/space-grotesk`, `@fontsource-variable/jetbrains-mono`, SIL Open Font License) and load through `next/font/local` in `apps/dashboard/app/layout.tsx`, exposed as the existing `--font-space-grotesk` / `--font-jetbrains-mono` CSS variables. Load the `latin` `wght`-axis woff2 file of each package (the variable weight axis covers the weights above), with `display: "swap"`, matching the previous `next/font/google` subset. The build makes no network request for fonts; a build-time Google Fonts fetch made CI's `build` job fail intermittently.

- **Compact scale (agent decision, 2026-11-16: user direction 2026-11-15, "more compact, professional"; reference band of internal admin products):**

  | Role | Size / line height | Token or utility |
  |---|---|---|
  | Dashboard body, sidebar, controls | 14 / 20 | `text-sm` on the dashboard content root |
  | Table cells, key–value values | 13 / 20 | `--text-cell` |
  | Secondary, helper, labels, table headers, nav group labels | 12 / 16 | `text-xs` |
  | Card title | 14 / 20 semibold | `text-sm` |
  | Section title (`h2` in a Panel) | 16 / 24 semibold | `text-base` |
  | Top-bar page title (`h1`) | 16 / 24 semibold | `text-base` |
  | Entity title (`h2` in `PageHeader`) | 20 / 28 semibold | `text-xl` |
  | KPI value | 20 / 28 semibold, JetBrains Mono, tabular | `--text-kpi` |
  | Inputs | 16 below `md` (no iOS zoom), 14 from `md` | `text-base md:text-sm` |
- **Base:** the root stays 16px (rem and touch sizes are stable); the public pages (`/`, sign-in, no-access, account setup) keep a 16px body.
- **Line height:** as in the table; 1.2–1.4 for headings.
- One heading style per level: the `Panel` component owns section titles; no page sets its own heading size.
- **Number formatting:** Tabular/monospaced figures for data columns (JetBrains Mono handles this natively)

## Layout

### Breakpoints

| Name | Width | Layout |
|------|-------|--------|
| Mobile | 375px | Single column, collapsible sidebar |
| Tablet | 768px | Single-column sections, KPI cards two across, sidebar overlay |
| Desktop | 1024px | Full sidebar + fluid content; 12-column panel grid (Overview) |
| Wide | 1440px | Full sidebar + fluid content with 32px gutters; Overview KPI cards five across |

### Structure

```
+----------------+--------------------------------------------------------+
| Brand          | Top bar: h1 page title · sync | 7D 30D 90D · ⌘K · next sync · user
+----------------+--------------------------------------------------------+
| USAGE          | PageHeader: breadcrumb (detail) · entity title · actions |
|  Overview      |             one-line description                         |
|  Ranking       |             tabs (peer views)                            |
|  Cost by dept. | Toolbar: search · filters · ⟶ columns · export           |
|  Cost by team  | Panels (cards, charts, tables)                           |
|  Cost by serv. |                                                          |
|  Cost by user  |                                                          |
|  My usage      |                                                          |
| MANAGEMENT     |                                                          |
|  Team          |                                                          |
|  Organisation  |                                                          |
|  Users         |                                                          |
|  Audit         |                                                          |
| ADMINISTRATION |                                                          |
|  Settings      |                                                          |
|            [⇤] |                                                          |
+----------------+--------------------------------------------------------+
```
(agent decision, 2026-11-16: compact workspace; groups and items amended the same day by the mock-up review, decided 2026-11-16, user — *Navigation (Sidebar)*. The diagram shows an `internal-admin`; other roles see fewer items.)

- Brand (logo + product + org name) sits at the top of the sidebar, not in a
  full-width header; it collapses to the mark when the rail collapses. The
  product name shown is **LLM Usage Lens**.
- Top bar lives **inside** the content area, to the right of the sidebar. The
  active page title and its sync-status badge read as one unit on the left; the
  global `DateRangePicker`, command menu, sync countdown, and user menu sit on
  the right. The date filter lives here — not in a content-area band — so it
  reads as a single global control across every page (the earlier "Page Header +
  Date Range Filter" content band was dropped in favour of the top-bar toggle).
- Top bar responsiveness (decided 2026-10-29; amended 2026-11-16): below `md` (768) it wraps to exactly two rows — trigger, page title, sync icon, search icon and user menu, then the date range; from `md` up it is one row whose bottom border aligns with the sidebar header. The sync-status badge and sync countdown show icon-only below `lg` (1024) and icon + text from `lg`; the command-menu trigger is icon-only below 1440 and shows its "Search…" label and ⌘K hint from 1440 (agent decision, 2026-11-16: a third header row cost 15% of a phone viewport). Compact forms keep their full meaning in `aria-label` and
  `title` (the search trigger also carries `aria-keyshortcuts`); nothing in the
  top bar is hidden from `md` up. Thresholds from `md` up use only the
  breakpoints below (Rule 40.6); below `md`, where the bar may wrap, the
  countdown is hidden under Tailwind's `sm` (640).
- Sync badges by role (decided 2026-11-16, user): `SyncStatusBadge` and
  `SyncCountdown` render only for callers who see the **Usage** group (they
  describe the organisation-level cost pipeline); for a team lead and a user
  they are absent. The `DateRangePicker` stays for every role, including on
  *My usage* and *Team*, because spend is per period.
- Page title is the descriptive heading (e.g. "Cost overview"), not the short
  sidebar label ("Overview").
- Sidebar: 224px (`14rem`), collapsible to a 48px icon rail, persistent on desktop, overlay sheet on mobile; nav is grouped **Usage**, **Management**, **Administration** (Settings lives in Administration, last, at the bottom of the side panel; amended 2026-11-16, user: **Management** replaces **Gateway** — *Navigation (Sidebar)*); the footer holds only the collapse icon button (accessible name "Collapse" / "Expand"). Items are 32px with 16px icons; the active item is a neutral fill with a 2px `--color-sidebar-primary` indicator and `aria-current="page"`. A group renders only when it has an item for the caller and an item renders only when its route serves the caller ("hidden, never dead"); the filter runs on the server per request (Rule 60.10) and the sidebar, `PageTitle` and `CommandMenu` share it (agent decision, 2026-11-16: groups by audience — look vs manage). The filter only mirrors the server's authorization: every hidden item's route returns the same `404` as a missing page from the policy module (Rule 10.3; Access Control — *Navigation and landing by role*); hiding a link is never the control.
- Content area: **fluid** (decided 2026-11-11, user direction; replaces the
  earlier 1280px centred column). It fills the inset beside the sidebar at
  every breakpoint, with no page-level max-width: the content container is as
  wide as the inset. Gutters (the container's padding) are 16px below `md`,
  24px from `md` and 32px from 1440. 1440 is a project breakpoint, not
  Tailwind's `2xl`; write it in rem (`min-[90rem]:`), never as
  `min-[1440px]:` — Tailwind orders a px variant before the rem-based `md`
  and `lg` rules, so those override it.
- Readable measure: the content limits line length, not the page.
  `EmptyState` description text, the Settings forms and standalone paragraphs
  keep `max-w-[72ch]`; dialogs keep their shadcn width; cards, charts and
  tables take the full width of their grid cell.
- Panel grid (data-dense dashboard): from `lg` (1024) the Overview sections
  sit on a 12-column grid with a 16px gap; below `lg` they stack in one
  column. Cost trend spans 8 columns and model distribution 4; top
  departments spans 8 and sync status 4. Other pages keep their current
  section layout inside the fluid content area until a later amendment names
  them.
- KPI rows: the Overview KPI row (five cards) shows one across at 375, two from `md`, three from `lg` and five from 1440. Any other KPI row shows one across below `md`, then all its cards in one row. A KPI card shows a 12px label, one 20px value with its delta inline, and at most two 12px footnote lines; cards align to the top, not to the tallest card. Rows are count-agnostic so a later unit can add or hide a card (agent decision, 2026-11-16: the stretched first card made four cards 70% empty).
- Panels and density (amended 2026-11-16): every section, tables included, sits in a `Panel` — card background, 1px `--color-border` border, `--radius-card` (8px), **no shadow**, 16px padding, a title row (section `h2`, optional one-line description, actions right). A table inside a Panel renders flush (no second border). KPI cards use 12px vertical and 16px horizontal padding. Controls are 32px (`--spacing-control`) on pointer-fine screens; table header rows 32px, body rows 36px (40px with an avatar or action buttons); spacing on a 4px grid, 24px between Panels in a column, 16px in the Overview grid. Overlays (popover, menu, dialog, sheet) are the only surfaces with a shadow (`--shadow-overlay`). Radius: 8px surfaces, 6px controls, full only for status pills, avatars and switches (agent decision, 2026-11-16: compact, restrained scale requested by the user).
- Page frame (agent decision, 2026-11-16): the top bar carries only global controls and the page `h1`. Every dashboard page starts with a `PageHeader`: breadcrumb on detail pages (first crumb links to the list with the date range carried), the entity title as `h2` on detail pages, a one-line description (13px muted, ≤72ch), page actions on the right (at most one filled primary button per view; others outline or ghost, 32px), an optional tabs strip and the page toolbar. On a page whose content the caller's scope narrows, a `ScopeLine` sits under the description and states the scope ("Showing teams you lead: Platform, Checkout"), so a filtered page never looks empty or complete by accident (decided 2026-11-16, user); it lists the in-scope names only and is omitted for callers who see everything. Toolbars are one row: search, filters, then view controls (Columns) and Export on the right.
- Tabs vs secondary navigation (agent decision, 2026-11-16; amended 2026-11-16, user): tabs only for 2–6 peer views of one object, with the active tab in the URL; a tab a caller cannot use is not rendered. Two kinds share the one `Tabs` component (`components/ui/tabs.tsx`, never a second one): **view tabs** switch a view inside one route with nuqs state (Ranking dimensions; the Team page's *Members*, *Budgets*, *Keys*), and **route tabs** are links, one route per tab, with `aria-current="page"` on the active one (the Settings tabs and the second tab row inside Settings → Access and Settings → LiteLLM, *Settings Page*). Both use the *Control Patterns* tab style; a second row is the same strip at 32px under the first. The LiteLLM page's tab row is gone: its views are the **Management** sidebar items, each its own route (*Navigation (Sidebar)*). The earlier vertical Settings secondary navigation is superseded by the Settings route tabs.
- Chart height does not grow with width: a chart panel keeps a fixed height
  (240–360px), so a wide screen adds data width, not empty height.
- Spacing: 4px/8px grid system

## Page Architecture

### Navigation (Sidebar)

Nav is grouped: **Usage** (Overview, the per-dimension breakdowns and, last, My usage), **Management** (team, organisation, user and audit views) and **Administration** (Settings) (agent decision, 2026-11-16: replaces Main / Attribution and the footer Settings entry; groups by audience; amended 2026-11-16, user, from the mock-up review: **Management** replaces **Gateway** and the single LiteLLM item, and the LiteLLM page's tabs become Management items, each its own route; amended 2026-11-17, user, from the B1 screenshot review: **My usage sits in the Usage group, last**, not in Management — it is a usage view. It is the one Usage item every signed-in caller sees, so for a lead or a user the Usage group holds only My usage; the organisation-level Usage items stay global-reader only). Each item carries a short rail label and a descriptive page title shown in the top bar. Which roles see each item is in Access Control — *Navigation and landing by role*; an item the caller may not see is absent, never disabled, and its route returns the same `404` as a missing page (Rule 10.3).

**Unique labels (agent decision, 2026-11-16: "Teams" and "Users" appeared twice in one sidebar; parallel "Cost by …" labels for every breakdown in a group is the common pattern and keeps each label unique).** The four Usage breakdown items read "Cost by department", "Cost by team", "Cost by service", "Cost by user"; their page titles (`h1`) follow. Routes, nuqs names and query keys are unchanged.

| Group | Item (rail label) | Page title | Route | Description |
|-------|-------------------|------------|-------|-------------|
| Usage | Overview | Cost overview | `/dashboard` | KPI cards, cost trend chart, top consumers |
| Usage | Ranking | Cost ranking | `/dashboard/ranking` | Leaderboard with tabs + model filter |
| Usage | Cost by department | Cost by department | `/dashboard/departments` | Departments table (cost, change, tokens, teams, top model) linking to detail (agent decision, 2026-11-16: consistent with the other breakdowns; the three-card grid left most of the canvas empty) |
| — | Department Detail | Cost by department | `/dashboard/departments/[id]` | Teams breakdown, cost over time (drill-down, no rail item); `PageHeader` breadcrumb "Departments / <name>" (agent decision, 2026-11-16) |
| Usage | Cost by team | Cost by team | `/dashboard/teams` | Teams list, filterable by department |
| — | Team Detail | Cost by team | `/dashboard/teams/[id]` | Services + users breakdown (drill-down, no rail item); `PageHeader` breadcrumb "Teams / <name>" (agent decision, 2026-11-16) |
| Usage | Cost by service | Cost by service | `/dashboard/services` | All services across all accounts |
| Usage | Cost by user | Cost by user | `/dashboard/users` | All users across all accounts |
| Usage | My usage | My usage | `/dashboard/me` | The caller's own usage (*Management pages*); every signed-in role; last in the group (2026-11-17, user: moved from Management) |
| Management | Team | Team usage & management | `/dashboard/manage/team` | One page for a team's usage and its management (*Management pages*) |
| Management | Organisation | Organisation usage | `/dashboard/manage/organisation` | Totals across linked teams and a per-team table (LiteLLM spec — *Views by role*) |
| Management | Users | User lookup | `/dashboard/manage/users` | Search a user and see their spend (LiteLLM spec — *Views by role*) |
| Management | Audit | Audit log | `/dashboard/manage/audit` | One audit page with a source filter, App · Gateway (*Management pages*) |
| Administration | Settings | Settings | `/dashboard/settings` | Admin area with route tabs: AWS accounts, Sync and data, LiteLLM, Access (*Settings Page*) |

| — | Account | Account | `/dashboard/account` | The caller's sign-in method; for password users, the own password change form (from the user menu, no rail item; added 2026-11-15, Access Control D30) |

**Routes and redirects (agent decision, 2026-11-16: `/dashboard/me` is the route 4R.5 already names; the other Management items share one `/dashboard/manage/` prefix so they never collide with the Usage routes `/dashboard/teams` and `/dashboard/users`, and the prefix names the group rather than LiteLLM because the Team and Audit pages compose app and gateway data).** Every existing URL keeps working through a redirect (`redirect()` in the page, presentation only): `/dashboard/litellm` → the caller's landing page; `/dashboard/litellm?tab=my-usage|team|organisation|users|audit` → the matching Management route (other query parameters carried); the Settings audit entry (`/dashboard/settings?section=audit` and `/dashboard/settings/audit`) → `/dashboard/manage/audit`. A redirect target the caller may not see returns the same `404` as a missing page. The earlier note that no `/dashboard/audit` route exists is superseded; there is still no `/dashboard/audit`.

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
PageHeader tabs: [Departments] [Teams] [Services] [Users]      (nuqs `tab`)
Toolbar:         [Search by name] [Model: All models v]  ⟶  [Columns] [Export CSV]
```
Date stays in the top bar. Numeric columns are right-aligned in JetBrains Mono with tabular figures (agent decision, 2026-11-16: one toolbar row instead of three; numbers compare down a column).

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

- `PageHeader`: breadcrumb, department name (`h2`), the "Bedrock service charges only" scope note; KPI row with total cost, tokens and invocations, and the previous-period comparison as a compact strip in the same row (agent decision, 2026-11-16: the separate comparison block repeated the KPIs)
- Teams breakdown table (sortable)
- Cost over time: stacked area by team
- Top users in this department: ranked list

A per-department model usage chart is not part of v1; the sections match Phase 4.4 (decided 2026-11-06).

Sections are Panels in one scroll (no tabs; agent decision, 2026-11-16: short pages).

### Team Detail Page

- `PageHeader`: breadcrumb, team name (`h2`), and one meta line with the department, the team's account IDs and the scope note (agent decision, 2026-11-16) — one `AccountIdBadge` per entry of `accounts[]` — normally one, since each team owns exactly one account (System Architecture — *Organizational Hierarchy*); more appear only when the range spans an account remapping), total cost, tokens, and the "Bedrock service charges only" scope note
- Services breakdown table
- Users breakdown table
- Model usage breakdown: bar chart

A per-team cost-over-time chart is not part of v1; the sections match Phase 4.6 (decided 2026-11-06).

Sections are Panels in one scroll (no tabs; agent decision, 2026-11-16: short pages).

### Services Page

- Services table (`UsageTable`: Service Name, Team, Department, Cost, Tokens, Invocations, % of Total), one row per team and service (Data Model — `ServicesResponseSchema`), with the "model usage only" note. The sections match Phase 4.7 (decided 2026-11-06). The "model usage only" note is a one-line `role=note` under the page description; the toolbar has Search, Columns and Export CSV like Ranking (agent decision, 2026-11-16: consistent list toolbar).

### Users Page

- Users table (`UsageTable`: User (`UserAvatar` + user id), Team, Department, Cost, Tokens, Invocations, % of Total), one row per team and user (Data Model — `UsersResponseSchema`), with the "model usage only" note. The sections match Phase 4.8 (decided 2026-11-06). The "model usage only" note is a one-line `role=note` under the page description; the toolbar has Search, Columns and Export CSV like Ranking (agent decision, 2026-11-16: consistent list toolbar). Users renders neutral 20px avatars (*Avatar Colors*).

### Settings Page

*Split into tabbed route pages 2026-11-16 (user: "the Settings screenshot is too large; break it down into pages or tabs at the top"; unit D, implementation-phases — *Settings admin area*). The page was one scroll about 12,100 px tall at 1440 wide.*

- **Tabs are routes** (agent decision, 2026-11-16, reason: a route per tab gives deep links, a working Back button and server-side authorization, and renders one group at a time). A tab row sits at the top of every Settings page, built on the existing shadcn `Tabs` (`components/ui/tabs.tsx`; no second Tabs component) with the active tab taken from the route and each trigger a link. The row scrolls horizontally on 375 and never scrolls the page.

  | Tab | Route | Contents | Visible to |
  |---|---|---|---|
  | AWS accounts | `/dashboard/settings/accounts` | Account registry (add/edit/deactivate; `Admin` role; read-only for other members) | everyone with Settings |
  | Sync and data | `/dashboard/settings/sync` | Sync status, Data retention (tag coverage joins here with Phase 4.9b) | everyone with Settings |
  | LiteLLM | `/dashboard/settings/litellm/<section>` | the LiteLLM sections under the sub-tabs below (unit A2, 2026-11-17; formerly the panel's in-page tabs) ([LiteLLM spec](2026-11-10-litellm.md) — LD24; the panel's edit flags are LiteLLM unit L3d2) | `internal-admin`, `internal-org-admin`, `internal-auditor` |
  | Access | `/dashboard/settings/access/<group>` | the access sections under the sub-tabs below | per `accessCapabilities(viewer)`: at least one sub-tab is visible |
  | Audit | `/dashboard/settings/audit` | Audit log, Access review | `internal-admin`, `internal-auditor` |

- **Index and unusable tabs.** `/dashboard/settings` redirects on the server to the caller's first visible tab (the order above; AWS accounts is visible to everyone, so today every caller lands there). A tab the caller cannot use is not rendered in the row, and its URL returns the same `404` page as a missing one — each tab page authorizes itself on every request (a layout alone is not re-run on soft navigation); roles, grants and scopes are never cached (Rule 60.10). The write routes still enforce the permission matrix (Rule 10.3).
- **LiteLLM sub-tabs** (unit A2, 2026-11-17; a second route-tab row under the LiteLLM tab, the same strip as Access): **Connection**, **Guardrails**, **Team links**, **Users** and **Gateway** (LiteLLM unit L6, 2026-11-17: the gateway principals and account ids; Admin edits, Auditor and org-admin read only, LD24; LiteLLM spec — *Combined usage and My usage (L6)*) at `/dashboard/settings/litellm/{connection,guardrails,team-links,users,gateway}`, links with `aria-current="page"` on the active one, so the sub-tab is in the URL and Back steps across sub-tabs. `/dashboard/settings/litellm` redirects on the server to the caller's first visible sub-tab; an unknown or unusable sub-tab is the same `404` as a missing page; an old `/dashboard/settings/litellm#<section>` link lands on its route. *Agent decisions (2026-11-17, unit A2):* (1) visibility follows `litellmPanelCapabilities(viewer.roles)`: the three roles that see the LiteLLM tab see all five sub-tabs, read-only where their edit flag is off (LD24: Connection and Gateway edit Admin only; Guardrails and Team links Admin and org-admin; Auditor read-only) — reason: every one of them can read every section today, and hiding a read-only section would remove information LD24 grants (*amended 2026-11-17, LiteLLM L6: Gateway added, read-only for org-admin and Auditor*); (2) one dynamic `[section]` route rather than five pages — reason: one authorization path, as `access/[group]`; (3) Team links and Users explain their empty state when no LiteLLM team is linked (gap G7 of the L3b acceptance review), naming who can link a team. *Gap G3 (tab in the URL, Back steps tabs; L3b acceptance review):* closed for Settings by these route sub-tabs; **obsolete for the LiteLLM page**, whose tab row Slice B2 removed — its views are Management sidebar items, each its own route (*Navigation (Sidebar)*).
- **Access sub-tabs** (a second tab row under the Access tab; a section a caller cannot use is not rendered, and a sub-tab with no visible section is not rendered):

  | Sub-tab | Segment | Sections (anchor slug) |
  |---|---|---|
  | People | `people` | Members (`members`), Team admins (`team-admins`), Pending and stale access (`pending-access`) |
  | Visibility | `visibility` | Visibility (`visibility`) |
  | Roles and mapping | `roles` | Group mappings (`group-mappings`), Role grants (`role-grants`) |
  | Identities | `identities` | Identity links (`identity-links`), Identity mapping (`identity-mapping`) |
  | Sign-in | `sign-in` | Password users (`password-users`), Per-user approval (`per-user-approval`) |

  **Addressing (agent decision, 2026-11-16, reason: the same as for the first row, and a `?tab=` param would let the client choose what the server must authorize; Rule 40.5 reserves nuqs for state a page owns, not for navigation between authorized pages):** the sub-tab is a route segment, `/dashboard/settings/access/<segment>`. `/dashboard/settings/access` redirects to the first visible sub-tab; an unknown or unusable segment is the same `404`. Audit log and Access review stay on the Audit tab; they are not Access sub-tabs.
- **Hash compatibility.** Any old `/dashboard/settings#<section-slug>` link (the twelve slugs in the tables above and the Audit tab) keeps working. A small client resolver mounted in the Settings layout maps the slug to its route and replaces the URL with `<route>#<slug>` (for example `#role-grants` to `/dashboard/settings/access/roles#role-grants`, `#audit-log` to `/dashboard/settings/audit#audit-log`), so the anchor still scrolls. The browser keeps the fragment across the server redirect of the index. A slug whose tab the caller cannot use is ignored (the caller stays on the page the redirect chose). The Access Control step-up (*Recent authentication*) does not go through the resolver: its fixed two-value allowlist is the final tab URLs `/dashboard/settings/access/roles#role-grants` and `/dashboard/settings/access/sign-in#password-users`, so it lands on the tab directly, with the fragment best-effort (D33a); the actions still take a section key, never a URL.
- **Size target.** No tab taller than about two screens at 1440×900. Shorter is fine; split a tab further only if it exceeds that. No tab scrolls horizontally at 375, 768, 1024 or 1440.
- **Each tab page is a Server Component shell** with its sections in their own `<Suspense>` and `ErrorBoundary` (Rule 40.4, 60.12), exactly as before the split; one failing section never breaks the others.
- **Scope limit (unit D).** The unit changes structure only: routes, the two tab rows, visibility and redirects. It uses the existing `Tabs` and the existing section components and does not depend on the compact-UI components (`Panel`, `KeyValueList`, `PageTabs`, `PageHeader`) that live on the unmerged ui-compact branch; the compact restyle of the tab pages follows when ui-compact lands. No change to `lib/nav.ts`: the sidebar's Settings item keeps `/dashboard/settings` and stays active on every nested route (`isNavItemActive`), and the page title stays "Settings".
- Account registry: add/edit/deactivate accounts, map to dept/team (`Admin` role; read-only for other members)
- Sync status: last run time, success/error count, next scheduled run
- Tag coverage (Phase 4.9b, deferred): per-team percentage of tagged vs untagged usage
- Data retention: TTL configuration display (from unit CFG, the `data.retention.dailyRollupDays` value and its source; System Architecture — *Configuration file*, 2026-11-17)
- Access (Phase 4R; [Access Control spec](2026-11-10-access-control.md)): **Members** (add by email/UPN, remove, move; plus the **Pending and stale** access lists, built in 4R.4 — Access Control D34, reversed by the user 2026-11-15; a scoped read route, filtered by the management-read rule), **Team admins** (team and department scopes), **Visibility** (team settings, department settings and cap, "limited by department" hints), and `internal-admin`-only **Group mappings**, **Role grants** (re-authentication prompt and reason field), **Identity links**, **Password users** (create with a one-time setup link shown once, reset, TOTP reset, disable, delete, the SSO reference, bind status and conflicts; the password sign-in switch), **Per-user approval**; **Audit log** and **Access review** export for `internal-admin` and `internal-auditor`. Team and department pickers list the account registry through `GET /api/access/org-units`, scoped to what the caller manages, and member and admin rows show each person's name and email (Access Control D37). A re-auth write in Role grants or Password users opens "Confirm it's you" and returns to that section (Access Control — *Recent authentication*; the return lands on the section's tab and sub-tab through the hash resolver above). Sections a caller cannot use are not rendered; SSO-managed rows show a read-only "Managed in Entra" badge. Forms meet the Phase 5 floor (axe clean, keyboard, visible focus).

**Administration tabs (decided 2026-11-16, user, from the mock-up review; supersedes the vertical secondary navigation and the `section` parameter in the next paragraph; built by unit D of the LiteLLM role-views run, which owns the Settings page — this spec fixes only the look).** Administration holds the `internal-admin` and `internal-org-admin` configuration of the app and the organisation and stays the last sidebar item. Settings is split into **route tabs** at the top of the page, each its own route — *AWS accounts*, *Sync and data*, *LiteLLM*, *Access* — with a second route-tab row inside *Access* and inside *LiteLLM* (the Settings → LiteLLM tabs below); both rows use the one `Tabs` component (*Layout* — *Tabs vs secondary navigation*). `/dashboard/settings` opens the first tab the caller can use, and old `#slug` links redirect to the tab that holds the section. `?section=` links get no redirects (agent decision, 2026-11-17, coordinator; reason: the `section` parameter never shipped, so no saved link exists). Changes from the review:

- **Team membership leaves Settings → Access** for Management → Team (*Management pages*): the **Members** and **Pending and stale** lists of a team move there. Settings → Access keeps the organisation-wide access settings (Team admins, Visibility, Group mappings, Role grants, Identity links and mapping, Password users, Per-user approval) and shows a one-line link "Team membership is managed under Management → Team".
- **Audit leaves Settings** (agent decision, 2026-11-16, addition 6 — *Management pages*): the Audit log and Access review live on the one Audit page under Management; the former Settings audit entry redirects there, so the Settings tab row has no *Audit* tab.
- **Interim, until compact workspace Slice B builds the Management pages (agent decision, 2026-11-16, unit D; reason: `/dashboard/manage/team` and `/dashboard/manage/audit` do not exist yet, so removing these sections now would leave them unreachable).** Unit D ships an *Audit* tab (`/dashboard/settings/audit`) and keeps Members and Pending and stale on the Access → People sub-tab, as in the unit D rules above. Slice B removes them when it adds the Management routes and the audit redirect. The second route-tab row inside *LiteLLM* is not built by unit D: the in-page tabs stay with `LiteLLMPanel` (unit A1) for now, and unit A2 owns the route-tab row (agent decision, 2026-11-17, coordinator; reason: A2 builds the LiteLLM routes that the row links to). Lead and user keep the *AWS accounts*, *Sync and data* and *Access* tabs until Slice B applies the Administration row of Access Control — *Navigation and landing by role* (agent decision, 2026-11-17, coordinator; reason: that row changes landing and visibility for the whole app, which is Slice B's scope, not the tab routes').

**Administration layout (agent decision, 2026-11-16: 15 sections on one 12,000px page had no structure; LiteLLM-admin and Linear-settings pattern; navigation superseded the same day by *Administration tabs* above — the group contents, section rules and Panel rules below still apply, minus the Members, Pending and stale, and Audit sections that moved).** Before the route tabs, Settings was one route, `/dashboard/settings`, with a vertical secondary navigation (224px, sticky; a labelled select below `lg`) and the active group in the URL (nuqs `section`). Groups, in order: **AWS accounts** (`accounts`, default: Account registry), **Sync and data** (`sync`: Sync status, Data retention; Tag coverage when 4.9b lands), **LiteLLM** (`litellm`: the Settings → LiteLLM panel and its tabs, *LiteLLM Page*), **Access** (`access`: People — Members, Team admins, Pending and stale; Visibility; Roles and mapping — Group mappings, Role grants; Identities — Identity links, Identity mapping; Sign-in — Password users, Per-user approval), **Audit** (`audit`: Audit log, Access review). A group with no section the caller can use is not rendered; an unknown or unauthorised `section` falls back to the first visible group. Every section keeps its `h2` text and its `id` slug; a `#slug` hash (including the step-up returns `#role-grants` and `#password-users`) selects the group that contains it and scrolls to the section, so no return-URL parameter is introduced (Access Control — *Recent authentication*). Each section is a Panel; read-only configuration is a key–value list; forms keep the 72ch measure; destructive actions sit last in a separated row of their Panel (deactivate account, reset toggles) or last in a row's actions; one filled primary button per view.

### Account Page

*Added 2026-11-15 (Access Control D30).* `/dashboard/account`, reached from the user menu; every signed-in role.

- **Password users:** a "Change password" form — current password, new password, confirm new password, and a TOTP code when enrolled — posting to `POST /api/account/password`. Inline errors: the generic refusal, `WEAK_PASSWORD` (12–128 characters, not a common password), mismatched confirmation (client-side, before sending). On success a confirmation message; the page stays signed in and other sessions end (Access Control D29).
- **Other sign-in methods** (Entra, master user, dev login): the sign-in method and a short note on where the credential is managed; no form.
- Forms meet the Phase 5 floor (axe clean, keyboard, visible focus, labelled fields, `autocomplete` `current-password` / `new-password` / `one-time-code`).

The top-bar `h1` reads "Account"; the page renders the sign-in facts as a key–value list in a Panel and no second "Account" heading (agent decision, 2026-11-16: the fallback "Dashboard" title was wrong).

### LiteLLM Page

*Added 2026-11-10 (unit L0); built from L3. [LiteLLM spec](2026-11-10-litellm.md).*

- **Sections** (each in its own `<Suspense>` + `ErrorBoundary`, Rule 40.4): *My usage* (all roles: own LiteLLM spend, budget with reset time, effective limits, own keys' metadata), *Team spend & budgets* (Lead, Admin, Auditor: `MetricCard`s for spend against `max_budget` and `soft_budget`, daily spend chart), *Members* (`UsageTable` with `UserAvatar`, member spend, budget and limits; Lead/Admin actions per enabled operation), *Keys* (alias — under the Organisation cap "…" plus the token id's last four characters, LiteLLM spec LD27; the masked `key_name` was never built — models, budget, spend, expiry, blocked state — never a value), *Model access* (the team's models from the proxy list), *LiteLLM audit* (Admin, Auditor: a `DataTable` of LiteLLM's own audit entries — time, actor, action, object, changed field names — with "via dashboard" on entries the dashboard made; no values; LiteLLM spec — *Audit*, amended 2026-11-14).
- **Provenance label:** every LiteLLM-only figure carries a "LiteLLM-reported" badge (Status & Feedback — reuse the existing badge style) with the tooltip "Calculated by LiteLLM from its price map; not billed cost." Combined figures (L6) show their parts on hover or expansion.
- **States:** "not connected to LiteLLM" for the L4 write refusal on an unlinked team only (*Superseded 2026-11-17 (L4b)* for the read view: an unlinked team shows its member sum, the line "This team has no LiteLLM team of its own. Budgets, limits and keys are managed in LiteLLM." and the "Sum of members" badge; LiteLLM spec — *Views by role*), "LiteLLM unavailable" (inline, section-level) on an outage, "LiteLLM not configured" when the service key or URL is missing (on the Organisation and Team pages it replaces the LiteLLM figures, the app teams stay listed with "Not available" spend, and no LiteLLM control renders — LiteLLM spec LD37); an unlinked Viewer gets an `EmptyState`.
- **Shown-once key dialog:** after generate or rotate, a dialog shows the value once with a copy action and the warning "This key will not be shown again"; closing it discards the value.
- **Team-key budget note:** "Only the team and team-member budgets are enforced on team keys; the owner's personal budget does not apply."
- **Controls** for disabled or Enterprise-only operations are not rendered; destructive actions (remove member, reset spend, delete key) confirm in a dialog, never a browser `confirm()`.
- **Team configuration page (L4, 2026-11-16; interim until ui-compact Slice B, agent decision 2026-11-16, confirmed by the user 2026-11-17; LiteLLM spec LD25):** `/dashboard/litellm/team-config` hosts L4's write controls as standalone components (`components/litellm/team/*`, taking the team and the caller's capabilities as props) until Slice B mounts them on Management → Team (`/dashboard/manage/team`, *Management pages*) and the interim route redirects there — a team picker, then sections *Members*, *Keys*, *Budget and limits*, *Models*, each in its own Suspense + ErrorBoundary; destructive actions (remove, reset spend, delete key) confirm in an `AlertDialog`; a generated key is shown once in a dialog with a copy button and a "you will not see this again" note; Lead/Admin/org-admin only (LiteLLM spec — *Team configuration page*).
- **Tabs (L3b, 2026-11-16; superseded the same day, user, by the mock-up review):** L3b grouped the page's sections into tabs — *My usage*, *Team*, *Organisation*, *Users*, *Audit* — with the shadcn `Tabs` component and `?tab=` URL state. The tab row is replaced by the **Management** sidebar items, each its own route, and `/dashboard/litellm` (with any `?tab=`) redirects (*Navigation (Sidebar)*, *Management pages*); each view keeps its sections' Suspense + ErrorBoundary and its "LiteLLM-reported" labels (LiteLLM spec — *Views by role*). The *Users* tab and the Settings *Users* tab share one search component: a labelled search input, results in a shadcn `Table` (at most 25 rows, so no TanStack paging), a selected user's spend and daily spend below.
- **Settings → LiteLLM** (`internal-admin`; `internal-org-admin` edits *Guardrails* and *Team links* and sees *Connection* read-only, LD24; read-only for `internal-auditor`; tabbed from L3b: *Connection*, *Guardrails*, *Team links*, *Users*, and from L6 *Gateway* — Admin edits, org-admin and Auditor read only, 2026-11-17): connection URL, edition (read-only), service-key status ("configured: yes/no" — no entry, reveal or rotate), connection test result, operation toggles, team links (link, re-link and unlink with an inline confirmation), orphaned LiteLLM members. Per-section edit flags come from one pure helper in `lib/auth/` (`litellmPanelCapabilities`); a read-only section renders no write control at all (no switch, Save, Reset, connection test or link control), so the UI can issue no write the role lacks (LD24; org-admin toggle and team-link writes: LT22).
  - **Guardrails grouping (agent decision, 2026-11-16, unit A1 — G6):** the ~33 operation switches are grouped by operation family, in this order: *Team writes*, *Member writes*, *Key writes*, *Team reads*, *User reads*, *Key and spend reads*, *Proxy reads*, then *Other operations* for any name not mapped (never dropped). Each group has a heading and a one-line description (its accessible description); each row shows the operation's LiteLLM call from the LiteLLM spec's *Reads* / *Writes* tables. Empty groups are omitted; order inside a group and the defaults are unchanged. Reason: a flat list of ~33 switches is hard to scan, and the spec's own tables already split operations by family.

### Access states and scoped labels

- **No access** (session the policy cannot resolve): a full-page `EmptyState` — "You don't have access to LLM Usage Lens. Contact your administrator."
- **No team** (`internal-viewer` without a member team or admin scope): *My usage* plus "Ask your team lead for access".
- **Not visible** (a team or department hidden by visibility): a neutral inline notice, never a zero.
- **Scoped labels:** a page whose content the caller's scope narrows states the scope in a `ScopeLine` (*Layout* — *Page frame*); no organisation total includes out-of-scope cost. (Amended 2026-11-17, Slice B1: the Usage pages are shown only to global readers, who see everything, so no scope line renders there and the 4R.5 "Showing your teams only." notice is removed; the first page that shows a `ScopeLine` is the B2 Team page. Access Control — *Navigation and landing by role*, B1 decisions.)
- **`ScopeLine` wording (agent decision, 2026-11-17, Slice B1; the spec gave only the team example):** the label is "Showing teams you lead" for a lead with team scopes, "Showing departments you lead" for a lead with only department scopes, and "Showing your team" for a member; a global reader gets no line. Reason: one parallel phrase per scope kind, following the *Page frame* example. `scopeLabelFor` (`lib/scope-labels.ts`) and `ScopeLine` have no page that mounts them in B1; the B2 Team page is the first (Rule 30.2 noted: they replace the 4R.5 notice markup this slice removes).
- **Role-aware landing:** a global reader (`internal-org-admin`, `internal-admin`, `internal-auditor`) → Overview ("Cost overview", `/dashboard`); everyone else — `internal-team-admin` of any scope, `internal-viewer` and members → *My usage* (`/dashboard/me`) (decided 2026-11-16, user; built in Slice B1, 2026-11-17). The landing is decided on the stored scope, not on the role claim, because the scope is what the pages filter on (agent decision D-R5-2a, 2026-11-16). `/dashboard` and `/dashboard/home` redirect a non-global caller to *My usage* (Access Control — B1-3).
- **Department-only admins (agent decision D-R5-2, 2026-11-16; superseded 2026-11-16 (user) by *Navigation and landing by role*; removed from code in Slice B1, 2026-11-17):** a lead of any scope, department included, lands on *My usage* (`/dashboard/me`).
- **Overview opt-out and scoped Overview link (agent decision D-R5-1, 2026-11-16; superseded 2026-11-16 (user) by *Navigation and landing by role*; removed from code in Slice B1, 2026-11-17):** `?view=overview` has no effect; the Overview is not reachable for a non-global caller.
- **Access-state copy (agent decision D-R5-4, 2026-11-16):** the page and nav label is "My usage"; its heading is "Your Bedrock usage"; the no-team state says "Ask your team lead for access"; a hidden team or department reads "not visible" with no zero shown; an empty period reads "No Bedrock usage". Reason: the empty-state precedent in this spec. (The "your teams" notice part of D-R5-4 is superseded, 2026-11-17, Slice B1: the notice is removed with the lead's Usage view — *Scoped labels* above.)

### Management pages

*Added 2026-11-16 (user, mock-up review: decisions and the eight accepted additions). Roles per Access Control — *Navigation and landing by role*; LiteLLM data per the LiteLLM spec — *Views by role*. Every figure keeps its provenance label; LiteLLM-reported and AWS-billed figures are never added together (L6's combined rules aside).*

- **My usage** (`/dashboard/me`, every signed-in role; a **Usage** sidebar item since 2026-11-17, user — the page is unchanged). The caller's own usage: the 4R.5 own Bedrock usage (`/api/me/usage`) and the LiteLLM *My usage* view (spend, budget with reset time, limits, own keys' metadata), each labelled with its source. It answers "why": a spend-by-day chart and a spend-by-model breakdown of the caller's own data — lazy-loaded Recharts in `ResponsiveContainer`, series coloured by the model token from `packages/shared` (Rule 40.2, 40.3). A **"Request a budget increase"** link addresses the caller's team lead as a `mailto:` link or a copyable address; no outbound-message feature is added, and the link is absent when no lead is known. The date range stays; sync badges are hidden for a lead and a user (*Layout*).
- **Team** (`/dashboard/manage/team`; lead for the teams it leads, `internal-org-admin` and `internal-admin` for every team; `internal-auditor` read-only — Access Control). **One page** for a team's usage and its management, replacing the LiteLLM *Team* tab and the Settings team membership. `PageHeader`: team selector (nuqs `team`; a lead's list holds only the teams it leads) and the `ScopeLine` for a lead; below the header, the view tabs *Members*, *Budgets*, *Keys* (`PageTabs`; amended in B2b, 2026-11-17, to match the build: tabs below the header, not in it). Usage: team spend ("LiteLLM-reported"), team budget, members, keys' metadata, model access. Management: member search, **Add member**, **Edit budget**, **Reset spend** (a button at the right of each member row), **Remove member**, and a bulk **"Reset spend for all members"** above the member table.
  - **Membership** (agent decision, 2026-11-16: the mock-up's member table carries the app membership — role, source "group mapping"/"manual", added date — and Settings → Access hands team membership to this page): the member list is the team's app affiliations with their pending and stale entries (the 4R.4 Members routes), joined with each member's LiteLLM spend and budget when the team is linked. Add and remove act on the affiliation through the existing 4R.4 routes and, where the team is linked and the operation is enabled, on the LiteLLM membership through the L4 routes; an SSO-managed member shows "Managed in Entra" and no remove. The page adds **no LiteLLM call of its own** (Rule 10): every write goes through an existing or L4 Route Handler.
  - **Lead's other team-scoped access actions** (agent decision, 2026-11-16: a lead no longer sees Administration, and the Access Control permission matrix is unchanged, so its team-scope admin grants and its team's visibility setting need a surface): on this page, for a caller whose scope allows it, the *Members* tab marks team admins with a grant/remove action (never on the caller's own scope) and a *Visibility* Panel shows the team setting with "limited by department" hints, both through the existing 4R.4 routes. Settings → Access keeps the same sections for `internal-org-admin` and `internal-admin`.
  - **Write controls arrive with L4** (as components; mounted on the interim team-config page until Slice B, *LiteLLM Page*). Edit budget, reset spend (`resetMemberSpend`, toggle default **off**, LD10) and the LiteLLM member writes are built with LiteLLM unit L4; until the operation is enabled for the caller the control is **absent, not dead** (*LiteLLM Page* — *Controls*).
  - **Confirm destructive actions** (decided 2026-11-16, user): reset spend and remove member open a `AlertDialog` that names the person and the effect — e.g. "Sets j.lee's spend to $0.00. Recorded in the audit log." — with Cancel focused first and the `destructive` confirm button; the bulk reset's dialog states the member count ("Resets spend for 12 members to $0.00. Recorded in the audit log."). Never a browser `confirm()`.
  - **Budget as a bar** (decided 2026-11-16, user): a thin `BudgetBar` under each member and team budget — neutral below 80%, warning from 80%, destructive at or above 100% — with the percentage as text beside it (colour is never the only signal; "No limit" when there is no budget). The member table toolbar gains a **"Near or over budget"** filter (≥ 80%).
  - **AWS-billed cost tile — not built (decided 2026-11-17, coordinator under the user's delegation):** a lead has no "AWS-billed cost" tile; least privilege, and AWS billing is account-level (Access Control — *Navigation and landing by role*).
- **Organisation** and **Users** (`/dashboard/manage/organisation`, `/dashboard/manage/users`): the LiteLLM *Organisation* and *Users* views unchanged in content (LiteLLM spec — *Views by role*), now their own routes.
- **Audit** (`/dashboard/manage/audit`; agent decision, 2026-11-16: audit is an oversight read used by `internal-auditor`, who holds no configuration, so it sits with the other read views under Management rather than in Administration; one placement, the Settings entry redirects). One page with a **source filter** — *App* (the dashboard audit log, Access Control — *Audit log*) and *Gateway* (LiteLLM's audit, LiteLLM spec — *Audit*) — shown as a segmented toggle in the toolbar (nuqs `source`). It is **composition, not a merged store**: each source keeps its own route, permission and pagination, and a source the caller may not read is not offered. The Access review export is a page action for the roles that may export it. Viewing either source stays audited. Default source *App* when the caller may read it, else *Gateway*; with one readable source the toggle is not shown (agent decision, Slice B2, 2026-11-17).
- **Team page membership in B2** (agent decision, Slice B2, 2026-11-17: the joined member table needs a read that combines the 4R.4 affiliations with LiteLLM spend, which no route offers yet; reversible): the page shows the app membership (the Access *Members*, *Team admins*, *Pending access* and *Visibility* sections) and the LiteLLM membership (*LiteLLM members*, with `BudgetBar` and the "Near or over budget" filter) as separate panels. The single joined table described under *Membership* above is not built yet. ~~*Interim (coordinator, 2026-11-17, at L5b):* the view tabs and member search are built in unit B2b after L4b.~~ *Superseded 2026-11-17 by* **Team page views and links** *(B2b, below): the view tabs and the member search are built.* The joined member table is still not built; the separate panels are not the end state.
- **Access sections follow the page's team picker** (agent decision, unit C1, 2026-11-17: the *Members* and *Visibility* sections used their own team choosers beside the page's, so the page had two): on the Team page they open on the team in `?team=` and follow it when it changes; an unknown `?team=` keeps the first listed team. Settings → Access has no `?team=` and is unchanged. The page has one team chooser.
- **Team page views and links (Slice B2b, agent decisions, 2026-11-17; reversible):**
  - **View tabs** *Members*, *Budgets*, *Keys* in `PageTabs` (the one `Tabs` component; *Component Inventory*), URL state `?view=` (nuqs, history push so Back steps through views); default *Members*. *Members* holds the LiteLLM members and the app-membership Access sections; *Budgets* holds team spend and *Budget and limits*; *Keys* holds the keys and *Models*. A view the caller cannot use is not rendered, and an unknown or hidden `?view=` falls back to *Members*. **Unlinked team, or LiteLLM `configured: false` (LD37):** only *Members* (no LiteLLM team, so no budgets or keys to show); the team spend stays above the tabs.
  - **Member search** on *Members*: a labelled search box ("Search members") filtering the loaded member rows client-side by name or email, case-insensitive; "No members match" when nothing matches. No new request. It covers the LiteLLM member rows (combined with "Near or over budget"); the app-membership Access sections keep their own lists.
  - **G1 — member daily spend:** on a linked team, each LiteLLM member row has a "Daily spend" action that opens that person's daily spend for the selected range, read through the existing `GET /api/litellm/users/[litellmUserId]` (a Lead for members of its linked teams in scope, org-admin, Admin, Auditor; LD23 cap applies). No new route or gateway operation. Unlinked teams' member-sum rows have no such action: that route scopes a Lead by linked LiteLLM team membership (deferred — `docs/future-improvements.md`, *Member daily spend on unlinked app teams*). Under the Organisation cap (LD23) the action is hidden, as on the Users page.
  - **G2 — Organisation → team:** each *App teams* row links its name to `/dashboard/manage/team?team=<id>` for callers who may open the Team page (every Organisation reader may — admin, org-admin, auditor).
- **Bulk reset** (agent decision, Slice B2, 2026-11-17): "Reset spend for all members" calls the existing per-member reset route once per member (each audited), shown only when `resetMemberSpend` is enabled; no new route and no LiteLLM call of the page's own.
- **Scope line and date range:** every Management page a scope narrows shows the `ScopeLine` (*Layout* — *Page frame*); the global date range applies to every Management page.

## Responsive Tables

Data tables (`UsageTable`, `RankingList`) have up to 8 columns, which cannot fit a 375px viewport without horizontal scroll — an anti-pattern. Tables therefore adapt by breakpoint:

- **Desktop / tablet (≥ `md`, 768px+):** Full table — all columns, sortable headers.
- **Mobile (< `md`):** Each row collapses into a **card**. The entity name is the card title, Cost is shown prominently, and the remaining metrics render as label–value pairs. TanStack Table drives both renders from the same data, sorting, and pagination.

Sort and filter controls (`SearchInput`, `ModelFilter`, `Pagination`) remain available in both layouts; `ColumnToggle` is hidden in card-list mode. No horizontal scroll at any viewport.

Table spec (agent decision, 2026-11-16): sticky header; numeric columns right-aligned in JetBrains Mono with tabular figures, header aligned with its column; inline row actions as 32px icon buttons with tooltips naming the action, destructive last and separated; Columns toggle on every desktop table (hidden in card-list mode); pagination controls only when there is more than one page, with the row count always shown; the card list uses the non-hideable column as the card title. Touch targets reach 44px below `md` and on coarse pointers.

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
- **Popovers, dropdowns, and dialogs:** floating surfaces — `--radius-card` (8px), a light `border-border/60` and `--shadow-overlay` on `bg-popover`; the only shadowed surfaces in the app (agent decision, 2026-11-16).
- **Buttons:** one filled primary per view; section and toolbar actions `outline` or `ghost` at 32px; `secondary` is a neutral fill; destructive confirmations use the `destructive` variant with Cancel focused first (agent decision, 2026-11-16).
- **Tabs:** 36px strip with a full-width bottom border; active tab foreground text with a 2px primary indicator; horizontal scroll on narrow screens, never wrap; state in the URL (agent decision, 2026-11-16).
- **Switches:** shadcn `Switch` (`role=switch`), `--color-input` track border when off, `bg-primary` when on (agent decision, 2026-11-16: replaces two hand-rolled switches).
- **Key–value lists:** `<dl>`, label column 8–12rem muted 13px, value 13px (mono for IDs and numbers), 32px rows (agent decision, 2026-11-16).
- **Selection & ranges:** the selected item is `bg-primary`; a range band uses
  `primary-subtle` (amended 2026-11-16: `accent` is now neutral); "today"/current markers are a subtle `accent/60` chip, never a
  competing fill.
- **Focus:** keep a visible focus indicator on every interactive element (Rule 60.30) at 2-4px and at least 3:1 against the adjacent background (WCAG 1.4.11); from the compact refresh every primitive uses `focus-visible:ring-2 ring-focus-ring ring-offset-2` (agent decision, 2026-11-16: brought forward from Phase 5). Its colour is the dedicated opaque `--color-focus-ring` token,
  not the translucent `--color-ring` / `ring-ring/50` (about 1.3:1 on white). A
  box-shadow ring is hidden in forced-colors mode, so pair it with
  `outline-hidden` (Tailwind v4: a transparent outline that forced colors
  repaint), never `outline-none`. On `bg-primary` controls the ring sits outside the element (ring offset or outer edge against the surface), since `--color-focus-ring` equals `--color-primary`. Never remove it to tidy a layout (decided
  2026-11-06; applied in the Phase 5 accessibility audit).

## Component Inventory

### Layout & Navigation

| Component | Source | Purpose |
|-----------|--------|---------|
| `Sidebar` | shadcn/ui | Collapsible navigation with active state. Locally patched (2026-10-29): `components/ui/sidebar.tsx` renders desktop markup until hydrated, uses the `border-sidebar-border` token for its edge, and `hooks/use-mobile.ts` uses `useSyncExternalStore`, so a late-hydrating `<Suspense>` does not mismatch at mobile widths; the mobile sheet returns focus to the `SidebarTrigger` on close (`onCloseAutoFocus`), and `SidebarMenuButton` tooltips are held closed on mobile so a single Escape closes the sheet — re-apply after any `shadcn add sidebar`. Nav and brand links close the mobile sheet on click (`AppSidebar`); the footer toggle's accessible name, icon and tooltip follow its action ("Collapse" / "Expand"; always "Collapse" in the mobile sheet) (`AppSidebar`, 2026-10-30). Width `14rem`, menu buttons 32px, groups Usage / Management / Administration (Management replaces Gateway, decided 2026-11-16, user), footer collapse icon button (amended 2026-11-16). |
| `CommandMenu` | shadcn/ui (cmdk) | Cmd+K quick search — jump to any department, team, user, service |
| `Kbd` | Custom | Keyboard shortcut hints |
| `PageHeader` | Custom | Breadcrumb, entity title (`h2`), description, actions, tabs and toolbar slot at the top of every dashboard page (agent decision, 2026-11-16) |
| `PageTabs` | shadcn/ui Tabs | URL-bound tabs on the one `Tabs` component: view tabs (Ranking, Team page) and route tabs (Settings and its second rows) (agent decision, 2026-11-16; amended 2026-11-16, user: the LiteLLM tab row became Management routes) |
| `Breadcrumb` | shadcn/ui | Detail-page trail (agent decision, 2026-11-16) |
| `SettingsNav` | Custom | Grouped Settings secondary navigation; select below `lg` (agent decision, 2026-11-16; superseded the same day by the Settings route tabs, *Settings Page* — not built) |
| `ScopeLine` | Custom | "Showing …" scope statement under the `PageHeader` description on scoped pages (decided 2026-11-16, user) |

### Data Display

| Component | Source | Purpose |
|-----------|--------|---------|
| `MetricCard` | Custom (shadcn Card) | KPI card: 12px label, 20px value with inline delta, up to two footnote lines; no decorative icon chip (amended 2026-11-16) |
| `DeltaBadge` | Custom | "+12.3%" green arrow or "-5.1%" red arrow for trends |
| `UsageTable` | Custom (TanStack Table + shadcn Table) | Sortable, filterable data table with pagination; renders as a card list below the `md` breakpoint (see Responsive Tables) |
| `Tabs` | shadcn (Radix Tabs) | Tabbed views with Arrow/Home/End keyboard navigation and a visible focus ring on triggers and panels (L3b; from 2026-11-16 the Team page, Ranking and the Settings tab rows — the only tabs component) |
| `UserSearch` | Custom | Debounced LiteLLM user search with a results table and the selected user's usage; shared by Management → Users (formerly the LiteLLM *Users* tab) and Settings → LiteLLM *Users* (L3b) |
| `BudgetBar` | Custom (shadcn Progress) | Thin budget bar: neutral < 80%, warning from 80%, destructive ≥ 100%, percentage as text (decided 2026-11-16, user) |
| `RankingList` | Custom | Ranked list; the rank is rendered by `RankCell` (medal icons for the top three). The % of total bar is `PercentOfTotalBar`, composed in where a page shows shares (the Ranking table, Phase 4.2) — not part of `RankingList` itself (decided 2026-11-06) |
| `SparklineCell` | Custom | Inline trend sparkline for table cells |
| `PercentOfTotalBar` | Custom | Inline bar showing proportion visually in ranking tables |
| `PeriodComparison` | Custom | "vs previous period" compact strip inside the KPI row (amended 2026-11-16) |
| `Panel` | Custom (Card surface) | Titled section: `h2`, description, actions, own Suspense + `SectionBoundary` + skeleton, flush table mode (agent decision, 2026-11-16) |
| `KeyValueList` | Custom | Read-only configuration as `<dl>` (agent decision, 2026-11-16) |
| `TableToolbar` | Custom | One-row table toolbar (agent decision, 2026-11-16) |

### Charts

| Component | Source | Purpose |
|-----------|--------|---------|
| `CostTrendChart` | Recharts | Stacked area chart; `groupBy: 'model' \| 'team'` (loaded with `next/dynamic`, `ssr: false`) |
| `ModelBreakdownChart` | Recharts | Donut chart showing model distribution |

Legends are a custom swatch + foreground-text legend (series colour never used as text colour); entry animation ≤250ms and off under `prefers-reduced-motion` (agent decision, 2026-11-16: legend text in model colours failed 4.5:1).

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
| `RefreshButton` | Custom (shadcn Button, Lucide `RefreshCw`) | Top-bar icon-only ghost button beside `SyncCountdown`, `aria-label="Refresh data"` with a tooltip; shown wherever the sync status is shown. One click invalidates every query and reloads (*Caching Strategy* — Refresh). The icon spins while any query is fetching and the button is disabled for that time, which is also the click throttle; no spin under `prefers-reduced-motion`. 32px control on desktop, 44px touch target below `md`; never the view's filled primary button (Phase 5 PERF-R, user direction 2026-11-17) |
| `SyncCountdown` | Custom | "Next sync in 42 min" countdown in top bar to `SyncStatus.nextScheduledAt` (required when the item exists — `SyncStatusSchema`, Rule 20.9); an overdue time reads "0 min", never negative; sync status refetches every 5 minutes (*Caching Strategy*). Neutral "Next sync: pending" while loading, when no sync has run, or when the request fails. ARIA `role="timer"` (implicit `aria-live="off"`), so ticks are not announced — never a `status` live region (decided 2026-10-29) |
| `CostEstimateIndicator` | Custom (shadcn Badge) | Subtle outline "Estimated" badge beside a cost whose row has `costEstimated: true` — per-user and per-service proportional estimates (Rule 20.3); built in Phase 4.2. It does not mark `costFinalized: false` |
| `TagCoverageBar` | Custom | Progress bar showing % of tagged usage per team (Phase 4.9b, deferred) |
| `EmptyState` | Custom | Reusable empty state with icon, message and optional CTA; `size="sm"` for one-line empties inside a table or Panel (amended 2026-11-16) |
| `ErrorBoundary` | Custom | Per-section error boundary — one chart failing doesn't crash the page |
| `Skeleton` | shadcn/ui | Loading placeholder for sections taking >300ms |
| `Alert` | shadcn/ui | Inline notices and section errors (agent decision, 2026-11-16) |
| `AlertDialog` | shadcn/ui | Destructive confirmations naming the person, the effect and (bulk) the count; Cancel focused first (decided 2026-11-16, user) |
| `Switch`, `Collapsible` | shadcn/ui | Toggles; disclosure of secondary content (agent decision, 2026-11-16) |

### Identity & Badges

| Component | Source | Purpose |
|-----------|--------|---------|
| `ModelBadge` | Custom | Model name with its assigned color dot |
| `AccountIdBadge` | Custom | Formatted AWS account ID with copy button (123-456-789-012) |
| `UserAvatar` | Custom | Initials avatar, neutral fill, 20px in tables (agent decision, 2026-11-16: per-user colour carried no information and dominated rows; plan D-15) |

## UX Standards (from UI UX Pro Max)

### Critical (Must Have)

- **Accessibility**: Contrast 4.5:1 minimum, alt text, keyboard navigation, aria-labels, focus rings (2-4px, at least 3:1, kept in forced-colors mode — Interaction & States)
- **Touch targets**: Minimum 44x44px below `md` and on coarse pointers, 8px spacing between targets; on pointer-fine desktop, controls are 32px (above WCAG 2.5.8's 24px) (agent decision, 2026-11-16: compact desktop density without shrinking touch)
- **Loading states**: Skeleton screens for >300ms loads, spinner on async buttons
- **Error feedback**: Clear messages near the problem field, recovery path included

### High Priority

- **Responsive**: Mobile-first, no horizontal scroll, viewport meta tag
- **Typography**: the compact scale in *Typography* (14px dashboard body, 16px inputs on mobile), semantic color tokens (no raw hex in components) (amended 2026-11-16)
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
