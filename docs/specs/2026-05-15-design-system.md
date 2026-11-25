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
| **Framework** | Next.js (App Router) | Latest stable, Server Components, Route Handlers. `agentRules: false` in `next.config.ts`, and `apps/dashboard/AGENTS.md` is git-ignored (coordinator decision, 2026-11-18, SEC1): from 16.4, `next dev` writes agent instructions into `AGENTS.md` and asks agents to run a network feedback command; this project's agent guidance is `CLAUDE.md` and `.claude/rules` only (Rule 00), so tool-injected agent files are not accepted |
| **Language** | TypeScript | Strict mode, 6.x |
| **Runtime** | Node.js | 24 LTS (24.22.3, pinned in the image, `.nvmrc` and CI; user, 2026-11-18: "upgrade to node.js version to the latest 24.x.x"; previously 22 LTS) |
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
| **Vite** | Not used | Next.js has its own bundler (Turbopack in dev, Webpack in production). Adding Vite would conflict with Next.js's build pipeline. *Note (2026-11-18, SEC1):* `vite` is a root dev dependency only to pin a patched version of the Vite that Vitest already uses (dependency audit); it is not an app bundler. |
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
  - **The forms (unit SI1, user, 2026-11-25: "3 input fields without any
    information"; D-R3-15; Q-R3-3, user, 2026-11-25).** Each method is one titled group. Every field
    has a **visible label** bound to it; a placeholder or an `aria-label`
    alone is not a label. Email and password: "Email", "Password" (with a
    show / hide control), and "Authenticator code" with the hint "6-digit
    code from your authenticator app. Leave empty if you have not set one
    up." The master user's form is not on the page until "Sign in as master
    user" is chosen; its fields are "Username", "Password" and
    "Authenticator code" with the same hint. `autocomplete` is `username`,
    `current-password` and `one-time-code`. A failed password or master
    sign-in shows one message, "Those details are not right. Check them and
    try again.", whatever the cause (Access Control — T20, T23); nothing the
    person typed goes into the URL. The email and password form is absent
    while password sign-in is off (Access Control — D24): the page reads
    the switch on the server per request, never from a cache, and when
    that read fails the form is absent and the other methods still show
    (fail closed).

  *Tests (unit SI1).*

  | Test | Proves |
  |---|---|
  | T-SI1 | Every field of every form has a visible label bound to it; the code field's hint; show / hide on the password; `autocomplete` kept |
  | T-SI2 | One titled group per enabled method; the master form opens from "Sign in as master user"; nothing renders for a method that is off |
  | T-SI3 | A password user signs in with email and password, and with the code when enrolled |
  | T-SI4 | One message for an unknown, disabled, locked or SSO-bound user, a wrong password and a wrong code; the same message for the master user; no credential in the URL |
  | T-SI5 | The form is absent while password sign-in is off |
  | T-SI6 | Lockout, the security event per attempt and the audit record are unchanged |
  | T-SI7 | E2E: each form at 375px and desktop, axe clean; sign-in under the base path |
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
- **Refresh:** the top bar's `RefreshButton` (*Component Inventory*) invalidates every query and sends `Cache-Control: no-cache` on that round of requests. The server honours it in two places only: `GET /api/sync-status` skips its 5-minute cache, and the LiteLLM read cache is bypassed and its entries replaced. **Built in two steps (D-R3-1, 2026-11-25):** unit RF1 builds the button, the `GET /api/sync-status` bypass with its 10-second limit, and the rollup cache key that includes the last sync run; the LiteLLM read-cache bypass lands with PERF-3, which adds that cache. Until then only the sync-status request of the refresh round carries the header. A click also refreshes the server-rendered parts of the page. The button starts no collector run and no LiteLLM user sync (D-R3-3). **Minimum refresh interval (agent decision, 2026-11-17):** the server honours a bypass for one key at most once per 10 seconds per task; a `no-cache` request inside that time gets the entry that was just refreshed. Reason: the header is set by the client, so the button's own throttle is not a control, and without a server-side limit any signed-in user could turn each request into an upstream LiteLLM call (the same denial-of-service reasoning as `revalidateTag` below). Residual, accepted: the refetch after a write can show a value up to 10 seconds old when it lands on the other task; the UI has already shown the write response. It never calls `revalidateTag`: any signed-in user could otherwise force a re-read of up to 90 days of rollups (cost, and a denial-of-service lever) (PERF-R).

  *Tests (unit RF1).*

  | Test | Proves |
  |---|---|
  | T-RF1 | The button is in the top bar for a global reader, a lead and a member; `aria-label="Refresh data"`; tooltip; 32px, and 44px below `md` |
  | T-RF2 | A click refetches every mounted query once and refreshes the page; disabled and spinning while fetching; no spin under reduced motion |
  | T-RF3 | With `Cache-Control: no-cache`, `GET /api/sync-status` skips its cache; a second bypass for the same key within 10 seconds gets the entry just read |
  | T-RF4 | Without the header the route serves its cache; `private, no-store` and the `401` are unchanged |
  | T-RF5 | The rollup cache key includes the last sync run: a new run is read once; the same run is served from the cache |
  | T-RF6 | The refresh path never calls `revalidateTag` |
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

Nav is grouped: **Usage** (Overview, the per-dimension breakdowns and, last, My usage), **Management** (team, organisation, user and audit views) and **Administration** (Settings) (agent decision, 2026-11-16: replaces Main / Attribution and the footer Settings entry; groups by audience; amended 2026-11-16, user, from the mock-up review: **Management** replaces **Gateway** and the single LiteLLM item, and the LiteLLM page's tabs become Management items, each its own route; amended 2026-11-17, user, from the B1 screenshot review: **My usage sits in the Usage group, last**, not in Management — it is a usage view. It is the one Usage item every signed-in caller sees, so for a lead or a user the Usage group holds only My usage (*superseded 2026-11-17, user, management improvements D7: a lead with a live admin scope also sees Team usage, so its Usage group is My usage and Team usage; a user's is My usage only*); the organisation-level Usage items stay global-reader only; **amended 2026-11-17, user (management improvements, D1; *Management improvements* below):** the order is Usage — Overview, My usage, Team usage, Ranking, Cost by department, Cost by team, Cost by service, Cost by user — and Management — Users, Team, LiteLLM, Audit. My usage is second, no longer last; **Team usage** is new (D7); Organisation is no longer a sidebar item but the first tab of Management → LiteLLM (D2, agent decision under D1). Who sees each existing item does not change; Team usage is shown to a caller with a live admin scope and to every global reader (D7; MI-D7, coordinator decision, 2026-11-17)). Each item carries a short rail label and a descriptive page title shown in the top bar. Which roles see each item is in Access Control — *Navigation and landing by role*; an item the caller may not see is absent, never disabled, and its route returns the same `404` as a missing page (Rule 10.3).

**Unique labels (agent decision, 2026-11-16: "Teams" and "Users" appeared twice in one sidebar; parallel "Cost by …" labels for every breakdown in a group is the common pattern and keeps each label unique).** The four Usage breakdown items read "Cost by department", "Cost by team", "Cost by service", "Cost by user"; their page titles (`h1`) follow. Routes, nuqs names and query keys are unchanged.

| Group | Item (rail label) | Page title | Route | Description |
|-------|-------------------|------------|-------|-------------|
| Usage | Overview | Cost overview | `/dashboard` | KPI cards, cost trend chart, top consumers |
| Usage | My usage | My usage | `/dashboard/me` | The caller's own usage (*Management pages*); every signed-in role; second in the group (2026-11-17, user, D1; supersedes "last in the group") |
| Usage | Team usage | Team usage | `/dashboard/team-usage` | The LiteLLM-reported spend of the teams the caller may open — its admin scope, or every team for a global reader (*Management pages* — *Team usage*); a caller with a live team or department admin scope (its teams) and every global reader — admin, org-admin, auditor read-only — for any team (coordinator decision, 2026-11-17, under the user's delegation; Access Control — MI-D7); absent for a user; third in the group (2026-11-17, user, D7) *Hidden until M2 lands the page (`TEAM_USAGE_ROUTE = false`, 2026-11-18).* Superseded: `TEAM_USAGE_ROUTE = true`; shown per `teamUsage` (M2 merge, 2026-11-18). |
| Usage | Ranking | Cost ranking | `/dashboard/ranking` | Leaderboard with tabs + model filter |
| Usage | Cost by department | Cost by department | `/dashboard/departments` | Departments table (cost, change, tokens, teams, top model) linking to detail (agent decision, 2026-11-16: consistent with the other breakdowns; the three-card grid left most of the canvas empty) |
| — | Department Detail | Cost by department | `/dashboard/departments/[id]` | Teams breakdown, cost over time (drill-down, no rail item); `PageHeader` breadcrumb "Departments / <name>" (agent decision, 2026-11-16) |
| Usage | Cost by team | Cost by team | `/dashboard/teams` | Teams list, filterable by department |
| — | Team Detail | Cost by team | `/dashboard/teams/[id]` | Services + users breakdown (drill-down, no rail item); `PageHeader` breadcrumb "Teams / <name>" (agent decision, 2026-11-16) |
| Usage | Cost by service | Cost by service | `/dashboard/services` | All services across all accounts |
| Usage | Cost by user | Cost by user | `/dashboard/users` | All users across all accounts |
| Management | Users | Users | `/dashboard/manage/users` | The app's people list with **Add user**, and the user search (*Management pages* — *Users*; 2026-11-17, D15; first in the group, D1) |
| Management | Team | Team management | `/dashboard/manage/team` | One page for a team's management, with **New team** for admin and org-admin (*Management pages*; the team spend moved to Team usage, D7; page title changed from "Team usage & management" 2026-11-17, agent decision: the page no longer shows usage) |
| Management | LiteLLM | LiteLLM | `/dashboard/manage/litellm/<tab>` | Route tabs *Organisation*, *LiteLLM teams*, *LiteLLM users* (*Management pages* — *LiteLLM area*; 2026-11-17, D2, agent decision under the user's order D1). Replaces the Organisation item (`/dashboard/manage/organisation`, now a redirect) |
| Management | Audit | Audit log | `/dashboard/manage/audit` | One audit page with a source filter, App · Gateway (*Management pages*) |
| Administration | Settings | Settings | `/dashboard/settings` | Admin area with route tabs: AWS accounts, Sync and data, LiteLLM, Access (*Settings Page*) |

| — | Account | Account | `/dashboard/account` | The caller's sign-in method; for password users, the own password change form (from the user menu, no rail item; added 2026-11-15, Access Control D30) |

**Routes and redirects (agent decision, 2026-11-16: `/dashboard/me` is the route 4R.5 already names; the other Management items share one `/dashboard/manage/` prefix so they never collide with the Usage routes `/dashboard/teams` and `/dashboard/users`, and the prefix names the group rather than LiteLLM because the Team and Audit pages compose app and gateway data).** Every existing URL keeps working through a redirect (`redirect()` in the page, presentation only): `/dashboard/litellm` → the caller's landing page; `/dashboard/litellm?tab=my-usage|team|organisation|users|audit` → the matching Management route (other query parameters carried); the Settings audit entry (`/dashboard/settings?section=audit` and `/dashboard/settings/audit`) → `/dashboard/manage/audit`. A redirect target the caller may not see returns the same `404` as a missing page. The earlier note that no `/dashboard/audit` route exists is superseded; there is still no `/dashboard/audit`. **Added 2026-11-17 (D3, unit M1):** `/dashboard/manage/organisation` → `/dashboard/manage/litellm/organisation`; `/dashboard/litellm?tab=organisation` → `/dashboard/manage/litellm/organisation` (supersedes its B2-3 target); `/dashboard/settings/litellm/team-links` → `/dashboard/manage/litellm/teams`; `/dashboard/settings/litellm/users` → `/dashboard/manage/litellm/users`. Each is a server redirect that keeps the query string; a target the caller may not see returns the missing-page `404` there. `/dashboard/litellm?tab=users` still lands on `/dashboard/manage/users`. *Old hash links (agent decision, 2026-11-18, unit M1: the A2 rule that an old `#<section>` link lands on its route, so a bookmark keeps working):* `#team-links` and `#users` on `/dashboard/settings` or `/dashboard/settings/litellm` land on `/dashboard/manage/litellm/teams` and `/dashboard/manage/litellm/users`; a caller who may not see the target gets its missing-page `404`.

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

- Services table (`UsageTable`: Service Name, Team, Department, Cost, Tokens, Invocations, % of Total), one row per team and service (Data Model — `ServicesResponseSchema`), with the "model usage only" note. The page also carries a Bedrock/LiteLLM source split: see *Source panels on Cost by team, Cost by user and Cost by service* below. The sections match Phase 4.7 (decided 2026-11-06). The "model usage only" note is a one-line `role=note` under the page description; the toolbar has Search, Columns and Export CSV like Ranking (agent decision, 2026-11-16: consistent list toolbar).

### Users Page

- Users table (`UsageTable`: User (`UserAvatar` + user id), Team, Department, Cost, Tokens, Invocations, % of Total), one row per team and user (Data Model — `UsersResponseSchema`), with the "model usage only" note. The sections match Phase 4.8 (decided 2026-11-06). The "model usage only" note is a one-line `role=note` under the page description; the toolbar has Search, Columns and Export CSV like Ranking (agent decision, 2026-11-16: consistent list toolbar). Users renders neutral 20px avatars (*Avatar Colors*). The page also carries a Bedrock/LiteLLM source split: see *Source panels on Cost by team, Cost by user and Cost by service* below.

### Source panels on Cost by team, Cost by user and Cost by service

*Added 2026-11-17 (user, management improvements item 14; decisions D17–D19, unit M5). Amends the Cost by team page (Phase 4.5), *Services Page* and *Users Page* above and L6's Teams "Combined with LiteLLM" panel (LiteLLM spec — *Combined usage and My usage (L6)*), which this layout absorbs.*

- **D17 — Two panels, never one mixed chart (user, 2026-11-17).** Each of the three pages shows a **Bedrock** panel, labelled "AWS-billed", and a **LiteLLM** panel, labelled "LiteLLM-reported", each with its own chart or table, its own provenance label and its own `<Suspense>` + `ErrorBoundary` (Rule 40.4). No chart, series, table column or CSV mixes the two sources. The Bedrock panel is the page's existing table and route, unchanged (`/api/teams`, `/api/users`, `/api/services`); a LiteLLM outage leaves it working. Reason: the user asked that a figure always shows which system reported it.
- **D18 — Three figures, the global sum is L6's combined figure (agent decision, 2026-11-17; L6's rules).** Each page opens with three figures: **Bedrock** (AWS-billed, the page's own total for the range), **LiteLLM** (LiteLLM-reported for the range) and **Combined**. Combined is never Bedrock plus LiteLLM added naively: it is L6's `combined` (direct Bedrock excluding the gateway slice, plus LiteLLM-reported), shows its parts, carries the estimate mark, and follows the "gateway not configured" rule (warning for global readers, the total hidden otherwise; shared contract §5). The figures come from L6's `GET /api/litellm/combined/organisation` and its components (`components/litellm/combined/*`); no new route. Reason: one rule for the combined figure everywhere (LT8, counted-once fixture).
- **What each LiteLLM panel shows (agent decision, 2026-11-17: only reads already on the allowlist, inside the LD34 call budget):**
  - *Cost by team:* the app teams of the Organisation view (`GET /api/litellm/org` — `appTeams[]`, spend for the range, source badge "LiteLLM team" or "Sum of members", coverage), plus the LiteLLM teams total as the panel total (LD33). For Admin, org-admin and Auditor each linked row offers "Sum of members" on request (the second figure, with the *Why the figures differ* text — App Teams spec), and so does each unlinked row the Organisation read left as `open-team` (its member sum), both through `GET /api/litellm/teams/[teamId]?include=memberSum` — the place this figure moves to from the Team page (D7), beside Team usage (MI-D7, coordinator decision, 2026-11-17, under the user's delegation; reason: one reader per figure, so no new route). A created team (no AWS account, D5) appears here and, in the Bedrock panel, as a "No AWS account" table under the Bedrock table (M5-D3), never `$0` (the panel adds the `hasAwsAccount: false` teams of `GET /api/access/org-units`; `GET /api/teams` and its schema are unchanged). *(The Organisation tab no longer shows that table, 2026-11-25; the route still returns `appTeams[]`.)*
  - *Cost by user:* the LiteLLM users list (`GET /api/litellm/users` with no search text, 25 a page, server-side paging; D16a), with `spend` labelled "LiteLLM-reported, total to date" because `/user/list` does not cover the selected range; the range figure for one person is the user detail on Management → LiteLLM → *LiteLLM users*. Under the Organisation cap (LD23) per-user spend is hidden and the panel says so.
  - *Cost by service:* **D19 — honest gaps (agent decision, 2026-11-17).** LiteLLM reports no cost by service (a service comes from CloudTrail inference profiles, Rule 20.10), so the panel shows the LiteLLM total for the range and its split by provider (L6's `byProvider[]`) and the line "LiteLLM does not report cost by service." It never maps a LiteLLM key alias or tag to a service. **Q7 (user, 2026-11-17): no.** A LiteLLM dimension (key alias, tag) does not stand for "service".
- **"Not in LiteLLM", never `$0`:** a person or team with no LiteLLM user or link shows "not in LiteLLM" (App Teams spec — *Member sum*).
- **Who:** the three pages stay global-reader only (Access Control — B1-2); a lead has no AWS cost view (decided 2026-11-17).
- **Plan decisions M5-D1 to M5-D7 (agent decisions, 2026-11-18, unit M5; Rule 00.3):**
  - **M5-D1 — The Bedrock figure is the page's own total, organisation-wide.** It is `Σ rows.cost` of the page's own Bedrock route for the range (`/api/teams`, `/api/users`, `/api/services`, with `dateFrom`/`dateTo` only). The Cost by team department filter narrows the table, not the three figures, because LiteLLM and Combined are organisation-wide. On Cost by user and Cost by service the figure is model usage only, like their tables. It shares the query key of the panel's unfiltered request. Reason: D18 "the page's own total for the range"; the Combined card shows its own parts, so no reader needs the three to agree.
  - **M5-D2 — L6's "Combined with LiteLLM" panel leaves Cost by team.** Its *Combined* column held both sources, which D17 forbids. `CombinedTeamsPanel` and its test are removed; `GET /api/litellm/combined/teams` stays with no UI consumer. Team Detail keeps `CombinedTeamCard` (a figure with its parts, not a mixed column).
  - **M5-D3 — Created teams are a second table inside the Bedrock panel.** Teams with `hasAwsAccount === false` from `GET /api/access/org-units` render under the Bedrock table, captioned "Teams without an AWS account", each Bedrock cell "No AWS account", never `$0`, never in the Bedrock table, its sort, % of total or CSV. Reason: `GET /api/teams` and its schema are unchanged, and the Bedrock table and CSV stay rollup-only (Rule 20.3). The client parses org-units with a tolerant local schema (only an explicit `false` counts), so M5 works before and after M2.
  - **M5-D4 — The one-person pointer moves.** The Cost by user note "Combined … under Management → Users" is removed; the LiteLLM panel carries "The range figure for one person is under Management → LiteLLM → LiteLLM users" linking `/dashboard/manage/litellm/users`.
  - **M5-D5 — "Sum of members" on request** (builds on MI-D7, coordinator decision). A per-row button; the read (`GET /api/litellm/teams/[teamId]?include=memberSum`) runs only after the press, so the panel's first load makes no team request (App Teams AT6). Offered on a linked row (with *Why the figures differ*) and on an `open-team` row; not on an unlinked row whose `spend` the Organisation read already summed. Row states: `422 TOO_MANY_MEMBERS` "Too many members to sum (over 200)", `403 OPERATION_DISABLED` "Switched off", `503 LITELLM_UNAVAILABLE` "LiteLLM unavailable", `404` "Team not found"; other errors reach the panel boundary.
  - **M5-D6 — LiteLLM panels draw a table only when they have rows.** Not configured shows "LiteLLM not configured"; empty shows a one-line text. Reason: no empty grid, one table per page in the common empty state.
  - **U-W6 — Role gate (2026-11-18).** `TeamSumOfMembers` has no role check of its own; it relies on the page's global-reader gate (Access Control — B1-2) and the route's own check. The Bedrock-figure estimate mark: on Cost by user and Cost by service the Bedrock figure sums `costEstimated: true` rows and carries the Estimated mark (Rule 20.3); Cost by team stays exact.
  - **M5-D7 — `hidden` visibility draws neither the LiteLLM nor the Combined figure.** Global readers get `show` or `warn` (L6 *Visibility*), so this is defensive. Not configured (`configured: false` or `litellm === null`): the LiteLLM figure reads "Not configured" and there is no Combined figure (a Bedrock-only number is never labelled combined, L6 *States*).

### Settings Page

*Split into tabbed route pages 2026-11-16 (user: "the Settings screenshot is too large; break it down into pages or tabs at the top"; unit D, implementation-phases — *Settings admin area*). The page was one scroll about 12,100 px tall at 1440 wide.*

- **Tabs are routes** (agent decision, 2026-11-16, reason: a route per tab gives deep links, a working Back button and server-side authorization, and renders one group at a time). A tab row sits at the top of every Settings page, built on the existing shadcn `Tabs` (`components/ui/tabs.tsx`; no second Tabs component) with the active tab taken from the route and each trigger a link. The row scrolls horizontally on 375 and never scrolls the page.

  | Tab | Route | Contents | Visible to |
  |---|---|---|---|
  | AWS accounts | `/dashboard/settings/accounts` | Account registry (add/edit/deactivate; `Admin` role; read-only for other members) | everyone with Settings |
  | Sync and data | `/dashboard/settings/sync` | Sync status, Data retention (tag coverage joins here with Phase 4.9b) | everyone with Settings |
  | LiteLLM | `/dashboard/settings/litellm/<section>` | the LiteLLM configuration sections under the sub-tabs below (unit A2, 2026-11-17; formerly the panel's in-page tabs; Team links and Users moved to Management → LiteLLM, D3) ([LiteLLM spec](2026-11-10-litellm.md) — LD24; the panel's edit flags are LiteLLM unit L3d2) | `internal-admin`, `internal-org-admin`, `internal-auditor` |
  | Access | `/dashboard/settings/access/<group>` | the access sections under the sub-tabs below | per `accessCapabilities(viewer)`: at least one sub-tab is visible |
  | Audit | `/dashboard/settings/audit` | Audit log, Access review | `internal-admin`, `internal-auditor` |

- **Index and unusable tabs.** `/dashboard/settings` redirects on the server to the caller's first visible tab (the order above; AWS accounts is visible to everyone, so today every caller lands there). A tab the caller cannot use is not rendered in the row, and its URL returns the same `404` page as a missing one — each tab page authorizes itself on every request (a layout alone is not re-run on soft navigation); roles, grants and scopes are never cached (Rule 60.10). The write routes still enforce the permission matrix (Rule 10.3).
- **LiteLLM sub-tabs** (unit A2, 2026-11-17; a second route-tab row under the LiteLLM tab, the same strip as Access): **Connection**, **Guardrails** and **Gateway** (LiteLLM unit L6, 2026-11-17: the gateway principals and account ids; Admin edits, Auditor and org-admin read only, LD24; LiteLLM spec — *Combined usage and My usage (L6)*) at `/dashboard/settings/litellm/{connection,guardrails,gateway}`, links with `aria-current="page"` on the active one, so the sub-tab is in the URL and Back steps across sub-tabs. *Amended 2026-11-17 (agent decision, management improvements D3; unit M1):* Settings → LiteLLM keeps **configuration only** (Connection, Guardrails, Gateway); **Team links** and **Users** moved to Management → LiteLLM (*LiteLLM teams* and *LiteLLM users* tabs, *Management pages* — *LiteLLM area*), and their old routes `/dashboard/settings/litellm/team-links` and `/dashboard/settings/litellm/users` redirect there (*Routes and redirects*). Previously (superseded 2026-11-17 by D3, Team links and Users moved out): five sub-tabs **Connection**, **Guardrails**, **Team links**, **Users** and **Gateway** at `/dashboard/settings/litellm/{connection,guardrails,team-links,users,gateway}` (four before L6 added Gateway). `/dashboard/settings/litellm` redirects on the server to the caller's first visible sub-tab; an unknown or unusable sub-tab is the same `404` as a missing page; an old `/dashboard/settings/litellm#<section>` link lands on its route. *Agent decisions (2026-11-17, unit A2):* (1) visibility follows `litellmPanelCapabilities(viewer.roles)`: the three roles that see the LiteLLM tab see every sub-tab, read-only where their edit flag is off (LD24: Connection and Gateway edit Admin only; Guardrails and Team links Admin and org-admin; Auditor read-only) — reason: every one of them can read every section today, and hiding a read-only section would remove information LD24 grants (*amended 2026-11-17, LiteLLM L6: Gateway added, read-only for org-admin and Auditor*); (2) one dynamic `[section]` route rather than one page per sub-tab — reason: one authorization path, as `access/[group]`; (3) Team links and Users explain their empty state when no LiteLLM team is linked (gap G7 of the L3b acceptance review), naming who can link a team — they keep it on Management → LiteLLM (D3). *Gap G3 (tab in the URL, Back steps tabs; L3b acceptance review):* closed for Settings by these route sub-tabs; **obsolete for the LiteLLM page**, whose tab row Slice B2 removed — its views are Management sidebar items, each its own route (*Navigation (Sidebar)*).
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
- **Settings small UX (unit ST1; user, 2026-11-18, decisions made 2026-11-23 for the build).**
  - **LiteLLM connection result (D-ST4).** After **Test connection** the section shows a green check and "LiteLLM connection is ok", or a red cross and the error, icon and text together (never colour alone), in an `aria-live` region. The Base URL field offers the value of `LLM_LENS_LITELLM_BASE_URL` (default `http://localhost:4000`) when no connection is saved; the offered value is never saved by itself, and the allowed-hosts rule is unchanged, so `localhost` is still refused where it is not allowed (production). Reason: a first-time admin sees a working example, and the allowlist stays the only gate ([LiteLLM admin guide](../guides/litellm-admin.md)).
  - **Add account (D-ST5).** The form asks for **AWS account ID** (typed, 12 digits: it is the number of the account whose cost is collected, so the server cannot invent it; user, 2026-11-18, "Yes, keep it typed"), and for the **Department** and **Team** by name, or by picking an existing one. The server generates `departmentId` and `teamId` (Data Model — *API Routes*). Picking an existing one uses **Existing department** / **Existing team** selects that fill the name, so the body never carries an id. **Edit account** (coordinator decision, 2026-11-24, review round 1; reason: without picks an account could not move between teams or departments, and editing a name would rename one account's copy of a shared id) gets the same **Existing department** / **Existing team** picks and sends the picked ids in the unchanged PATCH; the name fields follow the picked ids and are not free text. The team pick lists only the picked department's teams, and a department change needs a new team pick: Save stays disabled until one is made (coordinator review round 2, 2026-11-24; reason: a team id never crosses departments, as on create). Renaming a shared team or department is out of scope (`docs/future-improvements.md`). Reason: nobody should type an internal id.
  - **Identity pickers (D-ST2).** In Settings → Access, the identity pickers of Identity links and Person are a search box: at least 2 characters, debounced, at most 10 results, matched on name, email or UPN through `GET /api/identities/directory?q=` (Access Control — *API routes*). Reason: a full directory list does not scale and a person is found by name.
  - **Audit page header (D-ST6).** **Export access review (CSV)** sits in the header of Manage → Audit as a secondary button (one filled primary per view, Rule 40.9); the Access review section keeps its content, including its own export link (agent decision, 2026-11-23, reason: "keeps its content"; the section is outside ST1). This refines the page-action sentence in the *Audit* bullet above.
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
- **Tabs (L3b, 2026-11-16; superseded the same day, user, by the mock-up review):** L3b grouped the page's sections into tabs — *My usage*, *Team*, *Organisation*, *Users*, *Audit* — with the shadcn `Tabs` component and `?tab=` URL state. The tab row is replaced by the **Management** sidebar items, each its own route, and `/dashboard/litellm` (with any `?tab=`) redirects (*Navigation (Sidebar)*, *Management pages*); each view keeps its sections' Suspense + ErrorBoundary and its "LiteLLM-reported" labels (LiteLLM spec — *Views by role*). The *Users* tab and the Settings *Users* tab (moved to Management → LiteLLM → *LiteLLM users*, 2026-11-17, D3, where it opens on a list, D16a) share one search component: a labelled search input, results in a shadcn `Table` (at most 25 rows, so no TanStack paging), a selected user's spend and daily spend below. *Amended 2026-11-24 (LF1): the shared parts are the search results and the user detail (`UserSearch`, `UserDetail`); the LiteLLM users tab draws its own list, with no link-state column (D-LF4) and the linked account shown in the detail, and parses its search with the search schema (D-LF1).*
- **Settings → LiteLLM** (`internal-admin`; `internal-org-admin` edits *Guardrails* and *Team links* and sees *Connection* and *Gateway* read-only, LD24; read-only for `internal-auditor`; tabbed from L3b: *Connection*, *Guardrails*, *Team links*, *Users*, and from L6 *Gateway* — Admin edits, org-admin and Auditor read only, 2026-11-17; **amended 2026-11-17, D3:** *Team links* and *Users* moved to Management → LiteLLM, with the same permissions — *Management pages* — *LiteLLM area* — so the panel keeps *Connection*, *Guardrails* and *Gateway*): connection URL, edition (read-only), service-key status ("configured: yes/no" — no entry, reveal or rotate), connection test result, operation toggles, gateway principals and account ids (L6), team links (link and unlink with an inline confirmation; re-linking is unlink, then link — D4a, 2026-11-18), orphaned LiteLLM members. Per-section edit flags come from one pure helper in `lib/auth/` (`litellmPanelCapabilities`); a read-only section renders no write control at all (no switch, Save, Reset, connection test or link control), so the UI can issue no write the role lacks (LD24; org-admin toggle and team-link writes: LT22).
  - **Guardrails grouping (agent decision, 2026-11-16, unit A1 — G6):** the ~33 operation switches are grouped by operation family, in this order: *Team writes*, *Member writes*, *Key writes*, *Team reads*, *User reads*, *Key and spend reads*, *Proxy reads*, then *Other operations* for any name not mapped (never dropped). Each group has a heading and a one-line description (its accessible description); each row shows the operation's LiteLLM call from the LiteLLM spec's *Reads* / *Writes* tables. Empty groups are omitted; order inside a group and the defaults are unchanged. Reason: a flat list of ~33 switches is hard to scan, and the spec's own tables already split operations by family. (agent decision, 2026-11-18, unit M3: `createUser` sits in *Member writes*, because it builds the same LiteLLM user body as `addTeamMember` and no *User writes* family exists.)

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
- **Team** (`/dashboard/manage/team`; lead for the teams it leads, `internal-org-admin` and `internal-admin` for every team; `internal-auditor` read-only — Access Control). **A list, then one page per team** (unit TM1, 2026-11-23; previously one page) for a team's usage and its management, replacing the LiteLLM *Team* tab and the Settings team membership. `PageHeader`: ~~team selector (nuqs `team`; a lead's list holds only the teams it leads)~~ *superseded 2026-11-23 by* **List, then the team** *(unit TM1, below)* and the `ScopeLine` for a lead; below the header, the view tabs *Members*, *Budgets*, *Keys* (`PageTabs`; amended in B2b, 2026-11-17, to match the build: tabs below the header, not in it). Usage: team budget, members, keys' metadata, model access (the team spend figure moved to *Team usage*, D7, 2026-11-17, user). Management: **New team** (admin, org-admin; D5, D6), member search, **Add member**, **Edit budget**, **Reset spend** (a button at the right of each member row), **Remove member**, and a bulk **"Reset spend for all members"** above the member table.
  - **List, then the team (unit TM1, user item 7, 2026-11-18; D-TM1–D-TM4; review round 1, 2026-11-23).**
    - **The list (D-TM1).** `/dashboard/manage/team` is a table of the app teams the caller may see (a lead: the teams of its team scopes and of its department scopes; a global reader: every registry and created team) with the columns name, department, members and LiteLLM team. A row's name links to `/dashboard/manage/team/[teamId]`. A caller with one team still sees the list first (the user's words). **New team** stays on the list page (D-TM4); on success it opens the new team's page (agent decision, 2026-11-23: the old "selected in the team picker" has no picker to select in).
    - **The LiteLLM team column by role** (coordinator ruling Q-B1, 2026-11-23; the LiteLLM spec withholds the LiteLLM team id from leads — *API routes*): `internal-admin`, `internal-org-admin` and `internal-auditor` see the linked LiteLLM team id; every other caller sees only "Linked" or "Not linked", and the id is not sent to their browser. The id, not the alias, because naming it would add a LiteLLM call per list read and the page adds no LiteLLM call of its own (*Membership* below; LiteLLM spec — LD34) (agent decision, 2026-11-23).
    - **Members** counts bound members only; pending invitations are on the team page's *Pending and stale access* (agent decision, 2026-11-23). The rows are built per request by `lib/manage/team-list.ts` (server-only), for the in-scope teams only (the scope filter runs first, then the member reads; coordinator ruling Q-W1), never cached (Rule 60.10), sorted by team name. One in-scope check serves the list, the `?team=` redirect and the team page (coordinator ruling Q-W2).
    - **The team page (D-TM1, D-TM2).** `/dashboard/manage/team/[teamId]` holds every panel the single page had for the chosen team: the view tabs, the LiteLLM members and the access sections. A team outside the caller's scope, or an unknown id, is `404` with the same body as a missing team (Access Control — *Enforcement*). The team picker, the "Team admins — scope" dropdown and the "Visibility scope" dropdown are removed: the route gives the team, and the access sections take it as a prop. Settings → Access keeps its team and scope dropdowns.
    - **Department visibility on the team page** (coordinator decision Q-B2, 2026-11-23; reason: Settings is closed to leads, so a department lead lost the only place to edit its department's visibility): a caller with `editDepartmentVisibility` for the team's department also sees that department's *Visibility* panel (the setting and the cap) on the team page, through the existing 4R.4 route. A lead with only team scopes, or a lead of another department, does not see it; `internal-admin` and `internal-org-admin`, who already edit every department's visibility, see it too (agent decision, 2026-11-23, TM1 round 2). The Access Control permission matrix is unchanged; this keeps an existing grant reachable.
    - **Pending and stale access (D-TM3).** On the team page it lists that team's member invitations only, with their age and the stale mark; pending admin scopes stay in Settings → Access. The filter runs on the server: `GET /api/access/pending` and `GET /api/access/stale` take an optional `teamId` query (Zod), scoped as before — it narrows the caller's scoped teams to that one and keeps member invitations and affiliations only, never widening; an out-of-scope `teamId` answers an empty list; an empty `teamId` is `400` (agent decisions, 2026-11-23, TM1 round 2: a filter is a narrowing of a readable list, so it reveals nothing, and an empty value is malformed input) — and without it they answer as before (coordinator ruling Q-B3, 2026-11-23: a browser filter over the loaded pages could say "No pending invitations." while the team had some on a later page).
    - **Old links (agent decision, 2026-11-23; reason: the Organisation view, the team-config redirect and several journeys link to `?team=`, and a link must not break).** `/dashboard/manage/team?team=<id>` is a temporary redirect to `/dashboard/manage/team/<id>`, keeping `?view=`; a target outside the caller's scope is `404` there (the B2-3 redirect rule); an empty `?team=` is treated as no team (the list).
  - **Membership** (agent decision, 2026-11-16: the mock-up's member table carries the app membership — role, source "group mapping"/"manual", added date — and Settings → Access hands team membership to this page): the member list is the team's app affiliations with their pending and stale entries (the 4R.4 Members routes), joined with each member's LiteLLM spend and budget when the team is linked. Add and remove act on the affiliation through the existing 4R.4 routes and, where the team is linked and the operation is enabled, on the LiteLLM membership through the L4 routes; an SSO-managed member shows "Managed in Entra" and no remove. The page adds **no LiteLLM call of its own** (Rule 10): every write goes through an existing or L4 Route Handler.
  - **Lead's other team-scoped access actions** (agent decision, 2026-11-16: a lead no longer sees Administration, and the Access Control permission matrix is unchanged, so its team-scope admin grants and its team's visibility setting need a surface): on this page, for a caller whose scope allows it, the *Members* tab marks team admins with a grant/remove action (never on the caller's own scope) and a *Visibility* Panel shows the team setting with "limited by department" hints, both through the existing 4R.4 routes. Settings → Access keeps the same sections for `internal-org-admin` and `internal-admin`.
  - **Write controls arrive with L4** (as components; mounted on the interim team-config page until Slice B, *LiteLLM Page*). Edit budget, reset spend (`resetMemberSpend`, toggle default **off**, LD10) and the LiteLLM member writes are built with LiteLLM unit L4; until the operation is enabled for the caller the control is **absent, not dead** (*LiteLLM Page* — *Controls*).
  - **Confirm destructive actions** (decided 2026-11-16, user): reset spend and remove member open a `AlertDialog` that names the person and the effect — e.g. "Sets j.lee's spend to $0.00. Usage history, cost data and the audit log do not change." (reset-spend text amended 2026-11-24: superseded by D-RS9, *Reset any LiteLLM user*) — with Cancel focused first and the `destructive` confirm button; the bulk reset's dialog states the member count ("Resets spend for 12 members to $0.00. Recorded in the audit log."). Never a browser `confirm()`.
  - **Budget as a bar** (decided 2026-11-16, user): a thin `BudgetBar` under each member and team budget — neutral below 80%, warning from 80%, destructive at or above 100% — with the percentage as text beside it (colour is never the only signal; "No limit" when there is no budget). The member table toolbar gains a **"Near or over budget"** filter (≥ 80%).
  - **AWS-billed cost tile — not built (decided 2026-11-17, coordinator under the user's delegation):** a lead has no "AWS-billed cost" tile; least privilege, and AWS billing is account-level (Access Control — *Navigation and landing by role*).
- **Organisation** and **Users** (`/dashboard/manage/organisation`, `/dashboard/manage/users`): the LiteLLM *Organisation* and *Users* views unchanged in content (LiteLLM spec — *Views by role*), now their own routes. *Amended 2026-11-17 (D2, D15):* Organisation is the first tab of Management → LiteLLM and its old route redirects; Users becomes the app's people page (*Management improvements* below).
- **Audit** (`/dashboard/manage/audit`; agent decision, 2026-11-16: audit is an oversight read used by `internal-auditor`, who holds no configuration, so it sits with the other read views under Management rather than in Administration; one placement, the Settings entry redirects). One page with a **source filter** — *App* (the dashboard audit log, Access Control — *Audit log*) and *Gateway* (LiteLLM's audit, LiteLLM spec — *Audit*) — shown as a segmented toggle in the toolbar (nuqs `source`). It is **composition, not a merged store**: each source keeps its own route, permission and pagination, and a source the caller may not read is not offered. The Access review export is a page action for the roles that may export it. Viewing either source stays audited. Default source *App* when the caller may read it, else *Gateway*; with one readable source the toggle is not shown (agent decision, Slice B2, 2026-11-17). *Gateway on LiteLLM OSS (agent decision, 2026-11-18, unit LF1, D-LF2):* the audit log is an Enterprise endpoint, so the Gateway source shows "The LiteLLM audit log needs LiteLLM Enterprise" (to `internal-admin` and `internal-auditor`, the roles that read it), never "LiteLLM unavailable", which stays for a real outage (LiteLLM spec — *Audit*).
- **Accept a pending invite (unit INV1, 2026-11-18; Access Control — *Accept a pending invite*).** Each pending **member** invitation, wherever pending items show (the Team page access sections and Settings → Access), gets an **Accept** action for the callers of the matrix row. It opens a dialog listing the candidate identities (name, UPN, email; `internal-admin` and `internal-org-admin` may also search the directory), marks where the UPN and email differ from the invite key, takes a required reason, and confirms in an `AlertDialog` naming the person and the team. With no candidate the dialog says so and offers nothing to type (agent decision, 2026-11-18).
- **Team page membership in B2** (agent decision, Slice B2, 2026-11-17: the joined member table needs a read that combines the 4R.4 affiliations with LiteLLM spend, which no route offers yet; reversible): the page shows the app membership (the Access *Members*, *Team admins*, *Pending access* and *Visibility* sections) and the LiteLLM membership (*LiteLLM members*, with `BudgetBar` and the "Near or over budget" filter) as separate panels. The single joined table described under *Membership* above is not built yet. ~~*Interim (coordinator, 2026-11-17, at L5b):* the view tabs and member search are built in unit B2b after L4b.~~ *Superseded 2026-11-17 by* **Team page views and links** *(B2b, below): the view tabs and the member search are built.* The joined member table is still not built; the separate panels are not the end state.
- **LiteLLM members with no app membership (unit RS1, user report 2026-11-18; coordinator decisions D6–D7).** *(Its single **Add to team** action, which always created an invite, is superseded by INV2, 2026-11-24: see the next bullet.)* A LiteLLM member of the linked team who is not a dashboard member of the app team has no `oid`, so it has no row actions (superseded 2026-11-19, RS2: it gains Reset spend and Reset budget, below). Its row shows a short muted note — "Not a member of this team in the dashboard — add them to reset or manage." — and, for a caller who may write members, an **Add to team** action that adds the person to the app team by email through the app-team members route (`POST /api/teams/[id]/members`, as the add-member dialog does; agent decision, 2026-11-18, RS1: the LiteLLM add route needs an `oid`, which this person does not have yet), shown when the members read returns `candidates` (writers only); it opens a confirm dialog naming the email and the team, with Cancel focused first, because the email comes from LiteLLM and is not verified (coordinator ruling R3, 2026-11-18; Access Control D27 precedent) (D6). Matching a LiteLLM member to an app member uses `user_id` or email **and** the identity link, and **an identity-link match takes precedence** over email and usage-identity matches so a row never shows the wrong person (coordinator ruling R2, 2026-11-18): a LiteLLM member whose `user_id` equals a team member's `litellmUserId` matches (D7, so the Team page and the RS1 dialogs find the same people).
  - **Placing a person by hand (unit INV2, 2026-11-24; Access Control — *Placing a person by hand*).** For a caller who may write members, each row carries a state (`signed-in`, `invited`, `unknown`) and the matching action: **Invite** (not signed in; by email), **Add to team** (signed in, no team; by `oid`) or **Approve and add** (an invite exists and the person has signed in; the accept dialog, which replaces the label **Accept invite**). Each opens a confirm dialog naming the person and the team, with Cancel focused first. The accept dialog preselects a target only when exactly one candidate is exact (a UPN match or the LiteLLM link); the reason stays required. This supersedes RS1 D6's single **Add to team** action above, which always created an invite. Readers see no state and no action.
- *Superseded 2026-11-23 by* **List, then the team** *(unit TM1, above): the team page passes the route's team to the access sections as a prop; the `?team=` reading stays only as the fallback when no `teamId` prop is given — today Settings → Access, which has no `?team=`, so its sections open on the first listed team as before.* ~~**Access sections follow the page's team picker**~~ (agent decision, unit C1, 2026-11-17: the *Members* and *Visibility* sections used their own team choosers beside the page's, so the page had two): on the Team page they open on the team in `?team=` and follow it when it changes; an unknown `?team=` keeps the first listed team. Settings → Access has no `?team=` and is unchanged. The page has one team chooser.
- **Team page views and links (Slice B2b, agent decisions, 2026-11-17; reversible):**
  - **View tabs** *Members*, *Budgets*, *Keys* in `PageTabs` (the one `Tabs` component; *Component Inventory*), URL state `?view=` (nuqs, history push so Back steps through views); default *Members*. *Members* holds the LiteLLM members and the app-membership Access sections; *Budgets* holds *Budget and limits* (team spend left the Team page 2026-11-17, D7; "Spent this budget period" stays beside the budget, LD36); *Keys* holds the keys and *Models*. A view the caller cannot use is not rendered, and an unknown or hidden `?view=` falls back to *Members*. **Unlinked team, or LiteLLM `configured: false` (LD37):** only *Members* (no LiteLLM team, so no budgets or keys to show). ~~The team spend stays above the tabs.~~ *Superseded 2026-11-17 (user, D7): `TeamSpendPanel` is removed from the Team page for every role; the member sum with its coverage and member table is on *Team usage*.*
  - **Member search** on *Members*: a labelled search box ("Search members") filtering the loaded member rows client-side by name or email, case-insensitive; "No members match" when nothing matches. No new request. It covers the LiteLLM member rows (combined with "Near or over budget"); the app-membership Access sections keep their own lists.
  - **G1 — member daily spend:** on a linked team, each LiteLLM member row has a "Daily spend" action that opens that person's daily spend for the selected range, read through the existing `GET /api/litellm/users/[litellmUserId]` (a Lead for members of its linked teams in scope, org-admin, Admin, Auditor; LD23 cap applies). No new route or gateway operation. Unlinked teams' member-sum rows have no such action: that route scopes a Lead by linked LiteLLM team membership (deferred — `docs/future-improvements.md`, *Member daily spend on unlinked app teams*). Under the Organisation cap (LD23) the action is hidden, as on the Users page.
  - ~~**G2 — Organisation → team:** each *App teams* row links its name to `/dashboard/manage/team?team=<id>` (from 2026-11-23 a redirect to `/dashboard/manage/team/<id>`, unit TM1) for callers who may open the Team page (every Organisation reader may — admin, org-admin, auditor).~~ *Superseded 2026-11-25 (LP1, D-R3-4; user, Q-R3-1): the App teams table is removed from Organisation; the LiteLLM teams table links a linked app team's name to its team page.*
- **Bulk reset** (agent decision, Slice B2, 2026-11-17): "Reset spend for all members" calls the existing per-member reset route once per member (each audited), shown only when `resetMemberSpend` is enabled; no new route and no LiteLLM call of the page's own.
- **Scope line and date range:** every Management page a scope narrows shows the `ScopeLine` (*Layout* — *Page frame*); the global date range applies to every Management page.

### Management improvements (2026-11-17)

*Added 2026-11-17 (user, management improvements items 1–5 and 9–16; units M1, M2, M3). Decisions D1–D7 and D14–D16a; user decisions are marked; the others are agent decisions (Rule 00.3). Roles: Access Control — *Navigation and landing by role*; LiteLLM data: LiteLLM spec — *Views as Management routes*. The budget reset request, its notifications and the reset counts (D8–D13) are specified by unit M4 in their own sections.*

- **LiteLLM area (D2, agent decision, 2026-11-17, under the user's Management order D1; unit M1).** `/dashboard/manage/litellm/<tab>` with route tabs on the one `Tabs` component (Rule 40.9), each a link with `aria-current="page"`, so Back steps across tabs: **Organisation** (`organisation`: the Organisation view, unchanged in content — LiteLLM spec — *Views by role*, App Teams spec — *Organisation view*), **LiteLLM teams** (`teams`: the team links with the D4a pickers — *amended 2026-11-18 (coordinator decision, M1 review): the Organisation tab's LiteLLM teams table and the links table cover the LiteLLM team list in M1; a separate list view is future work (`docs/future-improvements.md`)* — and **New LiteLLM team** for `internal-admin` only — the existing `POST /api/litellm/teams`), **LiteLLM users** (`users`: the D16a list; ~~with the D16 link states~~ *superseded 2026-11-18, LF1 D-LF4: the table has no linked-account column, the link state is in the user's detail*). *LiteLLM teams in this area (agent decision, 2026-11-18, unit LF1, D-LF3):* a "LiteLLM team" is a team that exists in LiteLLM (`listTeams`), linked or not; the LiteLLM teams table lists those only, and an app team with no LiteLLM team is not shown there (its spend source stays on the Organisation tab, App Teams spec — *Organisation view*) *superseded 2026-11-25 (LP1): the Organisation tab no longer lists app teams; a member-sum team's source and `open-team` row are on Cost by team → LiteLLM panel and Team usage*. Such an app team can still be chosen in the link form and in **New LiteLLM team** (admin only). `/dashboard/manage/litellm` redirects on the server to the first visible tab. Visible to admin, org-admin and auditor (read-only: no write control renders); a lead and a user get no item and every LiteLLM-area URL is the missing-page `404`. Each tab page authorizes itself per request; each section has its own Suspense and ErrorBoundary. Reason for routes over `?tab=`: the same as the Settings tabs (server authorization, deep links).
- **D4a — Team link pickers (agent decision, 2026-11-17; item 15).** In the team link form both ids are chosen from a list, never typed: "Team" lists every app team (registry teams and created teams, D5) by name, the id as secondary text; "LiteLLM team" lists every LiteLLM team by alias with its `team_id`. A team or LiteLLM team that already has a link shows "linked" and cannot be chosen (one-to-one). Both lists are searchable comboboxes (keyboard and screen-reader operable). The lists come from existing reads: app teams from `GET /api/access/org-units` (registry and created teams), LiteLLM teams from `listProxyTeams`, exposed as an additive optional `litellmTeams` (`{ litellmTeamId, alias }[]`) on `GET /api/litellm/team-links` (LiteLLM spec — *API routes*); no new LiteLLM operation and no new route. If the LiteLLM team list cannot be read, the form says "LiteLLM teams could not be loaded" and offers no free-text fallback. The server still validates both ids and answers `409` on a duplicate: the list is a convenience, never the control. Reason: typed ids were error-prone, and a picker cannot widen what the server accepts. *Re-linking (agent decision, 2026-11-18, M1): because a linked team cannot be chosen, changing a link is unlink, then link; the old single re-link write is gone from the form.*
- **Team usage (D7, user, 2026-11-17; units M1 (item), M2 (page)).** `/dashboard/team-usage`, third Usage item. *Until M2 lands the page, the item is hidden behind `TEAM_USAGE_ROUTE = false` in `lib/nav.ts` and is absent from `NAV_GROUPS`, so nothing links to a missing page; M2 sets it to `true` (coordinator ruling, 2026-11-18, M1). Done 2026-11-18 (M2 merge): `TEAM_USAGE_ROUTE = true`; in `NAV_GROUPS`.* It shows what the Team page's `TeamSpendPanel` showed: for a linked team the LiteLLM-reported team spend for the range, the daily spend and the `BudgetBar`; for an unlinked team the member sum with its coverage line and member table (App Teams spec — *Spend source*, *Member sum*), all labelled "LiteLLM-reported". It reads the existing `GET /api/litellm/teams/[teamId]` (no new route). A team picker (nuqs `team`) appears when the caller can open more than one team; for a lead it lists only the teams in its team scopes and the teams of its department scopes, and for a global reader (admin, org-admin, auditor read-only) every team, registry and created (MI-D7, coordinator decision, 2026-11-17, under the user's delegation: they already read every team). For a global reader on a linked team the page also offers the second figure "Sum of members" on request, with the *Why the figures differ* text (`include=memberSum`, App Teams spec — AT6); the Organisation tab's `open-team` row links here (`?team=<id>`) *superseded 2026-11-25 (LP1): the Organisation tab no longer lists app teams; a member-sum team's source and `open-team` row are on Cost by team → LiteLLM panel and Team usage*. A lead still sees no AWS-billed figure (decided 2026-11-17). The item and the page follow one flag, `teamUsage` (Access Control — *Navigation and landing by role*, MI-D7): the item is shown to every caller who may open the page, a global reader without a scope included, and absent (with the route `404`) for everyone else.
- **Where each role reads team spend after the change (D7, 2026-11-17).** One page per role for each figure, one route per figure (the user's reason for item 5: "it is already covered under usage options"; global readers on Team usage: MI-D7, coordinator decision, 2026-11-17):

  | Figure | admin | org admin | auditor | lead | user |
  |---|---|---|---|---|---|
  | An app team's LiteLLM-reported spend (linked: the LiteLLM team; unlinked: the member sum) | Cost by team → LiteLLM panel; Team usage (any team); ~~LiteLLM → Organisation (*App teams*)~~ *(removed 2026-11-25, LP1, D-R3-4)* | same | same, read-only | **Team usage**, for the teams in its scope | — |
  | "Sum of members" on a linked team (second figure), or on an `open-team` row | Cost by team → LiteLLM panel, on request; Team usage (the `open-team` link lands here) | same | same | — (LT28) | — |
  | Every LiteLLM team's spend | LiteLLM → Organisation (*LiteLLM teams*) | same | same | — | — |
  | A team's AWS-billed (Bedrock) cost | Cost by team → Bedrock panel; Team Detail | same | same | — (no AWS cost view) | — |
  | Combined (L6) | Cost by team, the three figures | same | same | — | — |
  | Team budget and "Spent this budget period" | Team → *Budgets* | same | same, read-only | Team → *Budgets*; Team usage (`BudgetBar`) | — |
  | Own usage | My usage | My usage | My usage | My usage ("Team lead is also a user", user) | My usage |

  ~~A global reader who also holds an admin scope gets Team usage for those teams as well.~~ *Superseded 2026-11-17 (MI-D7, coordinator decision under the user's delegation): a global reader gets Team usage for every team, with or without a scope.*
- **New team (D5, D6; unit M2).** On Management → Team, a **New team** button (admin, org-admin; absent for everyone else) opens a dialog: name (1–80 characters, trimmed) and department (a picker of the registry departments, `GET /api/access/org-units`). ~~On success the new team is selected in the team picker.~~ *Superseded 2026-11-23 (unit TM1): New team is on the list page and on success opens the new team's page.* A created team has no AWS account: Usage pages show "No AWS account", never `$0`; its LiteLLM spend is the linked LiteLLM team's, else the member sum. Create only; rename and delete are in `docs/future-improvements.md`.
- **Users (D15, agent decision, 2026-11-17; unit M3).** Management → Users holds the **people list** (name, email, sign-in method, team, LiteLLM link state; `GET /api/identities/directory`, Access Control — *API routes*) ~~and the existing user search~~ (superseded 2026-11-24, unit US1: *The users table* below), plus one **Add user** action that composes existing writes as steps: (1) pre-SSO only, create a password user (`POST /api/password-users`, `internal-admin`, recent authentication, setup link shown once); (2) optionally, a team: a pending member by email through the Members route (`POST /api/teams/[id]/members`); (3) optionally, a LiteLLM user link (D16). A step is shown only to a caller who may do it, so an org-admin sees steps 2 and 3, and under Entra step 1 is absent (a person is never created in the app; they appear at first sign-in). No new user store and no new permission. Reason: every step already exists; composing them gives one entry point without widening any write. (agent decision, 2026-11-18, unit M3: the Add user dialog runs steps 1 and 2 in order in one submit and treats step 3 as the row's LiteLLM link action, because a freshly created password user has no identity to link until first sign-in; the step flags come from `addUserStepsFor` on the server from the effective roles; *Create and link* on this page follows the edition, shown unless `APP_ENV` is `prod`, and the route's toggle gate still answers.)
- **The users table (unit US1, 2026-11-24; user items 8, 9, 10, 2026-11-18; D-US1, D-US2, D-US3, D-US4, D-US5, D-US5a, D-US2a, D-US3a).** Management → Users opens on the **People** table. The page's separate *Search LiteLLM users* section is removed (the D15 line above marks its user search superseded, 2026-11-24, US1, D-US1); the same lookup stays on Management → LiteLLM → *LiteLLM users*, for the same three roles. The People panel carries its own search box in its header (the *LiteLLM users* tab is the pattern): debounced, at least 2 characters, at most 10 matches by name, email or UPN through `GET /api/identities/directory?q=` (Access Control — *API routes*); while a search is active the table shows the matches, without paging. Columns: name, email, sign-in method, team, **Created** (the record's `createdAt` as a UTC date) and **Last sign-in** (`lastSignInAt`, UTC date), and the LiteLLM link state; an empty value is "—" everywhere on the page (Created on a record written before US2 included). Name, email, Created, Last sign-in and team are sortable: the sort runs on the server (`sort`, `dir`), lives in the URL (nuqs `sort`, `dir`; default name ascending) and a sort change returns to the first page. Each sortable header is the shared `SortableHeader` (`components/tables/`; D-US4, reused by SRT1): a button inside the `th`, which carries `aria-sort` (`ascending`, `descending`, or `none`), with a Lucide arrow that is not the only signal. Each row's name links to `/dashboard/manage/users/[oid]` (the user page; D-US5). Over 2,000 people the panel says the list is truncated. The row actions (Add user, Link, Unlink, Reset spend) are unchanged for each role, and the Add user steps keep following the sign-in mode (`addUserStepsFor`; D-US5a, unchanged by US1). Reason: the user asked for the table first, a created date and server sorting; a server sort over a bounded list keeps paging correct.
- **Sorting in the other tables (unit SRT1, 2026-11-24; user item 10, 2026-11-18; D-SR1, D-SR2).** A table a person scans by column sorts with the one `SortableHeader` (`components/tables/`, `sortKeys` per table; no second header component). Tables paged by the server sort in the API: Management → LiteLLM → *LiteLLM users* (email and spend; spend is not offered when per-user cost is hidden or capped, LD23; with no sort the page keeps LiteLLM's own order) and the audit log, app and gateway sources (time, both directions, newest first on the gateway source and oldest first on the app source by default, as today). Fully loaded tables sort in the browser: the team list, the LiteLLM teams tab and the AWS accounts registry; the order is stable (ties keep the server's order) and survives a refetch, and a lead's team list offers no sort on a column a lead does not see. The sort lives in the URL (nuqs `sort`, `dir`) like the users table. No new read and no new permission (D-SR2). Reason: a person scans these tables by column; a server sort keeps paged lists correct, and a browser sort of a fully loaded list needs no new read.
- **The user page (unit US2, user item 16, 2026-11-18; D-US6–D-US11).** `/dashboard/manage/users/[oid]` shows one person; each row of the people list links to it (US1). It is open to `internal-admin`, `internal-org-admin` and `internal-auditor`; anyone else, and an unknown `oid`, gets the missing-page `404`.
  - **What it shows (D-US6).** Name, email, UPN, how they sign in, created and last sign-in; linked accounts (usage identities and aliases, and the LiteLLM user link); team and role (member or lead). The data comes from one read, `GET /api/identities/[oid]` (Access Control — *API routes*).
  - **Blocks by role (D-US11, D-US12; R5: each block follows the capability that guards it in Settings today).** Usage identities and aliases: admin edits (`identityLinks`), auditor and org-admin read. Global roles: admin edits (`roleGrants`), never its own; auditor and org-admin read. The org-admin read is **the user's decision for this page only** (D-US11, 2026-11-23: "Yes"; wider than Settings, where an org-admin sees neither; the write routes stay `internal-admin` only and the `roleGrants` and `identityLinks` capabilities are unchanged). A password user's SSO reference and "Signs in with SSO since" follow `passwordUsers` (admin and auditor read; an org-admin sees only "Signs in with a password"; D-US12). A block a caller may not see is absent from the page and from that caller's response. The LiteLLM link and **Unlink** follow the LiteLLM user links (admin and org-admin edit, never their own; auditor reads); **Reset spend** opens RS1's dialog for admin and org-admin; moving or removing the team membership and granting or revoking lead follow `moveMember` and `teamAdmins` (admin and org-admin edit, auditor reads). On one's own page there is no role edit and no link write.
  - **Every edit uses a route that exists (D-US7),** with that route's own rules; the page adds no permission, and a caller sees only the actions they may use.
  - **Name and email (D-US8).** For an SSO person they come from Entra at every sign-in and are read-only with that note. For a password user the **name** is editable (`PATCH /api/password-users/[email]` with `displayName`, `internal-admin`, audited); the email is their sign-in key and is not editable — remove and add the user (user, 2026-11-18).
  - **No LiteLLM user or member is created or removed here (D-US9);** the LiteLLM actions shown are Unlink and Reset spend *and Link, for a match or an existing user (2026-11-25, UP1, D-R3-13; Link to an existing user was already there, D-US7)*.
  - **Sign-in modes (D-US10; user, 2026-11-18).** The page shows how the person signs in. For a password user it also shows, read-only, the SSO reference (expected UPN, expected Entra id) and, once bound, "Signs in with SSO since <date>". Password reset, TOTP reset, disable and delete stay in Settings → Access → *Password users*, which the page links to (for the callers who see that section).
  - **Agent decisions (2026-11-24, US2 red; reversible).** The read carries the `version` each existing write route needs (the membership, the LiteLLM link — `0` when none —, each lead scope and each role grant), so an edit sends the version it was shown and a stale one is `409` as today. **Make team lead** targets the person's member team (`POST /api/teams/[id]/admins`); a person with no team has no such action, and department scopes are granted in Settings → Access as today. "Signs in with SSO since" shows the UTC date (`YYYY-MM-DD`, the format of the other dates on the page). The page and the route share one server-only builder (`lib/manage/user-detail.ts`). The read lists each global role grant with its role, grant date and version, not its free-text reason (the reason stays in the audit log and Settings → Access → *Role grants*). A password user already bound to SSO is not renamed here (`409`, as enable and disable; the name then comes from Entra). An identity with no stored `createdAt` (items written before it was recorded) shows "unknown". The name edit trims the value, refuses control characters, takes the password user's `version` (the read carries it when the name is editable; a stale one is `409`), and audits the old and new name; it is not offered for a password user already bound to SSO (coordinator rulings Q-B1 and R1, 2026-11-24). An identity's `createdAt` is written once, at its first sign-in (`if_not_exists`), and kept by later sign-ins (coordinator ruling Q-B2, 2026-11-24). **Make team lead** grants the scope to that exact person on their member team by sending the identity's `oid` (`POST /api/teams/[id]/admins` with `{ oid }`: a real grant now, through the route's existing permission, scope and own-identity checks and its one audit record) — never an email or UPN, which that route turns into a pending item and which another identity could match (coordinator ruling R2 (a), 2026-11-24, superseding the same day's "UPN for an Entra identity" wording, because a UPN created a pending lead instead of a lead; the "no Make team lead without a UPN" rule goes with it). A missing `createdAt` or last sign-in shows "unknown" (and "Never signed in" for a missing last sign-in). The page decodes its `[oid]` segment once before validating it (`parsePageIdParam`), because Next passes page params percent-encoded while Route Handlers get them decoded; a password user's `local:<uuid>` oid would otherwise be `404` (agent decision, 2026-11-24, US2 round 2; the route keeps its decoded value and does not decode again). The other dynamic pages have no reserved characters in their ids today.
  - **Known limits (coordinator rulings, 2026-11-24).** (1) A role grant that needs recent authentication, started on this page with Entra, returns to Settings → Access → *Role grants* after "Confirm it's you" (the existing step-up return, Access Control — *Recent authentication*); returning to the user page is future work (`docs/future-improvements.md` — *Step-up return to the user page*). (2) The rule that a person never edits their own global roles is enforced in the page only (the `allowed` flags of the read); `POST /api/role-grants` has no server-side self rule today, while the last-admin invariant stays atomic (Access Control — *Enforcement* item 8). A server-side self rule is future work (`docs/future-improvements.md` — *Server-side self rule on role grants*).
  - **Deleting is not erasing (user, 2026-11-18).** Deleting a password user or removing a link leaves usage rollups, the budget-reset ledger, audit records and LiteLLM spend untouched.
- **Sync from LiteLLM (user, 2026-11-18: "the user from litellm must be sync to management users"; unit SYNC1; Access Control — *LiteLLM user sync*; the sign-in modes there apply).** Management → Users has a **Sync from LiteLLM** button for admin and org-admin, absent when `syncLiteLLMUsers` is off. It opens a dialog that loads the preview and shows: the counts (to link, to add as pending, already linked, skipped, memberships to add), the rows by outcome with the first 25 of each and "Show more", each skip with its reason in words, and the drift list. **Apply** runs it and shows the result per outcome; **Continue** appears while changes remain. A truncated plan says so and cannot be applied (agent decision, 2026-11-18, review change V1). The result names the people the sync did not place (`multiple-teams`, `other-team`, no linked team), with a link to the Users list. "LiteLLM not configured" and "A sync is already running" are states, not errors. The error states are `PLAN_CHANGED` ("The plan changed — review it again"), `SYNC_RUNNING` and `PLAN_TRUNCATED`. The primary button is **Apply**; one per view. The dialog's text calls the dashboard-side deletion "clean-up of dashboard placeholders"; it never says LiteLLM users are removed, because the sync never writes to LiteLLM.
  - **Not signed in yet.** People known only from LiteLLM are listed in their own panel, **Not signed in yet**, under the People table, read from `GET /api/identities/pending-links` (admin, org-admin, auditor), with their email, LiteLLM user id and, when set, the team they will join; admin and org-admin can **Remove** one. *Reason (combined plan, 2026-11-18): unit US1 rebuilds the People table and its route in the same wave, so these people are not rows of that table.* A person removed from LiteLLM who is already linked shows "Not in LiteLLM" and keeps the link. The per-person actions of this panel (**Invite**; **Add user** without SSO, with the hint "Add them as a user to let them sign in") belong to unit INV2 and follow the sign-in mode (Access Control — *The two sign-in modes*, SM6). *INV2 (2026-11-24):* with SSO the row offers **Invite**; without SSO it offers **Add user** (the existing dialog, email filled in, `internal-admin`) and **Invite** with the hint "Joins at first SSO sign-in". On the People table and the user page, the same row actions as the Team page (**Invite**, **Add to team**, **Approve and add**), from one set of components; **Add to team** opens a team picker that lists only the teams the caller may add members to. The sync result links to the Users list filtered to the unplaced people.
  - **Skip reasons, in words:** `no-email` "No email in LiteLLM"; `duplicate-email` "Two LiteLLM users have the same email"; `ambiguous-identity` "Ambiguous: two dashboard users share this email, or the Entra id and the email point at different people"; `privileged` "LiteLLM admin user"; `service-user` "Service user"; `claimed` "Already linked to someone else"; `identity-linked-elsewhere` "Already linked to another LiteLLM user"; `own-identity` "Your own user"; `multiple-teams` "In more than one team linked to LiteLLM"; no linked team "Not in any team linked to a LiteLLM team"; `other-team` "Already in another team"; `removal-guard` (a run note, not a person: "Clean-up paused: too many placeholders would be removed"; agent decision, 2026-11-24, wording only). *Agent decisions (2026-11-24, unit SYNC1 G-ui; reasons in brackets):* the wording of `duplicate-email`, `ambiguous-identity`, `claimed`, `multiple-teams` and the no-linked-team case above is the dialog's [the component tests match "same email", "ambiguous"/"different people", "already linked to someone" and "more than one team"]; **Continue** re-reads the preview and applies against the new plan hash [the first batch changes the plan, so the old hash would answer `PLAN_CHANGED`]; the dialog parses the plan and the result strictly with the shared `LiteLLMSyncPlanResponseSchema` and `LiteLLMSyncResultSchema` (Rule 10.4; supersedes the loose row parsing) and takes every person's email from the preview by LiteLLM user id [result rows carry no email in the shared schema]; Remove in **Not signed in yet** has no confirm dialog [a pending link is a placeholder the next sync recreates]; the sync button sits in the People panel's actions, rendered from one server-computed `canSync` prop on `UsersPeoplePanel` (supersedes the header-actions placement, 2026-11-24; the route still decides the write).
- **LiteLLM users tab (D16a, agent decision, 2026-11-17; item 16; unit M3).** Opens on a **list** with one filter, **All users** or **Members of one team** (a team picker), and the search box, which narrows the list. Columns: user, email, spend, budget and teams (as the search shows today); ~~and the D16 link state~~ *superseded 2026-11-18, LF1 D-LF4*. *All users* pages through LiteLLM's user list on the server, 25 a page (`searchUsers` with no search text; LiteLLM spec — *Reads*); never "load everything". *Members of one team* ~~lists the app team's members (the affiliations)~~ *superseded 2026-11-18, LF1 D-LF3*: the picker lists LiteLLM teams only (D-LF3), and a picked LiteLLM team lists its members: through the stored link to an app team when there is one (the app team's members, each with their LiteLLM user through the stored link, else the email lookup), else the proxy-team members read (`GET /api/litellm/proxy-teams/[litellmTeamId]/members`, RS2); a member with none is "not in LiteLLM", never `$0`; for a linked team the LiteLLM team's own members are listed too, so an orphaned LiteLLM member is visible. Per-user cost stays hidden under the Organisation cap (LD23). The reads stay inside the LD34 call budget. Management → Users is about app users; this tab is about LiteLLM users (the two pages differ on purpose). (agent decision, 2026-11-18, unit M3: ~~the tab reads the caller's `oid` and claim roles from `GET /api/me` to hide the link controls~~ *superseded 2026-11-18 (coordinator ruling F1, M3 review B3):* the link controls follow the server-computed `mayLink` of `GET /api/litellm/users` (effective roles: claims plus stored grants, Access Control — *Enforcement* item 1); `GET /api/me` supplies only the caller's `oid`, for the own-row rule (no controls while it is unknown); *Create and link* follows the list response's `enabledOperations` (`createUser`, already edition-gated; from unit LW1, 2026-11-18, also absent when SSO is enabled, user: create and link "only when SSO is not enable"); the list is page-numbered with Previous and Next.) *LF1 decisions (agent decisions, 2026-11-18, unit LF1; reasons from plan 2026-11-18 §3 LF1):* **D-LF3 (items 4, 5)** — a "LiteLLM team" is a team that exists in LiteLLM (`listTeams`), linked or not. The team picker of *Members of one team* and the LiteLLM teams table list those only; an app team with no LiteLLM team is not shown there (its members stay on Management → Team, its spend source stays on the Organisation tab) *superseded 2026-11-25 (LP1): the Organisation tab no longer lists app teams; a member-sum team's source and `open-team` row are on Cost by team → LiteLLM panel and Team usage*. An app team with no LiteLLM team can still be chosen in the link form and in **New LiteLLM team** (admin only). RS2's members action and panel stay on every remaining teams-table row. Reason: the page is about LiteLLM; the Organisation view's two tables are the precedent. **D-LF4 (item 15)** — the table has no linked-account column; each row keeps its buttons (Link/Unlink for admin and org-admin, never on one's own row; RS2's *Reset spend* on every row). The linked account and its link state are shown in the user's detail (the selected user's panel). Reason: the column duplicated the detail and crowded the row. **D-LF1 (items 2, 3)** — one response schema per route, exported from `packages/shared` and parsed by both the route and the client (Rule 10.4); the all-users list and the search do not share one URL with two shapes: if they share a URL, the search has its own response schema and query key. A field LiteLLM may omit (for example a user's usage, spend and budget fields on `/user/info`) is optional or nullable in the gateway schema, and the usage section renders an absent value as "—", never an error. Reason: both defects were a client schema that did not match what the route returns. D-LF2 (the audit read's Enterprise state) is in the LiteLLM spec — *Audit*. *LF1 implementation decisions (agent decisions, 2026-11-24, unit LF1, part G1; reasons in brackets):* **(a) Item 2's cause** — LiteLLM's `/user/info` types the `keys` and `teams` rows as open objects, and the gateway's key-row schema required `token`, so one key row without it failed the whole read (`503`, "expected string, received undefined" at `keys[0].token`); a row without a token hash is now left out of that read (it cannot be shown or acted on), and `user_info` is an open object or `null`, so `spend`, `max_budget` and `user_email` may all be absent. **(b) Absent spend** — the user detail route answers `spend: null` when `user_info` carries none (the schema is `number | null`, optional; never an invented `0`; `maxBudget` stays `null`, "No limit"); under the Organisation cap both are omitted (LD23). The client shows `null` as "—" and an omitted value as the cap's hidden text. [Two states, two texts: not reported is not hidden.] **(c) The picker's LiteLLM teams** — they come from `GET /api/litellm/org` (`litellmTeams`: `alias`, `litellmTeamId`, `linkedAppTeam`), the route that already lists LiteLLM teams, linked or not, for the global readers who see this tab; no new route. A linked team asks `GET /api/litellm/users?team=<app team id>`; an unlinked one asks the proxy-team members read and filters its members by the search text in the browser (that read has no search). Rows of the proxy-team read carry no link data and no write flag, so they show no link buttons (fail closed). **Reset spend there (LF1 F1, agent decision 2026-11-24):** the page passes the server capability (`editTeamLinks`: admin and org-admin, as the teams table's members panel gets `canEdit`) as the `canReset` prop, so a LiteLLM team with no app team keeps Reset spend for those roles (RS2: every row), the auditor none, never on one's own row, absent when neither reset operation is on. Reason: the members read carries no write flag, and RS2 puts Reset spend on every row. An empty value reads "—" (never "-"). **(d) Search rows** (`GET /api/litellm/users?q=` without `team=`) answer the search shape (`LiteLLMUserSearchResponseSchema`, now with `mayLink`, `false` when absent) and carry no link data and no paging: the tab shows no Previous/Next for a search, and a search row's detail has no linked-account line; Reset spend stays on a search row when `mayLink` is true (RS2), except on the caller's own row. **Own row on search (agent decision, 2026-11-24, LF1 review round 1):** Reset spend is hidden on the caller's own row everywhere (list, proxy-team members, search); a search row carries no app person, so the search answer carries `callerLitellmUserId` (the caller's stored LiteLLM user link read per request, never cached, `null` when unlinked) and the row whose LiteLLM user id equals it is the caller's. Reason: consistency with the other views; the server still refuses a self reset. `include=links` is removed from the route. *Superseded 2026-11-25 (LP2, D-R3-8): the selected user's in-place detail ("User usage" under the table) is replaced by the LiteLLM user page; T-LF1 and T-LF5 hold on the page (see LiteLLM users tab, round 3).*
- **Create and link follows the gate (unit LW1, user, 2026-11-18: create and link "only when SSO is not enable"; LiteLLM spec — *`createUser`*).** The "Create and link" button is absent whenever `createUser` is unavailable: on the *LiteLLM users* tab and on the Management → Users people rows, from the list response's `enabledOperations` (Enterprise, a switch turned off, or SSO enabled). In Settings → LiteLLM the `createUser` operation shows the state "Not available with SSO" with its switch disabled when SSO is enabled; who may switch is unchanged (LD24). *Add member* and *Remove member* are unchanged. *Renamed 2026-11-25 (UP1, D-R3-11, user): the button reads "Create LiteLLM user" (superseded: the label "Create and link"); the gate is unchanged.*

*Tests (T-LF1–T-LF5; source: this section, plan 2026-11-18 §3 LF1).*

| Test | Proves |
|---|---|
| T-LF1 | Item 2: a LiteLLM user with no usage fields renders the usage section with "—" and no error |
| T-LF2 | Item 3: the search response parses with the schema the route exports; a contract test fails when a client schema differs from its route's; the lead's search rows are still filtered server-side after the LiteLLM call, and per-user cost stays hidden under LD23 |
| T-LF3 | Item 14: OSS shows the named Enterprise state; an outage shows "LiteLLM unavailable" |
| T-LF4 | Items 4, 5: an app team with no LiteLLM team is absent from the dropdown and the table, is still choosable in the link form and in New LiteLLM team, and RS2's members action stays |
| T-LF5 | Item 15: no linked-account column; the detail shows it; RS2's Reset spend and Link/Unlink stay |

- **LiteLLM client requests (unit FX1, user report 2026-11-25; D-R3-16,
  D-R3-18).** A client asks a LiteLLM route with the query that route
  requires and parses the answer with the schema that route answers with
  for that query (D-LF1). Three places did not: Cost by user parsed the
  list answer of `GET /api/litellm/users` with the search schema; the user
  detail and the "Members of one team" picker sent no date range to routes
  that require one. The contract test renders every component that requests
  `/api/litellm/**` and checks both the query and the schema; a component
  that is not covered fails it. An e2e stub for a route with a required
  date range answers `400` without one.

  | Test | Proves |
  |---|---|
  | T-FX1 | Cost by user: a list-shaped answer renders the LiteLLM users; spend is "Hidden" under the cap |
  | T-FX2 | The user detail request carries the URL date range; the detail renders |
  | T-FX3 | The team picker request carries the URL date range; the picker lists the teams |
  | T-FX4 | For every component request to `/api/litellm/**`: the query parses with the route's query schema and the client schema is the route's for that query; an uncovered caller fails the test |
  | T-FX5 | E2E, stubs that refuse a missing date range: click a user, choose "Members of one team", open Cost by user — no alert |

- **LiteLLM teams tab, round 3 (unit LP1, user, 2026-11-25; D-R3-5,
  D-R3-6; Q-R3-1, user, 2026-11-25: remove the whole App teams table from Organisation).** "Search teams" is a `SearchInput` and filters the team links
  and the LiteLLM teams table by team name, alias and id, case-insensitive,
  in the browser; "No matching teams" when nothing matches. Each LiteLLM
  team's name links to its page.
- **LiteLLM team page (unit LP1, user, 2026-11-25: "a page with the team
  info, spent, members, team lead name"; D-R3-7, D-R3-9).**
  `/dashboard/manage/litellm/teams/[litellmTeamId]`, for `internal-admin`,
  `internal-org-admin` and `internal-auditor`; anyone else, and an unknown
  id, gets the missing page. It shows: alias and id; spend and budget with
  a `BudgetBar` and the budget's reset time; the models; the members (the
  existing members read, at most 200, with Reset spend and Reset budget
  where RS2 gives them); and the linked app team with its lead names, or
  "Not linked to a dashboard team". Read: `GET
  /api/litellm/proxy-teams/[litellmTeamId]` (LiteLLM spec — *API routes*).
  Under the Organisation cap spend and budget are omitted. A breadcrumb
  leads back to the tab.

  | Test | Proves |
  |---|---|
  | T-LP1 | "Search teams" has the magnifier and a visible label; typing filters both lists by name, alias and id; "No matching teams" |
  | T-LP2 | Organisation shows no App teams table and no "Rows overlap" sentence; `appTeams[]` is still in the route's answer; a linked app team's name links to its team page |
  | T-LP3 | The new read: role table (admin, org-admin, auditor `200`; lead `403`; member `403`; unauthenticated `401`); unknown id `404`; invalid id `400`; `getTeam` off → `403` before any call; LD23 omits spend and budget; no key and no secret in the answer |
  | T-LP4 | The page: summary, `BudgetBar`, members, linked app team and lead names; an unlinked team says so; an unknown id and a lead get the missing page |
  | T-LP5 | The team names in the teams tab and the Organisation table link to the page; E2E per reading role; axe at 375px and desktop |

- **LiteLLM users tab, round 3, and the LiteLLM user page (unit LP2, user,
  2026-11-25: "in a new page, no under the user table, also if is linked to
  any app user and team"; D-R3-8, D-R3-9).** "Search users" is a
  `SearchInput`; a term of one character shows the hint "Type at least 2
  characters" (the search starts at two; the user, 2026-11-25: "should
  display results"), and a term that matches nothing shows "No users
  found". The user cell of each row links to
  `/dashboard/manage/litellm/users/[litellmUserId]`, for the same three
  roles; the detail that opened under the table is removed (superseded:
  the in-place "User usage" detail of M3 and LF1). The page shows: user id
  and email; spend and budget; daily spend for the range; the combined
  figure (L6); the user's LiteLLM teams, each a link to its page; and the
  linked dashboard person with their team (a link to the user page), or
  "Not linked to a dashboard user". Reset spend and Link / Unlink are there
  for the callers who have them on the tab today. The user page's LiteLLM
  block and the Team page summary link to these pages for the three roles
  only. A lead keeps the member dialog on its Team page (G1).

  | Test | Proves |
  |---|---|
  | T-LP6 | "Search users" has the magnifier; one character shows "Type at least 2 characters"; a longer term narrows the list, and "No users found" when nothing matches |
  | T-LP7 | The detail read returns `teams[]` and `appUser` to the three global roles and neither to a lead; the route's role table and LD23 are unchanged |
  | T-LP8 | The page: identity, spend, budget, daily spend, teams, the linked person and their team, or "Not linked to a dashboard user"; an unknown id and a lead get the missing page |
  | T-LP9 | The user cell links to the page; nothing renders under the table; Reset spend and Link / Unlink work from the page for the roles that have them |
  | T-LP10 | The user page and the Team page summary link to the LiteLLM pages only for the three global roles |

- **Users, round 3 (unit UP1, user, 2026-11-25; D-R3-10 to D-R3-13).**
  - "Create and link" is renamed **"Create LiteLLM user"** (superseded:
    the label "Create and link", LW1 and D16; the gate of LW1 is unchanged).
  - The "Match found" badge is removed (superseded: the badge of D16,
    2026-11-17). A match shows the LiteLLM email and **Link**.
  - In the People table the name is a visible link, and a click on a row
    opens the person's page; a click on a control in the row does not.
  - The user page's LiteLLM block shows what the list shows for that
    person: linked, a match (the email and **Link**), or "No LiteLLM user
    with that email". The match is returned by `GET /api/identities/[oid]`
    only to a caller who may link (`internal-admin`, `internal-org-admin`);
    an auditor sees "Not linked". No LiteLLM user is created on the page
    (D-US9).
  - For a linked person the page has a **LiteLLM usage** block: spend and
    budget, from `GET /api/litellm/users/[litellmUserId]` with the URL date
    range; omitted under LD23. The person's LiteLLM teams are on the
    LiteLLM user page (unit LP2), which this block links to for the three
    global roles.
  - The profile's edit control is a labelled button, "Edit name".
  - `FieldHelp` texts:

    | Field | Text |
    |---|---|
    | Create LiteLLM user | Creates a user in LiteLLM with this person's email and links it to this person. It sets no team, key or budget. |
    | Link to an existing LiteLLM user | Connects this person to a LiteLLM user that already exists, so their LiteLLM spend shows here. Nothing changes in LiteLLM. |
    | Link (a match) | A LiteLLM user has the same email. Link connects the two after you confirm. |
    | LiteLLM (column) | Whether this person is connected to a LiteLLM user. Their LiteLLM spend and budget show only when they are. |
    | Sign-in | How this person signs in: Microsoft (SSO), a password managed here, or the local developer sign-in. |
    | Sync from LiteLLM | Reads the users LiteLLM has and links or lists them here. It writes nothing to LiteLLM. |
    | Usage identities | The names this person's Bedrock usage appears under in AWS. Their cost is counted for them. |
    | Aliases | Other email addresses that belong to this person. |
    | Global roles | Roles that apply to the whole organisation, granted here by an admin. |

  | Test | Proves |
  |---|---|
  | T-UP1 | The action reads "Create LiteLLM user" on the people rows and in its dialog; its help text; absent when `createUser` is unavailable |
  | T-UP2 | No "Match found" badge; a match shows the email and Link; the confirm dialog is unchanged |
  | T-UP3 | `FieldHelp`: the button's name, opens on click and Enter, closes on Escape, focus returns, axe clean |
  | T-UP4 | The name is a visible link; a row click opens the user page, a click on a row button does not |
  | T-UP5 | The user page's LiteLLM state equals the list's for the same person; the read returns the match only to a caller who may link; an auditor sees "Not linked"; no create action on the page |
  | T-UP6 | The LiteLLM usage block for a linked person: spend and budget for the URL range; omitted under LD23; "LiteLLM unavailable" on an outage |
  | T-UP7 | The profile edit is the labelled button "Edit name", only where the caller may edit |

- **Team page, round 3 (unit TP1, user, 2026-11-25: "I dont understand what
  each field means"; "team detailed info, and add an edit button";
  D-R3-10, D-R3-14; Q-R3-2, user, 2026-11-25: `internal-admin` and `internal-org-admin` may rename a created team and move it to another department, both fields; leads may not).**
  - **Summary.** The page opens with a panel: the team name, department,
    kind ("From an AWS account" or "Created here"), lead names, member
    count, the LiteLLM team, and the budget resets in the range. A lead
    sees "Linked" or "Not linked" and never the LiteLLM team id (ruling
    Q-B1). Built on the server per request; no new read route.
  - **Edit team.** For `internal-admin` and `internal-org-admin`, on a
    created team: a dialog with the name (1–80 characters, trimmed) and the
    department (the picker of New team). `PATCH /api/teams/[id]` (Access
    Control — *Edit a created team*). A team that comes from an AWS account
    has no Edit team; the summary says "Edited in Settings → AWS accounts".
  - `FieldHelp` texts:

    | Field | Text |
    |---|---|
    | Members | The people in this team. A person is in one team at most. |
    | Work email or UPN (add member) | The address the person signs in with. If they have not signed in yet, they get an invitation that binds when they do. |
    | Team admins | People who lead this team: they manage its members and what it shows. |
    | Team totals | Whether members see this team's total cost and its breakdowns. |
    | User level | Which per-person rows members see: everyone's (All), only their own (Own), or none. |
    | Department totals | Whether members of this department's teams see the department's total. It reveals the other teams' combined spend. |
    | User level cap | The most any team in this department may show per person. A team set higher is limited to this. |
    | Pending invitations | People invited by email who have not signed in yet. |
    | Stale access | Access held by someone who has not signed in for a long time. Review it and remove what is not needed. |
    | Max budget | The most this LiteLLM team may spend in one budget period. LiteLLM refuses requests above it. |
    | Budget period | How often LiteLLM sets the spend counter back to zero. |
    | TPM limit / RPM limit | The most tokens, or requests, per minute LiteLLM accepts for this team. |
    | Models | The models this LiteLLM team may call. |

  | Test | Proves |
  |---|---|
  | T-TP1 | The summary shows name, department, kind, lead names, member count and the LiteLLM team; a lead sees "Linked" or "Not linked", never the id |
  | T-TP2 | `PATCH /api/teams/[id]`: role table (admin, org-admin `200`; lead, auditor, member `403` before parsing; unauthenticated `401`); one `denied` record per refusal |
  | T-TP3 | A stale version is `409`; a taken name is the creation error; a registry team is `400`; an unknown or out-of-scope team is the same `404` |
  | T-TP4 | The write records `appteam.update` with the old and new values; the team directory cache is refreshed, so the list, the pickers and the users table show the new name |
  | T-TP5 | After a move, a lead of the old department no longer has the team in scope and a lead of the new one has |
  | T-TP6 | `FieldHelp` on each field of the table above, with that text |
  | T-TP7 | Edit team is absent for a lead, an auditor and on a registry team; E2E click for admin and org-admin; axe with the dialog open at 375px and desktop |

- **Reset spend from the LiteLLM users tab and the Users page (unit RS1, user request 2026-11-18: "Can you add the button in the litellm user as well and user 'page'?"; coordinator decisions D1–D5, 2026-11-18).** A row action **Reset spend** on Management → LiteLLM → *LiteLLM users* and on Management → Users (linked users only). LiteLLM resets spend **per team membership** (`resetMemberSpend`), so there is no per-person reset and no new allowlisted operation (D1) (superseded 2026-11-19, RS2: `resetUserSpend` is the user-level reset, *Reset any LiteLLM user* below). The action opens a dialog listing the person's LiteLLM team memberships with each one's spend and budget ("No budget" when unlimited — reset is allowed, D5) and its own confirm; **Reset all listed** runs the per-team resets one at a time and reports each team's result (D2). Each reset uses the existing `POST /api/litellm/teams/[teamId]/members/[oid]/reset-spend` with its matrix (Lead in scope, `internal-org-admin`, `internal-admin`), audit and BudgetReset ledger (trigger `direct`); the dialog lists only the teams the caller may reset — a Lead sees only its own (D3). The action is shown only when `resetMemberSpend` is enabled, the row has an app identity (`oid`) and the caller may write members; otherwise it is absent, as on the Team page (D4) (superseded 2026-11-19, RS2, for the *LiteLLM users* tab: every row has the action and the dialog runs by LiteLLM ids; the app-identity condition stays for the Users page, which lists app users). A budget of `0` shows as `$0.00`, not "No budget" — it blocks all spend in LiteLLM (coordinator ruling R1, 2026-11-18). The memberships come from the team directory (`buildTeamDirectory`: registry teams and created app teams, M2), so a created app team linked to one of the person's LiteLLM teams is listed (RS1 review, 2026-11-18). `getTeam` runs once per listed team, at most 5 at a time (`runBoundedSettled`), bounded by the person's linked teams (agent decision, RS1). Any new read for the memberships is a scoped GET that follows LD37 and registers in the route registry. Members are matched to the person by `user_id` or email **and** by the identity link (`litellmUserId`, D7). *Agent decisions (2026-11-18, RS1):* the dialog reads `GET /api/litellm/users/[litellmUserId]/memberships` (LiteLLM spec — *API routes*) and takes the `oid` from the row, since the reset route resolves the LiteLLM user from it; on the *LiteLLM users* tab the action follows the list's `mayLink` and `enabledOperations` (only global readers see that list); on the Users page the server sets `canResetSpend` (LiteLLM configured, `resetMemberSpend` enabled, the caller may link).
- **Reset any LiteLLM user (unit RS2, user, 2026-11-19: Q16–Q19; LiteLLM LD39; the three places, D-RS7).** Reset no longer needs an app identity: the dialog and the buttons call the LiteLLM-id routes (`POST /api/litellm/users/[litellmUserId]/reset-spend`, `POST /api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-spend` and `/reset-budget`). A control whose operation is off is absent, never dead. *Agent decisions (2026-11-23, RS2 build):* in the reset dialog of a row with no app identity, the team memberships are listed but carry no per-team reset and no **Reset all listed** — the memberships read gives dashboard team ids only, and the per-member reset of an unlinked person is on Management → LiteLLM → *LiteLLM teams* (the members panel); the user-level reset stays available. On Management → Team, the user-level option is a radio beside the default **This team only** in the member's reset dialog; an unlinked member's buttons are labelled by email; when the members response has no `litellmTeamId` the unlinked row shows no reset buttons.
  - **Management → LiteLLM → LiteLLM users:** **every row** has **Reset spend** (before RS2: linked rows only). The dialog lists **"User spend (all of LiteLLM)"** first, for Admin and org-admin, then the user's team memberships as RS1 listed them.
  - **Management → LiteLLM → LiteLLM teams:** a team row opens its **members** (`GET /api/litellm/proxy-teams/[litellmTeamId]/members`: email, spend, budget, the linked app person or none; at most 200). Each member has **Reset spend** and **Reset budget** for Admin and org-admin; the auditor sees the list and no button.
  - **Management → Team (the Lead's page):** a LiteLLM member with no app membership keeps RS1's note and now also has the two actions (Reset spend, Reset budget). Every member row's reset dialog also offers **"User spend (all of LiteLLM)"**: a Lead does not see the LiteLLM users tab, so this is where a Lead uses the user-level reset (the server allows it only for a member of a team in the Lead's scope, otherwise `404`).
  - **Toggle rule (coordinator decision R1, 2026-11-24, RS2 review round 2; reason: "absent, never dead" per control, and RS1's users-tab button must not disappear when only `resetMemberSpend` is on).** Each reset control appears exactly when its own operation is on, and the dialog opens when either is on. The users-tab button shows when `resetMemberSpend` or `resetUserSpend` is on (restores RS1); inside the dialog the per-team Reset and **Reset all listed** need `resetMemberSpend`, and **User spend (all of LiteLLM)** needs `resetUserSpend`. The Team-page member row offers the user-level option when `resetUserSpend` is on, even if `resetMemberSpend` is off.
  - **Dialog text (D-RS9):** a reset clears the spend counter LiteLLM checks against the budget; usage history, the dashboard's own cost data and the audit log do not change. The "User spend (all of LiteLLM)" option also says it clears the person's spend across **all of their teams**, not only this one. Confirm in an `AlertDialog` naming the person and the effect, Cancel focused first, as for other destructive actions.
- **User link states (D16, user, 2026-11-17; unit M3).** Each app user row shows **Linked**, **Match found** *(the state's name only: the badge is not shown from 2026-11-25, UP1, D-R3-12; a match shows the LiteLLM email and **Link**)* (a LiteLLM user whose email equals the app user's verified canonical email: a suggestion, linked only after "Link" in an `AlertDialog` that names both sides — ~~never automatic, Access Control D27~~ *amended 2026-11-18, unit SYNC1 (user): the LiteLLM user sync and the sign-in link link an exact Entra id or email match without a click, Access Control — LiteLLM user sync; this suggestion and its click stay for the manual link*) or **No LiteLLM user with that email**, with two actions: *Link to an existing LiteLLM user* (search, pick, and a required written reason, because the emails differ) and, on OSS only, *Create and link* *(renamed "Create LiteLLM user" 2026-11-25, UP1)* *(amended 2026-11-18, user, unit LW1: and only when SSO is not enabled; absent with SSO, see* Create and link follows the gate*)*. On Enterprise *Create and link* is absent and the row says "Sign in to LiteLLM once, then retry." Link and unlink controls render only for admin and org-admin and never on the caller's own row; the auditor reads.
- **Team lead sign-in (D14, agent decision, 2026-11-17; item 1; unit M3; was "dev sign-in as a lead", renamed at the user's direction, 2026-11-18).** The dev sign-in form's role select gains **Team lead**, which signs in as the seeded team lead identity through the existing stored-identity path (Access Control — *Dev login*). Shown only where the dev login is (outside production, Entra not configured). (agent decision, 2026-11-18, unit M3: the Team lead choice posts the fixed seeded oid `local:team-lead@localhost` as the `identity` and no role; the dev resolver matches that exact oid before the email path, because the oid contains `@` but is not a valid email address; the typed identity field is disabled while Team lead is chosen.)

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
| `UserSearch` | Custom | Debounced LiteLLM user search with a results table and the selected user's usage; shared by ~~Management → Users (formerly the LiteLLM *Users* tab) and~~ Management → LiteLLM → *LiteLLM users* (Management → Users no longer mounts it: superseded 2026-11-24, unit US1, D-US1) (formerly Settings → LiteLLM *Users*, L3b; moved 2026-11-17, MI-D3) |
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
| `SearchInput` | shadcn/ui Input | Debounced text filter for tables. From unit LP1 (D-R3-5, 2026-11-25) it takes a `label` (visible unless `hideLabel`), a `maxLength` and a `delayMs` (0 for no debounce), and every search box on a Management page uses it: the magnifier is at the left of the field |
| `FieldHelp` | Custom (shadcn Button and Popover, Lucide `Info`) | An icon-only button beside a field label or a column header, `aria-label="About <field>"`. A click or Enter opens a popover with one or two sentences; Escape or a click outside closes it and focus returns to the button. Never a hover-only tooltip, never a blocking dialog (D-R3-10, 2026-11-25; the user's "modal with a short text"). The text of each field is in this spec (*Team page, round 3*; *Users, round 3*) |
| `ColumnToggle` | shadcn/ui DropdownMenu | Show/hide table columns |
| `Pagination` | shadcn/ui | Page through table results (default 20 rows) |
| `ExportButton` | Custom | Export table data to CSV |

### Status & Feedback

| Component | Source | Purpose |
|-----------|--------|---------|
| `SyncStatusBadge` | Custom (shadcn Badge) | Top-bar sync indicator on `GET /api/sync-status` (live from Phase 4.1). Shows Success / Partial / Error from `SyncStatus.status` (the tone colours the icon only; text stays a text token for 4.5:1), "No sync yet" when the item is missing (Rule 20.9), and neutral "Loading" / "Unavailable" while the request is pending or has failed — never an alert. `aria-label` and `title` carry the status and the last run time in UTC. ARIA `role="status"` (polite live region) |
| `RefreshButton` | Custom (shadcn Button, Lucide `RefreshCw`) | Top-bar icon-only ghost button beside `SyncCountdown`, `aria-label="Refresh data"` with a tooltip; ~~shown wherever the sync status is shown~~ *(superseded 2026-11-25, D-R3-2, user: "in all Usage and Management pages")*: shown to every signed-in caller on every dashboard page. For a caller who does not see the sync status it invalidates the queries and refreshes the page, and sends no sync-status request. Tooltip: "Reload the data on this page. The next sync from AWS runs on schedule." One click invalidates every query and reloads (*Caching Strategy* — Refresh). The icon spins while any query is fetching and the button is disabled for that time, which is also the click throttle; no spin under `prefers-reduced-motion`. 32px control on desktop, 44px touch target below `md`; never the view's filled primary button (Phase 5 PERF-R, user direction 2026-11-17) |
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
