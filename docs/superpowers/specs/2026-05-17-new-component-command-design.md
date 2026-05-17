# Design — `/new-component` scaffold command

**Status:** Approved
**Date:** 2026-05-17
**Scope:** A project slash command that scaffolds dashboard components in
conformance with the design-system spec and `.claude/rules/`.

---

## Context

The project's `.claude/` setup has scaffold commands for the two recurring
server-side artifacts — `/new-route` (Route Handlers) and `/new-data-access`
(data-access functions) — but **none for components**. Phase 4 of the
implementation plan is 9 page sub-phases producing roughly 30 components, each
governed by a dense set of rules (Server-vs-Client default, semantic tokens,
lazy-loaded charts, per-section Suspense/ErrorBoundary, naming, exports). A
component is the project's single most-repeated artifact and currently has no
scaffold. `/new-component` closes that gap.

## Goal

A command that generates a correct component file plus a co-located test stub,
with the design-system spec and Rules 40/60 baked in, so Phase 4 components
start consistent and spec-compliant.

## Approach

A single command file `.claude/commands/new-component.md`, matching the
existing `/new-route` and `/new-data-access` style (frontmatter, a "must"
list, "Steps"). It is a prompt, not a code generator — consistent with the two
existing scaffolds, requires no tooling the pre-implementation repo lacks, and
the rules are precise enough that a well-written prompt produces correct
output.

Rejected: a `new-component` skill with bundled `.tsx` templates (inconsistent
with the project's command-based scaffolds) and a `scripts/new-component.ts`
generator (needs a `package.json` that does not exist yet; duplicates rule
logic).

## Interface

- **File:** `.claude/commands/new-component.md`
- **Frontmatter:** `description`, `argument-hint: <variant> <group> <ComponentName>`
- **Arguments:**
  - `variant` — `display` (Server Component, default) | `interactive`
    (Client Component) | `chart` (Recharts chart)
  - `group` — `charts | data-display | filters | layout | status | identity`
    (the design-system spec's own Component Inventory groupings)
  - `ComponentName` — `PascalCase`, e.g. `MetricCard`
- **Output:**
  - `apps/dashboard/components/<group>/<ComponentName>.tsx`
  - co-located `apps/dashboard/components/<group>/<ComponentName>.test.tsx`
  - shadcn/ui primitives live in `components/ui/` and are **out of scope** —
    those are added via the shadcn CLI, not this command.

## Spec gating

Look up `ComponentName` in the design-system spec
(`docs/specs/2026-05-15-design-system.md`) Component Inventory:

- **Found:** use its documented purpose and source; cross-check the `group`
  argument against the inventory section it appears in and warn on mismatch.
- **Not found:** warn that the component is not in the design-system inventory
  and ask the user to confirm before scaffolding — the same posture as
  `/new-route` ("do not invent endpoints") and `/new-data-access` ("refuse to
  invent new patterns"), but with an explicit override so legitimate
  sub-components are not blocked.

## Variant behavior

**Shared by all variants** (Rules 40 & 60):
- Named export only; no default export (Rule 60.5).
- File name = component name, `PascalCase`, one component per file (60.26).
- Semantic Tailwind tokens / CSS variables — no raw hex (40.2, 60.30).
- Import order: external → `@bedrock-usage/shared` → `@/…` → relative (60.27).
- `aria-label` on any icon-only control; visible focus ring (60.30).
- Co-located Vitest + React Testing Library `.test.tsx` stub asserting
  rendered output, not internals (60.21, 60.23).

**`display`** — Server Component (no `"use client"`). `async` when it accepts
data; props-in only, no data fetching in the component body. Test renders the
component with sample props and asserts visible output.

**`interactive`** — first line `"use client"`. `useState`, effects, and event
handlers permitted. **Must not** import `apps/dashboard/lib/data/**` or
`@aws-sdk/*` (Rule 10) — data arrives as props or via a Route Handler through
TanStack Query. Test exercises one interaction.

**`chart`** — a Recharts chart. The file defines the chart and exports, as its
public named export, the **`next/dynamic(() => import(...), { ssr: false })`**
wrapper that consumers import (Rule 40.3, 60.11). The chart is wrapped in
`ResponsiveContainer`. Series colors come from the model CSS tokens in
`@bedrock-usage/shared` (Rule 20.5) — never raw hex. A donut/pie chart for
more than 5 categories is refused (design-system Anti-Patterns). Test is a
shallow smoke render asserting the dynamic wrapper renders (Recharts internals
are `ssr:false` and not asserted).

## Out of scope

The per-section `<Suspense>` + `<ErrorBoundary>` + `Skeleton` triad mandated by
the design-system spec is **page composition**, wired where the component is
*used*, not where it is defined. The command does not generate it; its closing
note reminds the user to wire it at the call site. `Skeleton` and
`ErrorBoundary` are themselves inventory components, scaffolded normally.

## Command steps

1. Resolve `ComponentName` against the design-system Component Inventory;
   if absent, warn and ask the user to confirm.
2. Generate `<ComponentName>.tsx` for the chosen variant under
   `components/<group>/`.
3. Generate the co-located `<ComponentName>.test.tsx` stub.
4. Print a reminder to wire `Suspense` / `ErrorBoundary` at the call site and
   to run `/lint`.

## Testing / verification

The command is a markdown prompt — verification is by exercising it once the
codebase exists (Phase 2+):

1. Run `/new-component display data-display MetricCard` — confirm a Server
   Component `.tsx` + `.test.tsx` appear at
   `apps/dashboard/components/data-display/`, with a named export, semantic
   tokens, no `"use client"`.
2. Run `/new-component chart charts CostTrendChart` — confirm the file exports
   a `next/dynamic` `ssr:false` wrapper and the inner chart uses
   `ResponsiveContainer` and shared model color tokens.
3. Run `/new-component interactive filters ModelFilter` — confirm
   `"use client"` is present and no `lib/data` / `@aws-sdk` import exists.
4. Run with an off-inventory name — confirm the command warns and asks for
   confirmation rather than silently scaffolding.
5. Run `/lint` on the generated files — ESLint + Prettier + `tsc` pass.
