# `/new-component` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/new-component` project slash command that scaffolds dashboard components in conformance with the design-system spec and `.claude/rules/`.

**Architecture:** A single markdown command file at `.claude/commands/new-component.md`, matching the existing `/new-route` and `/new-data-access` scaffolds (frontmatter, a "must" list, "Steps"). It is a prompt — there is no code generator and no test runner (the repo is pre-implementation). One supporting change: register the command in the `CLAUDE.md` slash-commands table.

**Tech Stack:** Markdown (Claude Code command file with YAML frontmatter). No build tooling involved.

---

## Reference

- Spec: `docs/superpowers/specs/2026-05-17-new-component-command-design.md`
- Style precedents: `.claude/commands/new-route.md`, `.claude/commands/new-data-access.md`
- Rules cited by the command: `.claude/rules/10-server-only-boundary.md`, `.claude/rules/20-data-model-conventions.md`, `.claude/rules/40-style-and-stack.md`, `.claude/rules/60-coding-standards.md`
- Design-system spec (Component Inventory): `docs/specs/2026-05-15-design-system.md`

## File Structure

- **Create:** `.claude/commands/new-component.md` — the command definition.
- **Modify:** `CLAUDE.md` — add one row to the "Slash commands" table.

No other files. The command generates `apps/dashboard/components/**` files at *use* time; nothing under `apps/` is created by this plan.

---

### Task 1: Create the `/new-component` command file

**Files:**
- Create: `.claude/commands/new-component.md`

- [ ] **Step 1: Write the command file**

Create `.claude/commands/new-component.md` with exactly this content:

````markdown
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
4. Order imports external → `@bedrock-usage/shared` → `@/…` → relative
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
  colors come from the model CSS tokens in `@bedrock-usage/shared`
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
````

- [ ] **Step 2: Verify the file structure matches the existing scaffolds**

Run: `head -4 .claude/commands/new-route.md .claude/commands/new-component.md`
Expected: both files open with a `---` frontmatter block containing a
`description:` line; `new-component.md` also has an `argument-hint:` line.

- [ ] **Step 3: Confirm the six group slugs match the design-system inventory**

Run: `grep -nE '^### (Layout|Data Display|Charts|Filters|Status|Identity)' docs/specs/2026-05-15-design-system.md`
Expected: six headings — Layout & Navigation, Data Display, Charts, Filters &
Controls, Status & Feedback, Identity & Badges. Confirm the command's group
slugs (`layout`, `data-display`, `charts`, `filters`, `status`, `identity`)
each correspond to one heading. If a heading is renamed in the spec, update
the command's slug list to match.

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/new-component.md
git commit -m "feat: add /new-component scaffold command"
```

---

### Task 2: Register `/new-component` in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — the "Slash commands" table.

- [ ] **Step 1: Locate the slash-commands table**

Run: `grep -n '/new-data-access' CLAUDE.md`
Expected: one line, inside the "## Slash commands" table, of the form
`| `/new-data-access <description>` | Scaffold a server-only data-access function |`.

- [ ] **Step 2: Add the `/new-component` row**

Immediately after the `/new-data-access` row, insert:

```markdown
| `/new-component <variant> <group> <Name>` | Scaffold a dashboard component (display/interactive/chart) |
```

- [ ] **Step 3: Verify the table still renders**

Run: `grep -nA1 '/new-component' CLAUDE.md`
Expected: the new row appears within the table; the line directly above it is
the `/new-data-access` row and both have the same `| … | … |` column shape.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register /new-component in the slash-commands table"
```

---

## Verification

There is no test runner in this repository (pre-implementation — no
`package.json`). Verification is structural and behavioral, not automated:

1. **Structural** — Tasks 1 and 2 each carry their own `grep`/`head` checks;
   all must produce the expected output.
2. **Behavioral (deferred)** — once Phase 2 of the project exists and there is
   an `apps/dashboard/`, exercise the command per the design spec's
   "Testing / verification" section:
   - `/new-component display data-display MetricCard` → Server Component
     `.tsx` + `.test.tsx` under `apps/dashboard/components/data-display/`,
     named export, semantic tokens, no `"use client"`.
   - `/new-component chart charts CostTrendChart` → file exports a
     `next/dynamic` `ssr:false` wrapper; inner chart uses `ResponsiveContainer`
     and shared model color tokens.
   - `/new-component interactive filters ModelFilter` → `"use client"`
     present; no `lib/data` or `@aws-sdk` import.
   - An off-inventory name → command warns and asks for confirmation.
   - `/lint` on the generated files passes.

## Self-Review

- **Spec coverage:** every section of the design spec — interface, spec
  gating, shared rules, three variant behaviors, out-of-scope Suspense triad,
  command steps — is reproduced in the Task 1 command file. The design spec's
  "verification" section is carried into the plan's Verification section.
  CLAUDE.md registration is an implied housekeeping step, covered by Task 2.
- **Placeholder scan:** none — the full command file content is inline.
- **Type consistency:** the group slug set
  (`charts`/`data-display`/`filters`/`layout`/`status`/`identity`) and the
  variant set (`display`/`interactive`/`chart`) are used identically in the
  command file, the verification section, and Task 1 Step 3.
