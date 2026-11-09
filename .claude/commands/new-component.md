---
description: Scaffold a dashboard component that follows the design system and project rules
argument-hint: <variant: display|interactive|chart> <group> <ComponentName>
---

# /new-component

Scaffold a React component for the dashboard at
`apps/dashboard/components/<group>/<ComponentName>.tsx` with a co-located
Vitest test, following `docs/specs/2026-05-15-design-system.md`,
`.claude/rules/40-style-and-stack.md`, and
`.claude/rules/60-coding-standards.md`.

`$ARGUMENTS` is `<variant> <group> <ComponentName>`:

- `variant` — `display` (Server Component, the default), `interactive`
  (Client Component), or `chart` (Recharts chart).
- `group` — one of `charts`, `data-display`, `filters`, `layout`, `status`,
  `identity` (the design-system spec's Component Inventory groupings).
  shadcn/ui primitives belong in `components/ui/` via the shadcn CLI and are
  out of scope for this command.
- `ComponentName` — `PascalCase`, e.g. `MetricCard`.

## Spec gating

Look up `ComponentName` in the Component Inventory of
`docs/specs/2026-05-15-design-system.md`:

- **Found** — use its documented purpose and source; if the `group` argument
  disagrees with the inventory section the component appears in, warn.
- **Not found** — warn that the component is not in the design-system
  inventory and ask the user to confirm before scaffolding, the same posture
  as `/new-route` and `/new-data-access`.

## Every variant must

1. Live at `apps/dashboard/components/<group>/<ComponentName>.tsx`, one
   component per file, file name matching the component (Rule 60.26).
2. Use a **named export** — no default export (Rule 60.5).
3. Use semantic Tailwind tokens / CSS variables — **no raw hex**
   (Rule 40.2, 60.30).
4. Order imports external → `@llm-usage-lens/shared` → `@/…` → relative
   (Rule 60.27).
5. Give every icon-only control an `aria-label`; keep focus rings visible
   (Rule 60.30).
6. Ship a co-located `<ComponentName>.test.tsx` (Vitest + React Testing
   Library) that asserts rendered output, not internals (Rule 60.21, 60.23).

## Variant rules

- **display** — Server Component; no `"use client"`. `async` only if it
  takes data; props in, no data fetching in the component body. Test renders
  it with sample props and asserts visible output.
- **interactive** — first line `"use client"`. State, effects, and handlers
  are allowed. Must **not** import `apps/dashboard/lib/data/**` or
  `@aws-sdk/*` (Rule 10) — data arrives as props or from a Route Handler via
  TanStack Query. Test exercises one interaction.
- **chart** — a Recharts chart. Export, as the public named export, the
  `next/dynamic(() => import(...), { ssr: false })` wrapper that consumers
  import (Rule 40.3, 60.11). Wrap the chart in `ResponsiveContainer`. Series
  colors come from the model CSS tokens in `@llm-usage-lens/shared`
  (Rule 20.5) — never raw hex. Refuse a donut/pie chart for more than 5
  categories (design-system Anti-Patterns). Test is a shallow smoke render
  of the dynamic wrapper.

## Steps

1. Resolve `ComponentName` against the design-system Component Inventory; if
   absent, warn and ask the user to confirm before continuing.
2. Generate `apps/dashboard/components/<group>/<ComponentName>.tsx` for the
   chosen variant.
3. Generate the co-located `<ComponentName>.test.tsx` stub.
4. Remind the user to wrap the component's section in its own `<Suspense>` +
   `<ErrorBoundary>` with a `Skeleton` fallback **at the call site**
   (Rule 40.4, 60.12) — this command does not generate that wiring — and to
   run `/lint`.
