# LiteLLM Role Views and Settings Prompt — dev identity login (L3c), Settings admin area, acceptance of L3b, no overlapping components

You are a **worker session** under the coordinator
(`.claude/prompts/coordinator_prompt.md`). You orchestrate agents through the
Rule 70 loop; you write no production code or tests yourself.

Primary checkout: `/Users/fibanez/Projects/aws-bedrock-cost-tracker` (`$REPO`).
Read specs, rules and state from `$REPO` (`main`). The one exception:
until L3b is on `main`, its spec lines (LiteLLM spec — *Views by role*,
LD22, LT21; the L3b and L3c blocks) exist only in
`$REPO/.claude/worktrees/l3b-role-views` — read them there, read-only.
Never edit in the primary checkout, on `main` or in another session's
worktree. Writing under `$REPO/temp/` from a worktree session is outside
the Bash sandbox: use the file tools, or run that one command outside it.

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`plans/shared-contracts.md` → `plans/litellm.md` (run discipline,
role model, LiteLLM threat items) → `.claude/prompts/coordinator_prompt.md` → this
file. This file never overrides a rule.

## 1. What the user asked for (2026-11-16)

Items 1–5 came first; item 6 was added the same day after the user had
merged `main` (`3916b28`) into their branch.

1. **Settings → LiteLLM "looks ugly and complex."** Use appropriate tabs
   instead of one large page, and include a **search** that makes it easy
   to find a user.
2. **Local dev login as a specific user** (id or email) — for example to
   see the LiteLLM usage of an existing user in the dev LiteLLM.
3. **Team lead:** sees **team usage**, **each team member's usage**, and
   the **lead's own usage** when the lead is also a LiteLLM user. Tabs or
   pages, whichever reads better.
4. **Org admin:** sees **organisation usage**, **teams' usage**, **users'
   usage**, and **their own usage** when they exist in LiteLLM.
5. **No overlapping UI components.** Both meanings (confirmed by the user,
   2026-11-16):
   - **no duplicates** — one component per purpose, shared by every page
     that needs it;
   - **no visual overlap** — nothing covers, clips or collides with
     anything else at any breakpoint.

6. **The Settings page "looks ugly and very large."** Break it down into
   multiple tabs or pages, and add a **search to find users or
   configuration**.

## 2. What already exists — do not rebuild it

The user gave items 1–4 to the `litellm_prompt` worker on 2026-11-16, and
they became two units in the implementation-phases spec:

| Unit | Branch | State on 2026-11-16 05:00 AEDT (`main` `3916b28`) |
|---|---|---|
| **L3b** — views by role and Settings → LiteLLM tabs | `feature/phase-l3b-litellm-role-views` | **on `main`** (`6d0bf13`), landed at the user's direction before its review fixes. `litellm_prompt` is fixing B1 per-user cost cap, B2 focus ring, B3 tab keyboard test (`temp/run-l3b/review-blockers.md`); wait for the coordinator's `main updated` before touching `components/litellm/**`, `LiteLLMPanel*` or `components/ui/tabs.tsx` |
| **L3c** — dev identity login | `feature/phase-l3c-dev-identity-login` | **not started; assigned to this run** by the coordinator (2026-11-16). `auth.ts` is released — **additive changes only** |
| **4R.4 fix** | — | **on `main`** (`718c0e0`): the Settings access sections, `auth.ts`, `globals.css` and the Design System spec are no longer frozen by it |
| **Test consolidation 1a–1b** | — | **on `main`** (`3916b28`): the shared route-contract suite and registry (`apps/dashboard/test/route-registry.ts`, `app/api/__tests__/route-contract.integration.test.ts`). A new route is added to the registry, not given its own 401/403/400 copies (Rule 60.23) |
| **ui-compact** design plan | `feature/ui-compact-workspace` (no code yet) | `$REPO/temp/run-ui/design-plan.md` §1.3 and §3 already design the Settings admin area (groups, `?section=`, `SettingsNav`, hash resolver, `Panel`, `KeyValueList`). **Unit D builds that design; it does not invent a second one** |

L3b delivers (LiteLLM spec — *Views by role*, LD22, LT21; Design System —
*LiteLLM Page*): `/dashboard/litellm` as tabs *My usage*, *Team*,
*Organisation*, *Users*, *Audit* (`?tab=`); routes `/api/litellm/org`,
`/api/litellm/users`, `/api/litellm/users/[litellmUserId]`; the `searchUsers`
allowlist row; *My usage* for an unlinked caller through `findUserByEmail`;
Settings → LiteLLM as tabs *Connection*, *Guardrails*, *Team links*,
*Users*; one shared `UserSearch`; the shadcn `components/ui/tabs.tsx`.

**So this run has four units, in this order, and only these:**

| # | Unit | Branch (from `main`) | Needs first |
|---|---|---|---|
| B | **L3c** — dev identity login | `feature/phase-l3c-dev-identity-login` | nothing — start here |
| D | **Settings admin area** — sections, tabs and search | `feature/settings-admin-area` | the L3b fix on `main` (it touches `LiteLLMPanel` and `tabs.tsx`). Ownership is settled (coordinator, 2026-11-16 05:10): this run owns `app/dashboard/settings/**` and `components/settings/**`; the ui-compact run dropped the Settings page from its scope and its design plan §1.3 and §3 are input for D |
| A | **L3b acceptance** — the gaps G1–G7 (G5 decided: Auditor read-only, row 2a) | `fix/l3b-acceptance` | the L3b fix on `main` (`main updated`). `litellm_prompt`'s fix is limited to B1 (cost cap), B2 (focus ring), B3 (tab keyboard test) and the review warnings — **never repeat those here** |
| C | **Component overlap** — duplicates and visual overlap on the LiteLLM, Settings and sign-in surfaces | `fix/litellm-ui-overlap` | A and D |

One branch, one worktree (`$REPO/.claude/worktrees/<slug>`) and one squash
commit per unit (Rule 30.4). If a dependency is not on `main`, do the
read-only part of the unit (§4 A1, C1), send `blocked <unit>: needs <x> on
main`, and wait for the coordinator's `main updated`. Gaps G1–G7 were found on 2026-11-16
(`$REPO/temp/run-l3c/acceptance.md`) and sent to the coordinator; G1–G4,
G6 and G7 stay in unit A, and **G5 is decided by the user: Auditors get
Settings → LiteLLM read-only, as the spec says.**

## 3. Ownership and guards

- **Owns:** `apps/dashboard/components/litellm/**`,
  `components/settings/LiteLLMPanel*`, `app/dashboard/litellm/**`,
  `app/api/litellm/**`, `lib/litellm/**`, the LiteLLM schemas in
  `packages/shared`, `e2e/litellm*.spec.ts` and `e2e/settings-litellm*.spec.ts`;
  for unit B also `components/auth/SignInOptions*`, `app/sign-in/**`, the
  dev-login branch of `auth.ts` and its helpers in `lib/auth/`, and
  `e2e/dev-login.spec.ts`; for unit D (moved from the ui-compact run by
  the coordinator on 2026-11-16), `app/dashboard/settings/**`,
  `components/settings/**`, `lib/settings-search-params.ts`, and
  `e2e/settings*.spec.ts`. Spec lines: the LiteLLM spec, Access Control —
  *Dev login*, Design System — *LiteLLM Page*, the L3b/L3c blocks in
  implementation-phases (append only).
- **Not yours:** everything in another active goal's diff
  (`temp/coordinator/state.md`; recompute with
  `git -C $REPO diff --name-only main...<branch>` per active branch at the
  start and after every `main` merge). In particular the **ui-compact** run
  owns the shell, tokens (`globals.css`), shared primitives and every other
  page; it treats this run's paths as frozen and this run treats its paths
  as frozen. An overlap is reported with `overlap <unit>: <path>`, never
  worked around.
- **One Tabs component.** `components/ui/tabs.tsx` is the only one. Never
  add a second tabs, search, table, section-card or page-header component;
  when the ui-compact primitives (`PageHeader`, section card, key–value
  list, toolbar) are on `main`, adopt them rather than keeping local
  equivalents. Read `$REPO/temp/run-ui/design-plan.md` for the density and
  layout the LiteLLM surfaces must match.
- **Security is not negotiable** (Decision policy — *Still the user's*):
  - the dev login stays rejected when `APP_ENV=prod` and whenever Entra is
    configured, in `auth.ts` and in the env schema, and never appears in a
    production build's sign-in page (T7, LT21);
  - a chosen dev identity supplies **who** the session is (oid, email,
    name); it never supplies roles, grants or scope — the role choice does;
  - no production bypass for testability (Rule 70.11);
  - Lead scope holds everywhere: a Lead's search and user detail see only
    members of its linked teams, and out-of-scope returns the same `404` as
    missing; a Viewer gets `403` on team, organisation and user routes;
  - the service key never reaches the browser; every LiteLLM call goes
    through `lib/litellm/**` and the allowlist (Rule 10.2).
- Never merge into `main`, never push, never delete a branch. Hooks are
  never bypassed. Rule 70 roles hold; a developer never edits a test.

## 4. The units

### A. L3b acceptance (`fix/l3b-acceptance`)

**A1 — check (read-only; one `Explore` on sonnet plus the orchestrator).**
Sign in through the forged-session helper against the fake LiteLLM (and the
local LiteLLM at `localhost:4000` when `apps/dashboard/.env.local` has it)
and fill this table in `$REPO/temp/run-l3c/acceptance.md` with evidence
(spec line, test name, screenshot at 1440 and 375):

| # | The user must be able to | As |
|---|---|---|
| 1 | open Settings → LiteLLM and see short tabs, not one long page; no tab taller than about two screens at 1440 | Admin |
| 2 | find a LiteLLM user by email or id from Settings and from the LiteLLM page, with a labelled input, keyboard use, a clear "no results" and a loading state | Admin, org-admin, Lead |
| 2a | open Settings → LiteLLM **read-only** as an Auditor (user decision, 2026-11-16: follow the spec — Design System *LiteLLM Page*, "read-only for `internal-auditor`"): every tab visible, including the user search; no save, test, toggle, reset or link control enabled; every write route still `403` | Auditor |
| 3 | see the team's spend and budget | Lead (own team) |
| 4 | see **every member's** usage — spend, budget, limits, and a member's daily spend on selection | Lead (own team) |
| 5 | see **their own** usage when they are a LiteLLM user, linked or resolved by email; a clear neutral state when they are not | Lead, org-admin |
| 6 | see organisation totals and a per-team table, and open a team from it | org-admin |
| 7 | see any user's usage through search | org-admin |
| 8 | not see what is out of scope: other teams' members (Lead), any team/org/user view (Viewer); hidden tabs, `404`/`403` parity | Lead, Viewer |
| 9 | use every tab at 375 / 768 / 1024 / 1440 with no horizontal scroll; axe clean | all |
| 10 | link to a tab and use Back (`?tab=`), and land on *My usage* from a tab they cannot use | all |

**A2 — fix only what fails.** Each failing row becomes one blocker: the
`tdd-test-engineer` (sonnet) writes the failing test at the lowest layer
that sees it (Rule 60.24a), the `typescript-developer` (sonnet) makes it
green. A row that passes gets no code. The static check of 2026-11-16 found the
rows to fix: G1 (member daily spend from the Team tab), G2 (open a team
from the Organisation table; `team` as URL state), G3 (tab state in the
URL with `history: "push"`), G4 (width and axe coverage of every tab with
data — shared with unit C2), G5 (row 2a, Auditor read-only), G6 (Guardrails
grouped by entity, one-line description per operation, "Enforced in code"
collapsed), G7 (empty states that explain themselves and link to Settings
→ Team links). Re-check each on `main` after the L3b fix before writing a
test for it.

**A3 — presentation ("ugly and complex").** For the Settings → LiteLLM tabs
and the LiteLLM page, one design critique (opus; may use the
`design:design-critique` and `ui-ux-pro-max:ui-ux-pro-max` skills) against
the ui-compact design plan: read-only configuration as a key–value list,
one primary action per tab, forms at the 72ch measure, toggles grouped with
a one-line description each, tables as the main surface, the same empty,
error and "not configured" states. Fix P0/P1 findings through the loop;
list the rest in the report.

### B. L3c — dev identity login (`feature/phase-l3c-dev-identity-login`)

Spec: Access Control — *Dev login* (amended 2026-11-16) and the L3c block
in implementation-phases.

- The dev sign-in form (shown only outside `prod` and only without Entra)
  keeps its role choice and gains an optional **identity** field: an email
  or a dashboard `oid`.
  - An identity that exists in DynamoDB signs in **as that identity** (its
    `oid`, email, name).
  - An unknown email signs in as a dev identity with that email and a
    stable `dev-` `oid` derived from it.
  - Empty keeps today's behaviour.
  - Input is Zod-validated at the boundary (email or `oid` shape, length
    cap); an invalid value is a field error, not a 500.
- A short picker of known identities (seeded identities, most recent
  first, searchable) next to the field is allowed if it is cheap — decide
  by common practice and record it.
- The session shows who you are signed in as (user menu: name, email, role,
  "dev login").
- **The user's example must work end to end:** sign in as the email of a
  user that exists in the dev LiteLLM → *My usage* shows that user's spend,
  budget and daily spend (through `findUserByEmail`); sign in as a Lead's
  identity → *Team* shows that Lead's teams.
- Tests (the test engineer writes them first): identity resolution
  (existing `oid`, existing email, unknown email → stable `dev-` oid, same
  email → same oid); the role comes only from the role choice; refused when
  `APP_ENV=prod` and when Entra is configured (auth callback **and** env
  schema); the field is absent from the production sign-in page; an audit
  record for the sign-in names the dev method and the chosen identity; e2e
  for the user's example against the fake LiteLLM.
- The dedicated security review this unit requires (T7, LT21) is part of
  the coordinator's one review — say so in the `ready to merge` report.

### D. Settings admin area (`feature/settings-admin-area`)

Today `/dashboard/settings` is one column of 15 `h2` sections, about
12,000 px tall for an Admin (ui-compact audit, finding P0). The largest
parts are the access sections (`components/settings/access/**`, ten
sections), the LiteLLM panel and the identity mapping editor.

**D1 — spec first.** One agent (opus) amends Design System — *Settings
Page* (and *Component Inventory*) from the ui-compact design plan §1.3 and
§3, marked `(agent decision, 2026-11-16: <reason>)`, and adds a task block
"Settings admin area" under *Phase 5* in implementation-phases (append
only). `spec-guardian` (opus) on that diff before any code.

**D2 — structure.** Decide the details by common practice; the direction:

- **One route, sections in the URL.** `/dashboard/settings?section=<slug>`
  (nuqs, `history: "push"`, so links and Back work); only the selected
  section group renders. Groups, in the design plan's order: *AWS
  accounts* (default), *Sync and data* (sync status, data retention),
  *LiteLLM*, *Access*, *Audit* (audit log, access review export). A group
  the caller cannot use is not listed and a direct link falls back to the
  first visible one.
- **Secondary navigation** (`SettingsNav`): vertical and sticky from
  `lg`, a select or scrolling tabs below it; the current item is marked
  with `aria-current`.
- **Access is itself split**: its ten sections become sub-tabs or a
  sub-nav grouped by purpose — *People* (members, team admins, pending
  access, per-user approval), *Roles* (role grants, group mappings),
  *Sign-in* (password users), *Identity* (identity links, mapping rules),
  *Visibility*. One sub-section on screen at a time (`?section=access&view=<slug>`).
- **The LiteLLM group** keeps L3b's tabs, with their state in the URL too
  (gap G3) — the same Tabs component.
- **No view taller than about two screens at 1440.** Long lists get a
  filter box and 20-row pagination; read-only configuration becomes a
  key–value list; each view has a title, a one-line description and at
  most one primary action; destructive actions sit apart.
- **Old links keep working.** A hash such as `#role-grants` or
  `#password-users` opens the group and view that now holds it.
- **Nothing is lost and nothing changes behaviour.** Every section,
  field, dialog, step-up prompt, validation message and role gate that
  exists today still exists. Visibility still comes from
  `accessCapabilities(viewer)`. No change under `app/api/**`,
  `lib/auth/**` or `lib/data/**`, except the one search route below if it
  is needed. Tick an inventory of today's sections and controls
  (`$REPO/temp/run-ui/ui-inventory.md`, the `SET-*` rows) item by item.

**D3 — search ("find users or config").** One search box in the Settings
header, labelled, keyboard-first (`/` focuses it, arrows and Enter move
and open, Escape closes), with two result groups:

- **Settings** — every section, view and named setting (for example
  "Base URL", "Operation toggles", "Group mappings", "Data retention"),
  matched on title and keywords from one registry that also feeds
  `SettingsNav`. Opening a result goes to that view and moves focus to the
  setting. The registry is filtered by the caller's capabilities, so
  search never reveals a section the caller cannot open.
- **People** — find a person by name, email or id across members, team
  admins, role grants, password users, identity links and pending access.
  Each result says where the person appears; opening one goes to that
  view with its list filtered to that person. Use the data the views
  already load where that is enough; if a server search is needed, add one
  Route Handler that follows Rule 10.3 in full (session, policy scope,
  Zod, `{ data }`/`{ error }`, `no-store`, an entry in the route registry)
  and returns only rows the caller may already see — an out-of-scope
  person is simply absent. LiteLLM users stay in the existing `UserSearch`.
- Clear "no results", loading and error states; results announced to
  screen readers; the query is never logged.
- Optional, only if cheap: list the Settings views in the app-wide
  `CommandMenu`.

**D4 — tests** (test engineer first; Rule 60.24a, one layer per
behaviour): the section and view registry per role (who sees what); the
fallback for an unknown or forbidden `section`/`view`; the hash resolver;
search matching, role filtering and "no results"; the search route's scope
through the shared route-contract suite; e2e per role — reach every view
from the nav and from search, Back steps through views, no view exceeds
two screens at 1440 for the seeded data, no horizontal scroll at the four
breakpoints, axe clean on every view. The existing Settings specs that
expect every `h2` on one page are rewritten to the amended spec by the
test engineer, never weakened by a developer.

**D5 — verify.** Before/after screenshots of every view at 1440 and 375
as Admin, Auditor, org-admin and Lead into `$REPO/temp/run-l3c/settings/`;
the page height before and after per role in the report.

### C. Component overlap (`fix/litellm-ui-overlap`)

**C1 — duplicates (read-only inventory first).** List, for the owned
surfaces, every component and where it is used; flag any two that do the
same job (tabs, search inputs, tables, section wrappers, badges, empty
states, date/time formatting, team pickers). Resolve each by keeping one
and switching its callers; a component used once that copies a shared one
is replaced by the shared one. The Settings *Users* tab and the LiteLLM
*Users* tab render the **same** `UserSearch`. No behaviour changes.

The inventory of 2026-11-16 on the L3b branch
(`$REPO/temp/run-l3c/duplicates.md`) found, and unit C resolves in this
order:

1. *Inside the owned surfaces (do first):* one `formatBudget` helper for
   the "No limit" budget text (six copies); the shared error text
   (`FormError`) instead of the repeated `<p role="alert">` in
   `LiteLLMPanel` and `UserSearch`; `Badge variant="secondary"` for the
   hand-styled source pill in `LiteLLMPanel`.
2. *Touching files outside the owned surfaces (send `overlap C: <path>`
   and wait for the coordinator's answer before each):* `NativeSelect`
   moved to `components/ui/` and adopted by `TeamArea`, `SignInOptions`
   and `CardSortControl`; one shared `Switch` for the two
   `role="switch"` buttons (`LiteLLMPanel`, `PasswordUsersSection`); one
   shared `formatCount` for the repeated `Intl.NumberFormat("en-US")`.
3. *Only if it needs no new behaviour:* `SearchInput` inside `UserSearch`
   (needs `label`/`id`, `maxLength`, `className` props) and a compact
   `EmptyState` variant for the inline "empty / unavailable / not
   connected" notes.

**Keep as they are — look alike, differ on purpose:** `LiteLLMSection` vs
`OverviewSectionCard` (pending-aware region, badge slot); `sydney-time.ts`
vs `format-last-run.ts` (LD20 vs Rule 20.1); `RankingTabs` (not a LiteLLM
tab set, outside this run); the plain `ui/table` tables vs the sortable
`UsageTable`; the RPM/TPM "-" vs the budget "No limit".

**C2 — visual overlap.** A Playwright spec (`e2e/litellm-layout.spec.ts`)
that, per role and per tab on the LiteLLM page and every Settings view, at 375 / 768 / 1024 / 1440:
asserts no horizontal scroll; asserts that the bounding boxes of the tab
list, the toolbar, each section, the table and the page header do not
intersect; opens the search results, a select, a dialog and the user menu
and asserts they sit above the content, inside the viewport, and do not
cover their own trigger's label; checks long values (a 60-character email,
a long team name, a seven-digit spend) truncate or wrap without pushing
anything out. Fix what it finds through the loop.

## 5. Run discipline

- **Start:** save this prompt to `$REPO/temp/run-l3c/goal.md`; open
  `$REPO/temp/run-l3c/progress.md`; read the files in *Precedence* and the
  spec sections named above; read usage; `ListAgents` and tell the
  coordinator (session `Coordinator`) which units you are starting; create
  the worktree for the first unit that is unblocked
  (`git worktree add … -b <branch> main`, then
  `CI=true corepack pnpm install --offline --frozen-lockfile`).
- **Agents:** at most 2 at once (worker limit). Set and name the model on
  every dispatch: opus for design critique and rulings, sonnet for tests
  and code, haiku for gate runs and lookups.
- **Decisions:** decide open items by common practice and the nearest spec
  precedent, mark the spec line `(agent decision, <date>: <reason>)`, list
  them in the report's *Decisions taken*. Anything in §3 *Security* is the
  user's.
- **Gate per unit** (Rule 70.12): `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`,
  `pnpm exec vitest run --changed $(git merge-base main HEAD)`, and the
  targeted e2e specs for the touched surfaces. Results, not logs: redirect
  to `$REPO/temp/run-l3c/logs/`, read exit codes, count lines and failing
  names only. No review fan-out and no full suite of your own.
- **Usage:**
  `jq -r '[(.rate_limits.five_hour.used_percentage // "na"),(.rate_limits.seven_day.used_percentage // "na"),(.rate_limits.five_hour.resets_at // "na")] | @tsv' "$HOME/.claude/usage-snapshot.json"`
  before each dispatch. 5-hour ≥ 60% or weekly ≥ 85%: no optional work
  (A3 P2 findings, the identity picker). 5-hour ≥ 75% or weekly ≥ 95%:
  start nothing new, commit what is green, write the report, send
  `frozen …`, stop.
- **Messages to the coordinator, one line each, only these:**
  `ready to merge <unit> at <commit>` · `frozen <unit> at <commit>, report <path>` ·
  `blocked <unit>: <what, from whom>` · `overlap <unit>: <path> owned by another goal`.
  If `Coordinator` cannot be reached by message, append the same line to
  `$REPO/temp/coordinator/status.log` and say so in the report.
- **UI changes need the user's eyes.** Units D and A change what the user
  sees: they end with `ready for user validation <unit> at <commit>`, not
  `ready to merge`, and the report says how to run them (`/seed`,
  `pnpm dev`, the URL, the dev sign-in).
- **Report:** `$REPO/temp/report_2611DD_l3c.md` — summary; the acceptance
  table with evidence; per-unit gate results; before/after screenshots of
  Settings → LiteLLM and each LiteLLM tab per role; duplicates removed (kept
  component, callers switched); decisions taken; user actions (how to try
  the dev identity login: the command, the URL, an example email); what was
  deferred and why; confirmation that nothing was merged or pushed.

## 6. Completion criteria

- Unit A: every row of the acceptance table passes with evidence, or its
  fix is committed with the gate green; A3 P0/P1 findings fixed.
- Unit B: the L3c task and Verify lines in implementation-phases are
  satisfied (boxes ticked on the branch); the user's example passes in e2e.
- Unit D: the Design System spec amended and approved by `spec-guardian`;
  Settings is sections and views in the URL with a secondary nav; no view
  taller than two screens at 1440; the search finds settings and people
  within the caller's scope; old hash links resolve; the inventory is fully
  ticked; e2e and axe green per role.
- Unit C: no duplicate component on the owned surfaces (LiteLLM, Settings,
  sign-in); the layout spec is green for every role, tab and breakpoint.
- Each unit committed, its worktree clean, `ready to merge` sent; the
  report written. **Nothing merged into `main`** — the coordinator lands
  each unit after its review and the user's approval.

`/goal` condition:
`plans/litellm_role_views.md §6 completion criteria met for this run's units, and the report written — or the run ended by a usage freeze or a missing dependency, with the report written.`
