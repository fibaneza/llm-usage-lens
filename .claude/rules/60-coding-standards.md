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
10. **Caching is explicit.** Route Handlers set `export const revalidate =
    3600;` (matches the hourly Lambda cycle) unless the spec says otherwise.
    Wrap data-access reads in `unstable_cache` when a Server Component calls
    them directly.
11. **Charts and other browser-only libraries** load via
    `next/dynamic(() => import(...), { ssr: false })`. Recharts is always
    wrapped in `ResponsiveContainer`.
12. **Every page section gets its own `<Suspense>` + `ErrorBoundary`** with a
    `Skeleton` fallback — one slow or failing section never blocks the page.
13. **`params`/`searchParams` are Promises** in the App Router — `await` them.
14. **Keys are stable IDs**, never array indices. Effects declare complete
    dependency arrays.
15. **Server Actions** (Settings CRUD) go through `next-safe-action` with a
    Zod input schema and an Auth.js session check.

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
    `@t3-oss/env-nextjs` — never raw `process.env` reads (Rule 50.2).

## Testing (Vitest — not Jest)

20. **Tests live next to the code** as `*.test.ts` / `*.test.tsx`, or under
    `__tests__/`. E2E specs live in `apps/dashboard/e2e/` (Playwright,
    **headless only** — devcontainer has no display; see
    `apps/dashboard/playwright.config.ts`). Smoke specs accrue with UI work
    through the agent loop (Rule 70.11); the full user journeys land in
    Phase 5.
21. **Test behaviour, not implementation.** Assert on rendered output and
    public return values; do not assert on internal calls.
22. **Zod schemas get valid + invalid cases.** Data-access functions are
    tested against DynamoDB Local, not mocks.
23. **Route Handler tests assert the `{ data }` / `{ error }` shape** and
    cover the `401` (unauthenticated) and `400` (bad input) paths.
24. **No flaky tests.** No real network, no wall-clock `sleep`; control time
    with `vi.useFakeTimers()`.

## Naming & files

25. **Components** `PascalCase` (`MetricCard.tsx`). **Hooks** `useX.ts`.
    **Utilities, data-access, routes** `kebab-case` files. **Constants**
    `SCREAMING_SNAKE_CASE`.
26. **One component per file**, named to match the file.
27. **Imports ordered:** external packages → workspace packages
    (`@bedrock-usage/shared`) → local aliases (`@/...`) → relative. Prettier
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
