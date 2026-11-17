# UI Refresh Prompt — compact workspace and test consolidation (LLM Usage Lens)

You are a **worker session** under the coordinator (`prompts/coordinator_prompt.md`).
You orchestrate agents; you write no production code or tests yourself.
This run was scheduled by the user on 2026-11-15 to start at 00:31 AEDT on
2026-11-16, after the 5-hour usage window resets.

Primary checkout: `/Users/fibanez/Projects/aws-bedrock-cost-tracker` (`$REPO`).
Always use absolute paths; never edit in the primary checkout or on `main`.

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`prompts/shared-contracts.md` → `prompts/coordinator_prompt.md` → this file.
This file never overrides a rule. Where the user's direction below needs a
spec to change, amend the spec first (Rule 00.2).

## 1. What the user asked for (2026-11-15)

1. **A more compact, professional UI** — a dashboard and management product
   used by **employees inside a company**, in production. Correct use of
   tabs, configuration sections and an administration area. The user likes
   the **LiteLLM admin UI** as a reference.
2. **Review the implemented tests** and remove the duplicated and the
   not-required ones (implementation-phases — *Maintenance — test
   consolidation*; Rule 60.23 and 60.24a).
3. **Report progress to the coordinator.**
4. **Do not break the functionality of the project.**
5. Decisions follow **common practice and recommendations**
   (implementation-phases — *Decision policy*): decide, record, keep working.
6. **Libraries may be added** to improve the UI.
7. **Pages and panels may be re-organised** to improve the user experience.
8. **Nothing merges into `main` without the user's approval. The user
   validates the new UI in person first.**
9. Run it with **multiple agents in dynamic workflows** — this is the user's
   opt-in to the `Workflow` tool for this run
   (`docs/guides/dynamic-workflows.md`; implementation-phases — *Workflow
   pilots*): every fan-out in §5–§6 is a dynamic workflow, at most 5 agents
   each, Rule 70 roles kept, under the guide's §6 guardrail (see §7).

## 1a. Mock-up review (2026-11-16) — decisions and additions

The user reviewed static mock-ups
(`temp/run-uic/mockups/compact-ui-mockups.html`, five rounds) before any UI
code. This section **overrides** the design plan (`temp/run-ui/design-plan.md`
§1.1, §1.3, §2.3, §3) and the U1 output where they differ. Everything here
is a change to what roles see or to navigation, so it goes **spec first**
(Rule 00): the Design System spec (*Layout*, *LiteLLM Page*, *Settings Page*),
the Access Control spec (*Permission matrix*, visibility by role), the
LiteLLM spec (*Views by role*) and implementation-phases (Phase 4R.5 and the
L-unit blocks). Where an item conflicts with a spec, raise it; never diverge
silently.

### Decided by the user

**Sidebar (replaces design plan §1.1).**

| Section | Items | Visible to |
|---|---|---|
| Usage | Overview, Ranking, Departments, Teams, Services, Users | admin, org admin only — it is organisation-level |
| Management (was "Gateway") | My usage · Team · Organisation · Users · Audit | My usage: every signed-in role. Team: lead, org admin, admin. Organisation, Users, Audit: org admin, admin |
| Administration | Settings | admin, org admin; stays in its **current position** at the bottom of the side panel |

- The LiteLLM page's tab row is gone: its tabs are the Management items in
  the side panel, each its own route. One Tabs component still serves the
  in-page tabs that remain (Ranking, Settings, the Team page).
- **One Team page.** The LiteLLM Team tab and "team management" were
  duplicates; there is one page under Management → Team. It carries the
  team's usage (spend, budget, members, keys) **and** its management: team
  selector, member search, add member, edit budget, reset spend, remove
  member. A lead sees only the teams they lead; org admin and admin see all.
- **Reset spend** is a button at the right of each member row.
- **Administration** holds the admin and org-admin configuration of the app
  and the organisation. Team membership leaves Settings → Access for the
  Team page; Settings → Access keeps the organisation-wide access settings
  and links to Management → Team.
- **Settings** is split into tabs at the top, each its own route (AWS
  accounts, Sync and data, LiteLLM, Access, Audit), with a second tab row
  inside Access and LiteLLM — unit D of `litellm_role_views_prompt.md` owns
  the build; this prompt only keeps the look consistent.
- **Role views.** Landing page: admin and org admin → Cost overview; lead and
  user → My usage. A hidden item is absent, never disabled, and its route
  returns the same `404` as a missing page (Rule 10.3).

**Open with the user — ask before building it:** today's plan (Phase 4R.5)
gives a team lead a Bedrock cost view scoped to their own teams. Hiding the
whole Usage section removes it. Suggestion 2 below is the proposed answer.

### Additions (suggested by the session, accepted by the user: "include all")

1. **No clashing labels.** "Teams" and "Users" must not appear twice in one
   sidebar. Rename so each label is unique for an admin — recommended: the
   Usage items become "Cost by team" and "Cost by user" (page `h1` strings
   follow; update every test and e2e selector that names them). Decide the
   exact wording by common practice and record it.
2. **Two cost figures on the Team page.** Next to "Gateway spend" (LiteLLM-
   reported), show an "AWS-billed cost" tile for the same team and period,
   scoped to the teams the caller may see. It is a read through the existing
   access layer; it never exposes another team's or the organisation's cost.
   Label each figure with its source; never add them together.
3. **Confirm destructive actions.** Reset spend and remove member open a
   confirmation that names the person and the effect ("Sets j.lee's spend to
   $0.00. Recorded in the audit log."), Cancel focused first. Add a bulk
   "Reset spend for all members" action above the table with its own
   confirmation that states the count.
4. **Budget as a bar.** A thin progress bar under each budget (member and
   team): neutral below 80%, warning from 80%, destructive at or above 100%,
   with the percentage as text (colour is never the only signal). Add a
   "Near or over budget" filter to the member table toolbar.
5. **My usage answers "why".** Add a spend-by-day chart and a spend-by-model
   breakdown for the caller's own data (lazy-loaded Recharts, model tokens
   for series — Rule 40.2, 40.3), and a "Request a budget increase" link to
   the caller's team lead (a `mailto:` or a copyable address; no new
   outbound-message feature).
6. **One Audit page for admins.** Management → Audit (gateway) and Settings →
   Audit (app) answer the same question. Present one Audit page with a
   source filter (App · Gateway); both existing data sources and their
   permissions stay as they are — this is composition, not a merged store.
   Place it once in the navigation and redirect the other entry.
7. **"Showing" line for scoped roles.** Scoped pages state their scope under
   the page header ("Showing teams you lead: Platform, Checkout"), so a
   filtered page never looks empty or complete by accident.
8. **Date range stays on My usage and Team.** The sync badges are hidden for
   lead and user (they belong to the organisation-level cost pages); the
   period picker is kept, because spend is per period.

### What this needs from other units

- **Reset spend** (`resetMemberSpend`) is in the LiteLLM spec for Lead and
  Admin with the default **off**, and its route is scheduled in unit L4. The
  button is built with L4; until the operation is enabled it is absent, not
  dead.
- **Add/remove member, budgets:** the L4 write routes; the Team page calls
  them and adds no LiteLLM call of its own (Rule 10).
- **Navigation data:** `lib/nav.ts`, `AppSidebar`, `AppHeader` and
  `CommandMenu` belong to Phase 4R.5 until it lands; the Management section,
  the role filter and the landing pages build on top of it.
- **Role visibility** is enforced on the server (policy module), not by
  hiding links. Every item in this section gets a per-role test: the item is
  absent and the route is `404` for a role that may not see it.
- Tests follow the budget in Rule 60.24a: one per-role navigation suite, one
  e2e journey per role (admin, lead, user), axe and no horizontal scroll at
  375, 768, 1024 and 1440.

## 2. Two units, two branches, disjoint ownership

| Unit | Branch | Worktree | Owns |
|---|---|---|---|
| **UI** compact workspace | `feature/ui-compact-workspace` | `$REPO/.claude/worktrees/ui-compact` | `apps/dashboard/components/**` and `app/**` pages and layouts (not `app/api/**`), `app/globals.css` and tokens, `lib/nav.ts` and the presentation-only `lib/*-search-params.ts` helpers, the component tests next to them, `apps/dashboard/e2e/**` page specs, `docs/specs/2026-05-15-design-system.md`, Rule 40, `docs/design-system/**` |
| **TC** test consolidation | `chore/test-consolidation` | `$REPO/.claude/worktrees/test-consolidation` | test files only, outside the UI unit's paths: `app/api/**`, `lib/**`, `packages/shared/**`, `infra/**`, `scripts/**`, `apps/dashboard/test/**` |

Both branch from the current `main`. Neither depends on the other, so each
can be reviewed and landed alone. The UI unit applies Rule 60.24a to the
component and e2e tests it owns (it removes cases that only repeat an
integration-level assertion); the TC unit never touches them.

**Files that are off limits to both units** (the "frozen set"), recomputed
in §4 and after every `main` merge:

- every path changed by an active goal:
  `git -C $REPO diff --name-only main...<branch>` for each branch listed as
  active in `$REPO/temp/coordinator/state.md` and every other branch
  checked out under `$REPO/.claude/worktrees/` (`git worktree list`), plus
  uncommitted paths in those worktrees (`git -C <worktree> status --short`).
  Known on 2026-11-16 04:45 (`main` `94512e0`): L3 and 4R.4 are on `main`
  (4R.4 as `aa36636`, review fixes pending). Active and frozen: the
  **4R.4 fix** on `feature/phase-4r-4-rbac-settings-2` and **L3b** on
  `feature/phase-l3b-litellm-role-views`; both **land before the UI unit
  touches their files**;
- the LiteLLM and sign-in surfaces, owned by the role-views run
  (`prompts/litellm_role_views_prompt.md`) until it lands:
  `components/litellm/**`, `components/settings/LiteLLMPanel*`,
  `app/dashboard/litellm/**`, `components/auth/SignInOptions*`,
  `app/sign-in/**`, and the Settings page —
  `app/dashboard/settings/**` and `components/settings/**` (moved by the
  coordinator on 2026-11-16: that run breaks Settings into sections with a
  search, using this run's design plan §1.3 and §3 as input; the Settings
  page is out of this run's scope). The UI unit restyles them only through tokens and the
  shared primitives, never by editing those files;
- `prompts/**`, `.claude/**` except Rule 40, `poc/**`, `tools/**`,
  `apps/collector/**`, `.github/**`.

A frozen file is not edited, moved, renamed or deleted, and its tests are
not removed. Work that needs one is **deferred**: list it in the report
(§10) as "Slice B" with the exact change, and do it only if its branch has
landed on `main` before this run ends (then merge `main` into your branch
first). Expect that the 4R.4 fix freezes `app/globals.css`, the Design
System spec, the Settings page and `SettingsContent`, the Settings access
sections, `/dashboard/account` and `UserMenu`, and that L3b freezes the
LiteLLM page, `LiteLLMPanel` and `components/ui/tabs.tsx`.

**One Tabs component.** `components/ui/tabs.tsx` arrives with L3b. Never
create a second one; after L3b lands, restyle that file if the design plan
needs it.

**While `globals.css` or the Design System spec is frozen, the UI unit
cannot start U2 or U3.** Until 4R.4 is on `main`: do §4, U1 and the design
plan; draft the spec amendment and the token changes as patch files under
`$REPO/temp/run-ui/drafts/` (not committed); run the TC unit; send
`blocked ui-compact: needs the 4R.4 fix on main (globals.css, design-system spec)`
once. Check `git -C $REPO log -1 main` and the *Notes for the ui-compact
run* in `$REPO/temp/coordinator/state.md` at every phase boundary; when the
4R.4 fix has landed, merge `main` into the UI branch, recompute the frozen
set and continue from U2. If the TC unit is finished and the 4R.4 fix has
still not landed, write the report with the UI unit marked "waiting for the
4R.4 fix", create a `CronCreate` check every 30 minutes that resumes from
`progress.md` when `main` contains it, and stop.

## 3. Hard guards (never crossed)

- **Never merge into `main`, never push, never delete a branch, never
  deploy.** Do not send `ready to merge` for the UI unit (see §9).
- **The UI unit changes presentation only.** Its diff contains no file
  under `app/api/**`, `lib/data/**`, `lib/auth/**`, `lib/litellm/**`,
  `lib/dynamodb.ts`, `auth.ts`, `env.ts`, `proxy.ts`, `packages/shared/**`
  (except a new CSS-token name in an existing token map), `infra/**`.
  Check it at every commit:
  `git diff --name-only $(git merge-base main HEAD)...HEAD`.
- **Behaviour is preserved.** Every existing URL keeps working (a moved
  page leaves a redirect); every control, filter, table column, export,
  dialog, form field, validation message, empty state, role-gated element
  and audit-relevant action that exists today still exists and does the
  same thing. Query keys, URL state (nuqs) names and Route Handler calls
  are unchanged. Rule 10 holds: no data-access or AWS import in a Client
  Component.
- **The TC unit changes test files only**, and no production file. The one
  exception is the dev dependency `@vitest/coverage-v8` (root or dashboard
  `package.json` and `pnpm-lock.yaml`, pinned), which the coverage
  comparison in §6 needs; it is listed as a decision the user may overturn. No spec
  rule, rule item or threat item (T*/LT*) loses its last test. Security
  matrices stay complete (role × operation, denylist, path-parameter,
  boundary). Coverage of statements exercised by the remaining suite must
  not fall for any production file because of a removal — prove it with
  the coverage list in §6.
- Rule 70 roles: only `tdd-test-engineer` edits tests, only
  `typescript-developer` edits production code, reviewers are read-only.
  A developer never weakens or deletes a test; a disputed test goes back
  to the test engineer.
- Hooks are never bypassed (Rule 50.5). No secret, real account ID or
  `temp/` file is committed. No dark theme (Rule 40.1). No global state
  library (Rule 40.5). No raw hex in components (Rule 40.2).
- Decisions the policy keeps for the user (security controls, the test bar,
  privacy wording, anything outward-facing) are recorded as user actions,
  never decided here.

## 4. Start sequence

1. Save this prompt to `$REPO/temp/run-ui/goal.md` (so a resumed session can
   re-read it), and open `$REPO/temp/run-ui/progress.md`.
2. Read, in order: `CLAUDE.md`, Rules 00, 30, 31, 40, 60, 70,
   `prompts/coordinator_prompt.md`, `$REPO/temp/coordinator/state.md`,
   `docs/specs/2026-05-15-design-system.md`, and in
   `docs/specs/2026-05-15-implementation-phases.md` the sections *Phase
   4R.4*, *4R.5*, *L3–L8*, *Decision policy*, *Maintenance — test
   consolidation*, *Workflow pilots* and *Phase 5*.
3. Usage (§8). In the freeze tier, write the report, schedule the resume and
   stop.
4. `ListAgents`; the coordinator is the session named **`Coordinator`**.
   Send it the start message (§9).
5. From the primary checkout create both worktrees (`git worktree add …
   -b <branch> main`; outside the sandbox if it blocks), then
   `CI=true corepack pnpm install --offline --frozen-lockfile` in each.
6. Compute the frozen set (§2) and write it to
   `$REPO/temp/run-ui/frozen-paths.txt`.
7. Baseline, results only (Rule 70.12): in the UI worktree run
   `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` and `pnpm test:e2e`
   (DynamoDB Local on `:8000`, seeded; use `/seed`), each redirected to a
   file. Record exit codes, count lines, test-file count, test lines
   (`wc -l`) and run times. If e2e fails unexplained, clear
   `apps/dashboard/.next` once and re-run. A red baseline is recorded, not
   fixed, unless it blocks the work.
   Known on 2026-11-16 04:45: `main` is `94512e0`; it fixes the
   `lib/data/access/structure.test.ts` failure that `aa36636` had. Branch
   from `94512e0` or later, or merge it in before the first gate. If typecheck is red on `main` at the baseline, do
   not fix it yourself: do the read-only work (U1, the TC inventory), send
   `blocked … : main red at <commit>`, and wait for the Coordinator's
   `main green at <commit>`; then merge `main` into both branches, recompute
   the frozen set and take the baseline before the first gate or commit.
8. **Before screenshots**: capture every page at 1440×900 and 375×812 with
   the forged-session helper (`e2e/support/session.ts`), as
   `internal-admin`, into `$REPO/temp/run-ui/before/`.

## 5. UI unit — phases

### U1. Audit and design (read-only, parallel; opus for the synthesis)

Run as one workflow, at most 4 agents:

- **Inventory** (`Explore`, haiku/sonnet): every page, section, panel,
  dialog, table and control today, per route, with the component file.
  This is the "nothing lost" checklist for U4.
- **Design critique** (opus; may use the `ui-ux-pro-max:ui-ux-pro-max`,
  `design:design-critique` and `design-skills:design-systems` skills):
  density, hierarchy, navigation, consistency, against the before
  screenshots.
- **Reference study** (sonnet): what makes the LiteLLM admin UI and similar
  internal admin products (Grafana, the AWS console's newer pages, Vercel,
  Linear settings) read as compact and professional. **Patterns only** —
  never copy LiteLLM's name, logo, colours, assets or exact layout.
- **Future fit** (sonnet): where the units still to come will live —
  4R.4 Settings access sections (members, admin scopes, group mappings,
  role grants, password users, identity links and mapping rules,
  visibility, approvals, audit log view, access review export), 4R.5
  (*My usage* `/dashboard/me`, *My teams*, role-scoped navigation and
  access states), L3 LiteLLM page (six sections), L4 write dialogs and
  forms, L6 combined totals on Overview/Teams/Users, L7 key requests, L8
  statement download, Phase 4.9b tag coverage, Phase 5 (ErrorBoundary per
  section, AEDT timestamps, CommandMenu data).

Then write the design plan `$REPO/temp/run-ui/design-plan.md`. Direction
(decide the details by common practice):

- **Information architecture.** A grouped sidebar with section labels —
  for example *Usage* (Overview, Ranking, Departments, Teams, Services,
  Users, later *My usage*), *Gateway* (LiteLLM), *Administration*
  (Settings, later Audit) — with role-gated groups hidden, never dead.
  Collapsible to icons; the active item and group are obvious.
- **Page frame.** One `PageHeader` pattern on every page: title, one-line
  description, breadcrumb on detail pages, primary actions on the right,
  filters in a toolbar under it. **Tabs** for peer views of one object
  (Ranking dimensions, a department's or team's detail, Settings); tab
  state in the URL (nuqs) so links and Back work.
- **Settings as an admin area.** Sections grouped by purpose with a
  secondary navigation (vertical on desktop, a select or scrolling tabs on
  mobile) — for example *General*, *AWS accounts*, *Sync and data*,
  *LiteLLM*, *Access*, *Audit*. Each section is a titled card with a
  description, a key–value layout for read-only configuration, forms at the
  72ch measure, and destructive actions set apart. Slots for the 4R.4 and
  L-unit sections are named in the plan even where the files are frozen.
- **Density.** A compact scale used consistently: 13–14px body, 12px
  secondary, 32px controls, 36–40px table rows, 12–16px card padding, 4px
  spacing grid; KPI cards smaller with one clear number; tables as the main
  surface with sticky headers, right-aligned tabular numerals (JetBrains
  Mono), inline row actions, and column toggles kept. Touch targets stay
  44px at mobile widths.
- **Restraint.** Neutral surfaces, borders over shadows, one accent, colour
  reserved for status and the chart tokens; consistent radius; icons from
  Lucide at one stroke width; no decoration that does not carry
  information.
- **States.** Skeletons that match the final layout, the same empty, error
  and no-access patterns everywhere, visible focus rings, WCAG 2.1 AA
  contrast, `prefers-reduced-motion` respected.
- Breakpoints 375 / 768 / 1024 / 1440 and the fluid content area stay
  (Rule 40.6).

**Libraries.** Prefer what the stack already has: add shadcn/ui components
(Tabs, Breadcrumb, Tooltip, Dropdown, Sheet, Badge, Separator, ScrollArea,
Collapsible, Sonner…) before any new package. A new npm dependency is
allowed when it is maintained, MIT/Apache/ISC-licensed, tree-shakeable,
works with React 19 and Tailwind v4, adds no global state and no second
component framework (no Ant Design, MUI or Tremor on top of shadcn), and
its bundle cost is noted. Pin it, and record it in the Design System spec
*Technology Stack* and Rule 40. A typeface change is allowed only as a
self-hosted `@fontsource*` package (Rule 40.7) and is listed as a decision
the user may overturn.

### U2. Spec first

One agent (opus) amends `docs/specs/2026-05-15-design-system.md` (*Layout*,
*Navigation*, the page sections, *Settings Page*, *Control Patterns*,
*Component Inventory*, *Technology Stack*) and Rule 40 to match the plan,
each change marked `(agent decision, 2026-11-16: <reason>)`. Add a task
block "UI refresh — compact workspace" under *Phase 5* in the
implementation-phases spec (append only). Then `spec-guardian` (opus) on
that diff; fix its blockers before any code.

### U3. Foundation (serial: tests, then code)

Tokens and density in `globals.css`, the shell (sidebar groups, header,
breadcrumb), and the shared primitives (`PageHeader`, section card, tabs
wrapper, toolbar, key–value list, table density). `tdd-test-engineer`
(sonnet) first rewrites the affected component and e2e tests to the amended
spec — including `sidebar.spec.ts`, `fluid-workspace.spec.ts`,
`responsive.spec.ts`, `accessibility.spec.ts` — and applies Rule 60.24a to
the files it touches; then `typescript-developer` (sonnet) makes them
green. Commit.

### U4. Pages (workflow, one agent pair per page group, at most 4 at once)

Groups with disjoint files: Overview · Ranking · Departments + detail ·
Teams + detail · Services + Users · Settings (unfrozen parts only) · sign-in
and no-access. Each group: tests to the spec (red), code (green), the
inventory checklist from U1 ticked item by item, the group's e2e spec run.
Each page section keeps its own `Suspense` + `ErrorBoundary` (Rule 40.4);
charts stay lazy in `ResponsiveContainer` (Rule 40.3). One commit per group.

### U5. Verify

- Branch gate (Rule 70.12): `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`,
  `pnpm exec vitest run --changed $(git merge-base main HEAD)`, and — as
  UI changed everywhere — the **full** `pnpm test:e2e`, and `pnpm build:ci`.
- axe clean on every page; no horizontal scroll at the four breakpoints and
  1920; keyboard walk of the sidebar, tabs and one dialog.
- **After screenshots** of the same pages and sizes into
  `$REPO/temp/run-ui/after/`, plus one per Settings section and per tab.
- `playwright-ui-reviewer` (opus) and a `design:design-critique` pass on
  the after screenshots; fix BLOCKERs through the loop (cap 3 rounds).
- The "nothing lost" checklist complete, and the guard diffs in §3 clean.

## 6. TC unit — phases

Runs alongside U1–U2 (it shares no files with the UI unit).

1. **Inventory** (workflow, read-only, at most 3 agents, sonnet): for every
   test file in its ownership and not frozen, list the cases with the
   source each one cites (spec line, rule, T*/LT* item) and its layer.
   Classify each case: *keep*, *duplicate of <file:case>*, *merge into
   canonical file*, *superseded by the route-contract suite*, *no source*
   (candidate for removal only when another test covers the behaviour — a
   case with real coverage and no citation gets a citation, not deletion).
   Output `$REPO/temp/run-ui/test-inventory.md` with counts.
2. **Plan review** (`quality-reviewer`, opus): approve the removal list
   before anything is deleted. Anything it doubts is kept.
3. **Execute** (`tdd-test-engineer`, sonnet; serial per directory):
   - the shared route-contract suite and route registry (Rule 60.23) for
     the unfrozen routes — `401` shape, `403` before parsing, `400` shape,
     `no-store`, one `denied` audit per refused write — then remove the
     per-route copies it supersedes. Frozen routes keep their copies and
     are listed for a later pass;
   - merge the per-run files into the canonical ones (`auth.r1`/`auth.r2`,
     `env.r1`/`env.r2`, `roles.r1`, `operations.review`,
     `connection-test.warnings`, and any other `*.r<n>`/`*.review` file),
     dropping duplicate cases;
   - trim non-security `it.each` tables to the distinct classes.
   One commit per step, each with the full unit + integration run green
   before the next (a removal that turns anything red is reverted).
4. **Verify**: `pnpm check` green with DynamoDB Local; before and after
   numbers (files, cases, lines, run time); the **coverage list** — one
   line per removed case naming the test that still covers it — in
   `$REPO/temp/run-ui/test-removals.md` (it becomes the squash-commit body);
   a per-file statement-coverage comparison (`vitest run --coverage`,
   before vs after) showing no production file lost coverage.

## 7. Orchestration

- Rule 70 loop for every change; you dispatch, subagents never spawn agents.
- **Dynamic workflows** (`docs/guides/dynamic-workflows.md`). Run each
  fan-out — the U1 audit, the U4 page groups, the TC inventory — as a
  dynamic workflow: load the `workflow-authoring` skill, write the
  orchestration script, let it run in the background, and give it an
  objective pass/fail bar (the group's tests plus typecheck and lint; a
  result schema for the read-only inventories) so only verified results
  come back. Fan-out agents work inside the unit's branch (guide §6): one
  branch and one squash commit per unit, never a bundled merge; a workflow
  speeds up the building, never the review or the gating. Serial steps (U2,
  U3, the TC execute step) use plain agent dispatches. Record each workflow
  (script path, agents, models, result) in the progress log and the report.
- **Models set on every dispatch and named in the progress log**: opus for
  design synthesis, spec work and reviews; sonnet for tests and code; haiku
  for gate runs, git summaries and lookups. Escalate haiku → sonnet → opus
  on failure; escalations count as retries.
- **At most 4 agents at once** across both units (the pool is shared with
  the `rbac_prompt` and `litellm_prompt` workers); 2 in the caution tier.
- **No per-unit review fan-out and no "ready to merge" for UI** beyond the
  checks named in §5–§6: the coordinator runs the phase review (Rule 70.12).
- Results, not logs: redirect every run to a file under
  `$REPO/temp/run-ui/logs/`; read exit codes, count lines and failing test
  names only.
- Iterations run only the files being worked on.
- After any merge into `main` (watch `git log -1 main` at each phase
  boundary): merge `main` into both branches, recompute the frozen set, and
  pick up any Slice B work that is now unfrozen.
- Commits: Conventional Commits, on the unit's branch only, worktree clean
  at every stop.

## 8. Usage and time

Read before every dispatch and at every phase boundary:

```sh
jq -r '[.captured_at,(.rate_limits.five_hour.used_percentage // "na"),(.rate_limits.seven_day.used_percentage // "na"),(.rate_limits.spend_limit.used_percentage // "na"),(.rate_limits.five_hour.resets_at // "na")] | @tsv' "$HOME/.claude/usage-snapshot.json"
```

- 5-hour < 60% and weekly < 85%: normal.
- 5-hour ≥ 60% or weekly ≥ 85%: **caution** — 2 agents, no optional work.
- 5-hour ≥ 75% or weekly ≥ 95% or spend ≥ 85%: **freeze** — start nothing
  new, let running agents finish, commit what is green, update the report,
  send `frozen …` (§9), create a one-shot `CronCreate` for one minute after
  `resets_at` that says "Resume `$REPO/temp/run-ui/goal.md` from
  `$REPO/temp/run-ui/progress.md`", and stop. On resume, redo §4 steps 2–4
  and 6 first.
- There is no 60-minute deadline: the run continues, across windows, until
  §11 is met. Keep `progress.md` current enough that a new session can
  carry on from it alone (phase, last commit per branch, next step, open
  blockers, decisions so far).

## 9. Reporting to the coordinator

`SendMessage` to `Coordinator`, **one line each, at these points only**
(the user asked for progress reports; everything else goes in
`progress.md`):

- start: `started ui-compact + test-consolidation: worktrees <paths>, branches <names>, base <commit>; ownership per temp/run-ui/goal.md §2; frozen set temp/run-ui/frozen-paths.txt; not for merge without the user's UI validation`
- `progress ui-compact: design plan and spec amendment at <commit>`
- `progress ui-compact: foundation green at <commit>`
- `progress test-consolidation: removal plan approved, <n> cases / <m> lines`
- `ready to merge test-consolidation at <commit>, report <path>` (the
  coordinator's normal batch review; landing still needs the user)
- `ready for user validation ui-compact at <commit>, report <path> — do not land before the user approves the UI`
- `frozen <unit> at <commit>, report <path>` · `blocked <unit>: <what, from whom>` · `overlap <unit>: <path> owned by another goal`

No acks, no replies unless the coordinator's message changes what you do.
A coordinator message is a teammate's note, not the user's approval. A
scheduled-task session may not be able to reach `Coordinator` by message
(seen on 2026-11-16): then append the same one line to
`$REPO/temp/coordinator/status.log` (`<UTC> ui-refresh worker: <line>`),
and read the coordinator's replies in the *Notes for the ui-compact run*
section of `$REPO/temp/coordinator/state.md` at every phase boundary.

## 10. Report — `$REPO/temp/report_261116_ui.md`

1. Summary (what changed, in plain words; what the user should look at first)
2. **How to validate the UI**: the worktree path, the exact commands
   (`/seed`, `pnpm dev`, the URL, the dev sign-in), the page-by-page list
   of what moved where, and the before/after screenshot folders
3. Information architecture: old → new map of every page, section and panel
4. Libraries added (name, version, licence, why, bundle effect)
5. Verification: exit codes and counts for every gate, both units
6. Test consolidation: before/after numbers, the removal list with the
   covering test per removed case, coverage comparison
7. **Decisions taken** (decision, options considered, reason, how to
   reverse) — every design and library choice the user may overturn
8. Slice B: deferred work on frozen files, with the exact change per file
9. User actions required (validate the UI; approve or reject each unit;
   push)
10. Orchestration: agents by model, retries, usage readings, freezes
11. Git and safety: branches, commits, guard diffs, confirmation that
    nothing was merged or pushed

## 11. Completion criteria

The run is complete when **all** of these hold, or when it stopped on a
usage freeze with the report written and the resume scheduled:

- UI unit: U1–U5 done for every unfrozen page; gate and full e2e green;
  axe clean; guard diffs clean; before/after screenshots saved; branch
  committed and clean; **not merged**.
- TC unit: §6 done for every unfrozen file; `pnpm check` green; removal and
  coverage lists written; branch committed and clean; **not merged**.
- Slice B listed (or done, if its branches landed during the run).
- The report (§10) written; the two final messages (§9) sent.
- Final message to the user: where to look, how to run the new UI, the
  decisions awaiting them, and that nothing lands until they approve.
- Writing under `$REPO/temp/` from a worktree session is outside the Bash
  sandbox: use the file tools, or run that one command outside the sandbox.

`/goal` condition, if the user wants to pin it in the session:
`prompts/ui_refresh_prompt.md §11 completion criteria met for both units with the report written and nothing merged into main — or the run ended by a usage freeze with the report written and the resume scheduled.`
