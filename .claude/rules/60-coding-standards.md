# Rule 60 — Coding standards & best practices

Granular language and framework conventions. The architecture rules
(`10`–`50`) define *where* code lives; this rule defines *how* it is written.
Sources: `docs/specs/2026-05-15-design-system.md` (stack, performance
patterns) and current Next.js App Router guidance.

## TypeScript

1. **Strict mode is on.** No `// @ts-ignore`, no `// @ts-expect-error` without
   a one-line reason. No `any` — use `unknown` at boundaries and narrow.
2. **No non-null assertions (`!`)** to silence the compiler. Narrow with a
   guard or fix the type.
3. **Types describe data; Zod schemas validate it.** Derive types from Zod
   with `z.infer<typeof Schema>` — never hand-write a type that duplicates a
   schema.
4. **`type` for unions and object shapes, `interface` only for extension.**
   Be consistent within a file.
5. **No default exports** except where a framework requires them (Next.js
   `page.tsx`, `layout.tsx`, `route.ts`, `proxy.ts`, `auth.ts`). Named
   exports everywhere else.
6. **Discriminated unions over optional-field soup.** The `{ data }` /
   `{ error }` response shape is the canonical example.

## React & Next.js (App Router)

7. **Server Components are the default.** Add `"use client"` only when a
   component needs state, effects, event handlers, or browser APIs. Push the
   `"use client"` boundary as deep as possible — keep pages and layouts as
   Server Components.
8. **Data flows down as props.** A Client Component never imports
   `apps/dashboard/lib/data/**` or `@aws-sdk/*` (see Rule 10). It receives
   data from a Server Component or fetches a Route Handler via TanStack Query.
9. **`async`/`await` Server Components for data**, not `useEffect` fetching.
10. **Caching is explicit.** Data reads in Route Handlers and Server
    Components go through `unstable_cache` (`revalidate: 3600`, matching the
    hourly Lambda cycle, with named tags) unless the spec says otherwise
    (`SyncStatus` uses 5 minutes — Design System *Caching Strategy*); keep
    each entry small (rollups are cached per UTC day — Next's data cache caps
    an entry at 2 MB). The Auth.js session check stays outside the cache, and
    a Route Handler that writes calls `revalidateTag` for the tags it affects.
    **Authorization data is never cached** — roles, grants, affiliations,
    admin scopes, group mappings, visibility, identity links and the per-user
    approval are read per request, and filtering by scope happens after the
    cache read (Access Control spec — *Enforcement*).
    `export const revalidate = 3600` stays as the declarative default.
    From the Phase 5 *Performance and caching* units (specified 2026-11-17,
    not built): a request memo may reuse a read **within one request** only,
    which is not caching; LiteLLM reads are cached only through the fixed
    list in the LiteLLM spec — *Caching*; and nothing is cached in browser
    storage (Design System — *Caching Strategy*).
11. **Charts and other browser-only libraries** load via
    `next/dynamic(() => import(...), { ssr: false })`. Recharts is always
    wrapped in `ResponsiveContainer`.
12. **Every page section gets its own `<Suspense>` + `ErrorBoundary`** with a
    `Skeleton` fallback — one slow or failing section never blocks the page.
13. **`params`/`searchParams` are Promises** in the App Router — `await` them.
14. **Keys are stable IDs**, never array indices. Effects declare complete
    dependency arrays.
15. **Settings CRUD's HTTP contract is the `/api/accounts` Route Handlers**
    (Data Model spec — *API Routes*; implementation-phases Phase 4.9). A
    Server Action, if one is added later (v1 has none), goes through `next-safe-action` with
    a Zod input schema, an Auth.js session check and the `internal-admin` role check
    (`lib/auth/`; System Architecture — *Authentication & Access*), and calls
    the same `lib/data/account-meta.ts` functions.

## Validation & errors

16. **Validate at the boundary, trust within.** Route Handlers and Server
    Actions Zod-parse every input; data-access functions trust their typed
    arguments (Rule 50.8).
17. **No silent failures.** Never swallow an error with an empty `catch` or a
    fallback that hides it. Either handle it meaningfully or let it bubble to
    OpenTelemetry. A missing `SyncStatus` item is a *handled state*, not a swallowed
    error (Rule 20.9).
18. **No `console.log` in committed code.** Use OpenTelemetry for errors; remove
    debug logging before commit. Never log secrets (Rule 50.6).
19. **Fail fast on misconfiguration.** Env vars go through
    `@t3-oss/env-nextjs` — never raw `process.env` reads in app code
    (Rule 50.2; `scripts/**`, test helpers, and tool config are the
    documented exception).

## Testing (Vitest — not Jest)

20. **Tests live next to the code** (layout amended 2026-11-17, test-structure
    chore; `docs/guides/testing.md`):
    - `foo.ts` → `foo.test.ts` (unit) or `foo.integration.test.ts`
      (DynamoDB Local). `<source>.<aspect>.test.ts` only for a named aspect
      of the source (`AppSidebar.mobile.test.tsx`), never for a run or a
      review round.
    - A Route Handler's own test is `route.integration.test.ts` in the
      route's folder.
    - A test that covers several routes or modules lives in `__tests__/` at
      their lowest common directory (`app/api/__tests__/`).
    - Shared test code lives only in `apps/dashboard/test/` (`setup/`,
      `fakes/`, `fixtures/`, `support/`; `test/route-registry.ts` stays at
      the root), never under `lib/` or `components/`.
    - `infra/test/` is the one exception: CDK tests assert on synthesised
      stacks and have no one-to-one source file.
    E2E specs live in `apps/dashboard/e2e/` (Playwright,
    **headless only** — devcontainer has no display; see
    `apps/dashboard/playwright.config.ts`). Smoke specs accrue with UI work
    through the agent loop (Rule 70.11); the full user journeys land in
    Phase 5.
21. **Test behaviour, not implementation.** Assert on rendered output and
    public return values; do not assert on internal calls.
22. **Zod schemas get valid + invalid cases.** Data-access functions are
    tested against DynamoDB Local, not mocks.
23. **Route Handler tests assert the `{ data }` / `{ error }` shape** and
    cover the `401` (unauthenticated) and `400` (bad input) paths, plus `403`
    (no `internal-admin` role) on every write route. **Amended 2026-11-15
    (user):** the cross-cutting route contract — `401` shape, `403` before
    parsing, `400` shape, `Cache-Control: private, no-store`, one `denied`
    audit per refused write — is asserted **once**, by a shared
    route-contract suite that iterates a registry of every route; a new
    route registers there instead of copying those cases. A route's own
    file tests only its route-specific behaviour. The suite is
    `app/api/__tests__/route-contract.integration.test.ts` with the registry
    `test/route-registry.ts` (landed 2026-11-16, `3916b281`); a route's own
    file does not repeat those cases, except a `frozen` registry entry: its own
    file keeps them until the flag is cleared and the suite runs the route in
    full (amended 2026-11-24).
24. **No flaky tests.** No real network, no wall-clock `sleep`; control time
    with `vi.useFakeTimers()`.
24a. **Test budget (decided 2026-11-15, user).** Spend tests where they
    catch defects:
    - **One layer per behaviour** — test it once, at the lowest layer that
      can see the defect. Component tests do not re-test API logic;
      Playwright covers journeys, page smoke and what only a browser shows.
    - **Every test cites its source** — a spec line, a rule or a threat
      item (LT/T); a case with no source is not written.
    - **Tables stay representative** outside security: role × operation,
      denylist, path-parameter and boundary matrices stay complete; other
      `it.each` tables cover the distinct classes, not every combination.
    - **What counts as a citation (2026-11-24).** A case is cited when
      its title, an enclosing `describe` title, or a comment directly
      above either names a spec section, a rule number or a threat item.
      A review round, a plan, a brief or a run report is not a source.
    - **One row per class (2026-11-24).** Outside security, a table row
      stands for a class of input and is named by that class; two rows of
      one class are one row. Security tables (role × operation, denylist,
      path-parameter and boundary matrices) stay complete, as above.
    - **A security case** is one that asserts a `401`, a `403`, a hidden
      `404`, what a role sees or may do, a denylist or allowlist, a path
      or boundary check on a guarded route, a `denied` audit record, a
      secret kept out of an output, a `Cache-Control: private, no-store`
      header, a `400` on a guarded route, a lockout or rate limit, or that cites
      a T or LT item
      (2026-11-24; implementation-phases — *Maintenance — test clean-up,
      second pass, and test speed*). A security case is removed only as an
      exact duplicate of a surviving case, named by its full test name,
      marked `SEC` and approved by a security-scope `quality-reviewer` before
      deletion (Q1, the user, 2026-11-23).
    - **No per-run test files** (`*.r1`, `*.r2`, `*.review`, …): extend the
      canonical test file next to the code.

## Naming & files

25. **Components** `PascalCase` (`MetricCard.tsx`). **Hooks** `useX.ts`.
    **Utilities, data-access, routes** `kebab-case` files. **Constants**
    `SCREAMING_SNAKE_CASE`.
26. **One component per file**, named to match the file.
27. **Imports ordered:** external packages → workspace packages
    (`@llm-usage-lens/shared`) → local aliases (`@/...`) → relative. Prettier
    + ESLint enforce; do not fight the formatter.
28. **No barrel `index.ts` files** that re-export a directory — they defeat
    tree-shaking and obscure the dependency graph.

## Comments

29. **Default to no comments.** Names carry intent. Comment only a
    *non-obvious why* — a hidden constraint, a spec rule, a workaround. Do not
    restate what the code does. (See the design-system spec for the visual
    rationale behind tokens; cite it rather than re-explaining.)

## Accessibility & styling (see Rule 40)

30. **No raw hex in components** — semantic tokens only. Icon-only controls
    carry an `aria-label`. Focus rings stay visible. Respect
    `prefers-reduced-motion`.
