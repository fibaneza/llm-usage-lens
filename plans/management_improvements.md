# Management Improvements Prompt — LiteLLM area, app teams, users, source panels, and budget reset first (units M0–M5)

You are a **worker session** under the coordinator
(`.claude/prompts/coordinator_prompt.md`). You orchestrate agents; you write no
production code or tests yourself. You run several agents **in parallel**,
through Claude Code **workflows** (§7).

Primary checkout: `/Users/fibanez/Projects/aws-bedrock-cost-tracker` (`$REPO`).
Each unit has its own worktree under `.claude/worktrees/` and its own branch,
created from an up-to-date `main` (Rule 31). Never edit in the primary
checkout or on `main`.

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`plans/shared-contracts.md` → `.claude/prompts/coordinator_prompt.md` → this file.
This file never overrides a rule. Where it disagrees with a rule or a spec,
the spec step amends that rule or spec first (M4 for its own items, M0 for
the rest), with the user's direction and date — never diverge silently
(Rule 00.2).

**Start condition:** LiteLLM unit **L6** is on `main` (it was in its last
review round at `ae9c4c9`). L6 changes `lib/settings-tabs.ts`,
`components/litellm/UserSearch.tsx`, `app/dashboard/me/MeContent.tsx`, the
Teams and Users pages and the specs. If L6 is not on `main`, run only M4
and M0, and merge `main` into each before you report it ready. M4 does not
wait for L6: it sends `overlap mg-4: app/dashboard/me/MeContent.tsx` and
keeps L6's lines when it merges.

## 1. What the user asked for (2026-11-17)

| # | Request | Unit |
|---|---|---|
| 1 | Sign-in options: the team lead role is missing | M3 |
| 2 | Under Management the LiteLLM option is gone; put it back, to manage LiteLLM teams and users | M1 |
| 3 | On the Team page: a way to create a new team (app team) | M2 |
| 4 | In the LiteLLM option: map an app team to a LiteLLM team, for admin and org-admin | M1 |
| 5 | On the Team page: remove the "Team spend" section — "it is already covered under usage options" | M2 |
| 6 | A viewer can ask the team lead to reset their budget. The lead gets a notification, and can approve (which resets) or deny from the notification. The user is notified of the result | **M4 — top priority** |
| 7 | Every budget reset is stored in the database, with the total amount reset and the timestamp | M4 |
| 8 | Every role can see how many on-demand budget resets happened | M4 |
| 9 | "re-order the management options; 1 user - 2 team - 3 organization" | M1 |
| 10 | "organization should be part of litellm option" | M1 |
| 11 | In Usage, "My usage" is the second option | M1 |
| 12 | Management → Users: add or create new users | M3 |
| 13 | "in litellm option, should able to link app user to litell user if they email/username not exist on litellm, if the email exist, map them with a approval" | M3 |
| 14 | Cost by team, Cost by user, Cost by service: show clearly whether a cost is from Bedrock or from LiteLLM, never together — a different chart or panel for each — plus a global sum of both | M5 |
| 15 | In the team link form, "Dashboard team ID" and "LiteLLM team ID" are dropdowns that list every app team and every LiteLLM team | M1 |
| 16 | The Users tab under Settings moves to Management → LiteLLM, and shows **all users**, or the **members of one team** — a list, not only a search (the user numbered this one 15 as well) | M3 |

Five directions for the run, all from the user on 2026-11-17:

- **Priority.** All sixteen items run now, before L7, L8 and the rest of
  Phase 5.
- **Parallel agents and workflows.** "multiple subagent in parallel and
  workflows". This is the user's opt-in for the workflows in §7.
- **Tests near the end.** "avoid to add tests on each step, add test near to
  the end." Each unit is built first and tested in one pass at its end (§6).
- **The coordinator reviews.** "coordinator will run quality and security
  checks." You run no review agent; you stop at a green branch gate and hand
  over (§9).
- **The budget reset button first.** "I want the budget reset button as top
  priority." Unit M4 (items 6, 7, 8) starts at once, gets agents first and
  is handed over first (§4).

## 2. What already exists — do not rebuild it

Paths are relative to `apps/dashboard/`. Verify each one; this map was taken
on 2026-11-17 at `ae9c4c9`.

| Area | Today |
|---|---|
| Sidebar | `lib/nav.ts`: Usage (Overview, Ranking, Cost by department, team, service, user, My usage **last**); Management (Team, Organisation, Users, Audit); Administration (Settings). `navGroupsFor()` is the one filter; flags come from `lib/manage-access.ts`. Design System — *Navigation (Sidebar)*; Access Control — *Navigation and landing by role* |
| LiteLLM page | `app/dashboard/litellm/page.tsx` only redirects (`?tab=` → a Management route). The user removed the LiteLLM tab row on 2026-11-16; item 2 brings a LiteLLM area back |
| Settings → LiteLLM | Sub-tabs Connection, Guardrails, Team links, Users (`lib/settings-tabs.ts`, `components/settings/litellm-panel/*`). L6 adds its gateway section |
| Team links | `GET /api/litellm/team-links`, `PUT`/`DELETE /api/litellm/team-links/[teamId]`; writers `internal-admin` and `internal-org-admin` (LiteLLM spec LD24). UI: `LiteLLMTeamLinksSection`, `TeamLinkRow`, and `TeamLinkForm`, which takes both ids as **free text**. `listProxyTeams` (`GET /team/list`) already serves the link picker and the Organisation tables |
| LiteLLM teams | `POST /api/litellm/teams` (`createTeam`, `internal-admin` only) |
| App teams | A team is **one AWS member account**: the team list comes from the `AccountMeta` registry (`app/api/access/org-units/route.ts`; Access Control — *Hierarchy*). `app/api/teams/route.ts` is `GET` only. There is no way to create a team that has no AWS account |
| Team page | `components/manage/TeamPageContent.tsx`: views Members, Budgets, Keys. `TeamSpendPanel` sits in Budgets for a linked team and above the tabs for an unlinked one (App Teams spec — *Spend source*, *UI*) |
| Resets | `POST …/members/[oid]/reset-spend` (`resetMemberSpend`, toggle default off) and `…/reset-budget` (`resetMemberBudget`, toggle on), both through `lib/litellm/member-write.ts`, both audited. Lead in scope, org-admin, Admin. No ledger; no count |
| Requests | None. `KeyRequest` (L7) is specified, not built. My usage has a "Request a budget increase" `mailto:` link (`app/dashboard/me/MeContent.tsx`); the spec says "no outbound-message feature is added" |
| Notifications | None, in code or specs |
| Users page | `app/dashboard/manage/users/page.tsx`: LiteLLM user search only (`components/litellm/UserSearch.tsx`). Settings → LiteLLM → Users shows the same search. `searchUsers` (`GET /user/list`) **requires** a search text of 2–100 characters, at most 25 rows a page; nothing lists users without a search |
| People and links | Password users (`/api/password-users`, `internal-admin`, recent authentication); members and pending entries by email (`/api/teams/[id]/members`); identities (`/api/identities`); identity links (`PUT /api/identities/[oid]/links`, `internal-admin`); `IdentityLinkSuggestions` — "Nothing is linked automatically" (Access Control D27) |
| LiteLLM users | Created only inside `addTeamMember`, on OSS. On Enterprise the dashboard **never** creates a user (LiteLLM spec — *Identity mapping and members*, LT16; confirmed by the user 2026-11-10) |
| Dev sign-in | `components/auth/SignInOptions.tsx`: the role select lists `GLOBAL_ROLES` only. A lead is a **scope** (`internal-team-admin`), not a global role. `lib/auth/dev-identity.ts` (L3c) signs in as a stored identity by email or id; the typed text never supplies a role |
| Two cost sources | Shared contract §5 and L6: combined totals follow the combined rules (gateway slice excluded, parts shown, warning when the gateway is not configured). "LiteLLM-reported and AWS-billed figures are never added together" outside those rules (Design System — *Management pages*) |

## 3. Decisions and questions

Agent decisions (Rule 00.3), except those marked **user**: the user
answered them on 2026-11-17 and they are not reopened. The spec step
records each with its reason: M4 for D8–D13, M0 for the rest. Change an agent decision only with a better
reason, and say so in the report.

### Navigation and the LiteLLM area (items 2, 4, 9, 10, 11)

- **D1 — Sidebar order (user).** Usage: Overview, **My usage**, **Team
  usage** (new, D7), Ranking, Cost by department, Cost by team, Cost by
  service, Cost by user. Management: **Users, Team, LiteLLM, Audit**.
  Organisation is no longer a sidebar item: it is the first tab of LiteLLM.
  Who sees each existing item does not change.
- **D2 — Management → LiteLLM** at `/dashboard/manage/litellm`, with route
  tabs on the one `Tabs` component (Rule 40.9): **Organisation**, **LiteLLM
  teams** (the LiteLLM team list, team links, and LiteLLM team creation for
  `internal-admin`), **LiteLLM users** (user search and user links, D10).
  Visible to the callers who see Organisation today: admin, org-admin, and
  auditor read-only. For a lead and a user it is absent and `404`.
- **D3 — Settings → LiteLLM keeps configuration only** (Connection,
  Guardrails, L6's gateway section). Team links and Users move to D2. Every
  old URL redirects on the server: `/dashboard/manage/organisation`,
  `/dashboard/litellm?tab=organisation`, the two Settings sub-tab routes.
- **D4 — No permission changes with the move.** Team-link writes stay
  `internal-admin` and `internal-org-admin` (LD24), which is what item 4
  asks for. LiteLLM team creation stays `internal-admin`.
- **D4a — Team link pickers (item 15).** In the team link form both ids are
  chosen from a list, never typed. "Team" lists every app team (the registry
  teams plus the created ones, D5) by name, with the id as secondary text.
  "LiteLLM team" lists every LiteLLM team by alias, with its `team_id`. A
  team that already has a link is shown as linked and cannot be chosen (the
  link is one-to-one). Both lists are searchable. The lists come from reads
  that exist today (`listProxyTeams`, the team list); no new LiteLLM
  operation. The server still validates both ids and still answers `409` on
  a duplicate: the list is a convenience, never the control. If the LiteLLM
  list cannot be read, the form says so and offers no free-text fallback.

### Teams (items 3, 5)

- **D5 — An app team can exist without an AWS account.** A new `AppTeam`
  item in the single table (name, department, created by, created at; the id
  is generated on the server and can never equal a registry `teamId`). The
  team list becomes the registry teams plus the created ones. A created team
  has no Bedrock cost: Usage pages show "No AWS account", never `$0`. Its
  LiteLLM spend is the linked LiteLLM team's, else the member sum. The Team
  page gets a **New team** action. Create only; rename and delete go to
  `docs/future-improvements.md`.
- **D6 — Who creates a team (user):** `internal-admin` and
  `internal-org-admin`. Everyone else gets `403` before parsing. M0 adds the
  row to the permission matrix as the user's decision.
- **D7 — Team spend leaves the Team page; a lead gets "Team usage"
  (user).** The user's words: "Team lead is also a user", so a lead sees
  their own usage under My usage, and their team's usage under a new Usage
  item.
  - `TeamSpendPanel` is removed from the Team page for **every** role.
  - New Usage item **Team usage** at `/dashboard/team-usage`, third in the
    group. It shows what the panel showed: for a linked team the
    LiteLLM-reported team spend, daily spend and the budget bar; for an
    unlinked team the member sum with its coverage and member table (App
    Teams spec — *Spend source*). Labelled "LiteLLM-reported". A lead still
    has no AWS-billed figure (decided 2026-11-17).
  - Visible to a caller with a team or department admin scope, for the
    teams in that scope (a team picker when there is more than one). Absent
    and `404` for everyone else. Agent decision: admin, org-admin and
    auditor do not get the item unless they hold a scope — they read team
    cost on Cost by team (D17) and the Organisation tab; one place per
    figure is the reason for item 5.
  - A lead's landing page stays My usage. A lead's Usage group is now My
    usage, Team usage.
  - M1 adds the item and the `teamUsage` flag in `lib/manage-access.ts`; M2
    builds the page and reads that flag. M0 fixes the flag's name and
    meaning in the spec so both can build in parallel.
  - M0 writes the table "where each role reads team spend after the change"
    into the Design System spec.

### Resets (items 6, 7, 8) — unit M4, top priority

- **D8 — Ledger.** Every reset made through the dashboard writes one
  `BudgetReset` item: member, app team, LiteLLM team, operation (`spend` or
  `budget`), **amount** (the member's LiteLLM-reported spend read just
  before the reset, USD), the budget at that time, trigger (`direct`,
  `bulk`, `request`), actor, request id, timestamp (UTC). It is written
  where the audit record is written, after LiteLLM confirms. A failed ledger
  write is never swallowed (Rule 60.17). The ledger is not the audit log:
  a ledger item expires after **400 days**, the audit log's retention
  (user).
- **D9 — "On-demand"** means a reset a person triggered through the
  dashboard, as opposed to LiteLLM's scheduled reset at the end of
  `budget_duration`. The count and the total amount cover the selected date
  range (`DateRangeQuerySchema`, 90-day cap).
- **D10 — Who sees the count.** A user: their own. A lead: the teams in its
  scope, per team and per member. Admin, org-admin, auditor: every team. One
  scoped read route; the policy module filters it. Surfaces: My usage, the
  Team page's Budgets view, the Organisation tab (one column per team).
  Per-member counts are per-user data (user): until the per-user approval
  is given in `prod`, only team totals show; they also follow the
  visibility rules (Access Control — *Visibility and inheritance*).
- **D11 — Request.** A member of a **linked** team asks for a reset of their
  own member budget, with an optional reason (plain text, at most 280
  characters). One open request per person per team; it expires after 7
  days (L7's precedent). The control is absent on an unlinked team and
  whenever the reset operation is disabled ("hidden, never dead"). The
  request runs **the reset after which the member can spend again at once**
  (user). **Read `docs/litellm/openapi.json` and the L4 code for what each
  LiteLLM reset call does; do not answer from memory.** Decide which of
  `resetMemberBudget` and `resetMemberSpend` that is, prove it against the
  fake LiteLLM, and record it with the reason. There is **no limit** on
  approved resets per member (user); the ledger and the count are the
  control. Creating a request is a new write for a role that writes nothing
  today: a new row in the permission matrix, with a toggle
  `requestBudgetReset`, default **on** (reason: a request alone changes
  nothing in LiteLLM).
- **D12 — Decision.** Approve and deny are for the callers who may run the
  reset today (lead in scope, org-admin, admin) — a request never widens
  that. Never the requester. Scope, membership, link and toggle are checked
  **when the decision is made**, not when the request was made. The request
  moves from open to approved with a conditional write, so two approvers
  cause one reset. If the LiteLLM call fails, the request is open again and
  nobody is told it was approved. Approval writes the ledger (D8) and the
  audit record. Open requests are also listed on the Team page, so a
  decision never depends on the bell.
- **D13 — Notifications are in-app only.** A `Notification` item per
  recipient (kind, request id, created, read; 90-day expiry). A bell in the
  top bar with the unread count and a list. A lead's notification carries
  Approve and Deny; Approve opens the `AlertDialog` that names the person and
  the effect. The requester is notified on approved, denied and expired.
  Recipients: the leads whose scope covers the team; if there is none, the
  org-admins and admins. Delivery is polling with TanStack Query (60 s,
  paused while the tab is hidden). No email, chat, push, WebSocket or SSE.
  A notification is a pointer: its buttons re-read the request and the
  server re-checks permission. Never cached (Rule 60.10); nothing in browser
  storage.

### Users (items 1, 12, 13)

- **D14 — Dev sign-in as a lead.** The dev sign-in form gets a "Team lead"
  option that uses the existing stored-identity path (L3c): the seed adds a
  lead identity with a real team admin scope, and the option signs in as it.
  No new auth path, no scope in the session token, no `Lead` app role. Dev
  login stays off in production and whenever Entra is configured.
- **D15 — Add user** on Management → Users: a people list (the identities
  route) and one **Add user** action that composes existing writes. Pre-SSO:
  create a password user (existing route, `internal-admin`, recent
  authentication, setup link). With a team: the existing Members route (a
  pending entry by email until the first sign-in). Optional LiteLLM link:
  D16. No new user store, no new permission: a step is shown only to a
  caller who may do it. Under Entra a person is never created in the app.
- **D16 — User links** on the LiteLLM users tab. Each app user shows one of
  three states:
  - **Linked.**
  - **Match found** — a LiteLLM user whose email equals the app user's
    verified, canonical email. Shown as a suggestion; linked only after an
    approval click in a dialog that names both sides. Never automatic (D27).
  - **No LiteLLM user with that email.** Two actions: pick an existing
    LiteLLM user by search (a manual link; a written reason is required,
    because the emails differ), or, on OSS only, **create and link** with
    the user body `addTeamMember` already builds (`auto_create_key: false`).
    On Enterprise the dashboard never creates a user; it says "sign in to
    LiteLLM once, then retry".
  The user confirmed this reading. Writers (user): `internal-admin` and
  `internal-org-admin` may create and approve a LiteLLM user link. This
  widens the **LiteLLM user link only**; the usage-identity aliases on the
  same record stay `internal-admin` (agent decision: the user's answer was
  about item 13). Nobody links their own identity (agent decision: the
  precedent "never on themselves", Access Control — *Roles*). The link
  route keeps the recent-authentication rule it has today. The auditor
  reads. A standalone user creation is a new allowlist operation:
  spec row, toggle, audit, and a check of the service key's `allowed_routes`.

- **D16a — The LiteLLM users list (item 16).** The LiteLLM users tab (D2,
  moved from Settings by D3) opens on a **list**, with one filter: **All
  users**, or **the members of one team** (a team picker). The search box
  stays and narrows the list. Columns as the search shows today (user,
  email, spend, budget, teams), plus the link state of D16.
  - *All users* reads LiteLLM's user list page by page. This needs the
    search text of `searchUsers` to become optional: one amended row in the
    allowlist (same call, same service-key route, still at most 25 rows a
    page, server-side paging; never "load everything"). M0 records it.
  - *Members of one team* lists the app team's members (the affiliations),
    each with their LiteLLM user through the stored link, else the email
    lookup; a member with none is "not in LiteLLM", never `$0`. For a linked
    team the LiteLLM team's own members are listed too, so an orphaned
    LiteLLM member is visible.
  - Who sees it does not change: admin, org-admin and auditor see every
    user; rows stay filtered on the server after the call (LT21). The
    Organisation cap (LD23) and the per-user approval still hide per-user
    cost. The reads stay inside the LD34 call budget.
  - Management → Users keeps its search and the people list of D15. The two
    pages differ on purpose: Users is about app users, the LiteLLM users
    tab is about LiteLLM users.

### Source panels (item 14)

- **D17 — Two panels, never one mixed chart.** Cost by team, Cost by user
  and Cost by service each show a **Bedrock** panel ("AWS-billed") and a
  **LiteLLM** panel ("LiteLLM-reported"), each with its own chart or table,
  its own label, its own Suspense and ErrorBoundary. No chart, series or
  table column mixes the two sources.
- **D18 — The global sum is L6's combined figure**, never Bedrock plus
  LiteLLM added naively: it excludes the gateway slice, shows its parts,
  carries the estimate mark, and follows the "gateway not configured" rule
  (shared contract §5). Each page opens with three figures: Bedrock,
  LiteLLM, Combined. Reuse L6's routes and `components/litellm/combined/*`.
- **D19 — Honest gaps.** LiteLLM reports no cost by service (Rule 20.10: a
  service comes from CloudTrail inference profiles). The service page's
  LiteLLM panel shows what the allowlisted reads give and says so; it never
  invents a mapping (Q7). A person with no LiteLLM link is "not in LiteLLM",
  never `$0`. Use only reads already on the allowlist, inside the LD34 call
  budget.

### The user's answers (2026-11-17) and what is still open

| # | Question | Answer |
|---|---|---|
| Q1 | Items 9 and 10: the Management order | **User:** Users, Team, LiteLLM (holding Organisation), Audit (D1) |
| Q2 | Who creates app teams | **User:** admin and org-admin (D6) |
| Q3 | A lead and the Team spend panel | **User:** a lead sees own usage under My usage and team usage under a new **Team usage** item (D7) |
| Q4 | Item 13: the reading, and who approves a user link | **User:** the reading in D16; admin and org-admin |
| Q5 | Which reset an approved request runs; a limit | **User:** the one that lets the member spend again; no limit (D11) |
| Q6 | Per-member reset counts before the per-user approval; ledger retention | **User:** follow the approval; keep 400 days (D8, D10) |
| Q7 | Cost by service: should a LiteLLM dimension (key alias, tag) stand for "service"? | **Open.** Default: no (D19). Ask at the start; do not block on it |

## 4. Units, waves and ownership

One branch and one squash commit per unit (Rule 30.4).

| Unit | Items | Branch | Worktree | Starts |
|---|---|---|---|---|
| **M4** budget reset — **top priority** | 6, 7, 8 | `feature/budget-reset-requests` | `mg-4` | at once |
| **M0** spec for the other items | all but 6–8 | `docs/management-improvements` | `mg-0` | at once |
| **M1** navigation and LiteLLM area | 2, 4, 9, 10, 11, 15 | `feature/manage-litellm-area` | `mg-1` | wave 1 |
| **M2** app teams and Team page | 3, 5 | `feature/app-team-create` | `mg-2` | wave 1 |
| **M3** users, links, dev lead sign-in | 1, 12, 13, 16 | `feature/manage-users-links` | `mg-3` | wave 1 |
| **M5** source panels | 14 | `feature/usage-source-panels` | `mg-5` | wave 1 |

- **At once, in parallel: M4 and M0.** M4 does not wait for M0. Its first
  step is its own spec change: D8–D13, its entities, routes, permission
  rows and threat items, and the run directions (the order exception in
  Rule 30, the "tests near the end" exception in Rule 70, the row in
  *Workflow pilots*). M0 leaves those sections alone.
- **M4 always goes first.** It gets agents first. At the usage caution tier
  M4 continues and nothing else starts. It is handed over first, and you ask
  the coordinator to review and land it before any other unit. A unit that
  lands after it merges `main` and keeps what is there (Rule 31).
- **Inside M4, the button's path comes first.**
  - *Slice A:* "Request a budget reset" on My usage → the request → the
    lead's notification → Approve or Deny (from the bell and from the Team
    page) → the reset → the ledger item → the requester's notification.
  - *Slice B:* the ledger on direct and bulk resets; the counts on the
    three surfaces (D10).
  - If usage forces a stop, finish, test and hand over slice A. Slice B
    then becomes a follow-up unit **M4b** (`feature/budget-reset-counts`);
    record that in implementation-phases and in the report.
- **Wave 1: M1, M2, M3, M5** in parallel, one agent pipeline each. It
  starts when M0 is on `main`, or when the coordinator says to branch from
  M0's tip. Until then, prepare their briefs; write no code for them.

**File ownership** (under `apps/dashboard/` unless stated). A unit edits only
its own files, plus the append-only shared lines.

| Unit | Owns |
|---|---|
| M4 | `app/api/budget-reset-requests/**`, `app/api/budget-resets/**`, `app/api/notifications/**`, `lib/data/budget-reset-requests*`, `lib/data/budget-resets*`, `lib/data/notifications*`, `components/budget-resets/**`, `components/notifications/**` (all new); `lib/litellm/member-write.ts`, the two reset routes, `components/layout/AppHeader*`, `components/litellm/team/BudgetLimitsPanel*`, `MembersPanel*`, `components/litellm/OrganisationSection*`, `app/dashboard/me/**`; in the specs and rules, its own sections and the run-direction lines |
| M0 | The rest of `docs/specs/**`, `.claude/rules/**`, `docs/guides/**`, `docs/future-improvements.md`. After M0 a unit only appends decisions to its own spec section |
| M1 | `lib/nav.ts`, `lib/manage-access.ts`, `lib/settings-tabs.ts`, `app/dashboard/manage/litellm/**` (new), `app/dashboard/manage/organisation/**`, `app/dashboard/litellm/**`, `app/dashboard/settings/litellm/**`, `components/layout/AppSidebar*`, `CommandMenu*`, `PageTitle*`, `components/settings/litellm-panel/LiteLLMTeamLinksSection*`, `TeamLink*` |
| M2 | `components/manage/Team*`, `MemberSumDetail*`, `app/dashboard/manage/team/**`, `app/dashboard/team-usage/**` (new), `app/api/teams/route.ts`, `app/api/access/org-units/**`, `lib/data/access/app-teams*` (new) |
| M3 | `app/dashboard/manage/users/**`, `components/manage/users/**` (new), `components/litellm/UserSearch*`, `components/settings/litellm-panel/LiteLLMUsersSection*`, `components/settings/IdentityLink*`, `app/api/identities/**`, `app/api/litellm/users/**`, `components/auth/**`, `app/sign-in/**`, `lib/auth/dev-identity*` |
| M5 | `app/dashboard/{teams,users,services}/**`, `components/{teams,users,services}/**`, `components/litellm/combined/**` |

**Shared, append-only — send `overlap mg-<n>: <path>` to the coordinator
before editing:** at the repo root, `packages/shared/src/**` (one new schema
file per unit; one new line each in `index.ts`) and `scripts/seed*.ts`; in
the dashboard, `lib/data/access/keys.ts`, `test/route-registry.ts`,
`test/fixtures/**`, `e2e/support/**`, `config/**`,
`lib/litellm/operations.ts`.
M1 mounts M3's and M4's components by import only; it never edits them.

## 5. What each unit delivers

- **M4 — budget reset, top priority.** D8–D13, spec first, then slice A,
  then slice B (§4). Both reset routes and the bulk reset write the ledger.
  Keep the "Request a budget increase" link; add "Request a budget reset"
  beside it.
- **M0 — spec for the other items.** Every other decision in §3, each with
  its reason and date:
  - Design System: *Navigation (Sidebar)* table and order, *Management
    pages* (the LiteLLM area, Users, Team, the "where each role reads team
    spend" table, Team usage), *Settings Page* (sub-tabs that moved), the
    source panels on the three Usage pages.
  - Access Control: *Navigation and landing by role*, the permission matrix
    rows (create team, the LiteLLM user link for org-admin), `AppTeam`, the
    threat items of §8 that are not M4's.
  - LiteLLM spec: *Views as Management routes*, the user-creation
    operation, the optional search text of `searchUsers`, *Allowlist*.
  - App Teams spec: teams without an AWS account; *UI* (D7).
  - Data Model: `AppTeam`, its keys, access patterns and routes.
  - implementation-phases: units M0–M3 and M5 as user-directed
    (2026-11-17), each with a Verify checklist (M4 adds its own).
  - Rules: 40 (sidebar), 10 and 50 (the new write routes and who may call
    them).
  - Grep `docs/specs/**` and `.claude/rules/**` for every statement you
    changed and update it or mark it superseded (Rule 70.12 — *Ready
    self-check*).
- **M1.** D1–D4a. The sidebar, `PageTitle` and `CommandMenu` share the one
  filter. Hidden means absent and `404`. Back steps across the tabs.
- **M2.** D5–D7. The create route registers in `test/route-registry.ts`,
  returns `403` before parsing, audits, and revalidates the tags it affects.
- **M3.** D14–D16a.
- **M5.** D17–D19.

Every unit: Server Components by default; a new section in its own Suspense
and ErrorBoundary; semantic tokens only; the `{ data }` / `{ error }` shape;
`Cache-Control: private, no-store`; Zod at the boundary; no LiteLLM call
outside `lib/litellm/**`; `fetchApi`/`mutateApi` and `next/link` only (the
base-path structure test).

## 6. Tests — one pass per unit, near the end

The user's direction (2026-11-17) changes the **order**, not the bar. M4's
spec step records it in Rule 70 as an exception for units M1–M5. Inside a
unit:

1. **Build.** `typescript-developer` builds the unit in slices from the
   spec. After each slice: `pnpm typecheck` and `pnpm lint`. No test is
   written or run per slice. Existing tests that the change breaks on
   purpose (order, moved tabs, a removed panel) are listed in the run
   folder; the developer never edits a test (Rule 70.8).
2. **Test pass.** `tdd-test-engineer` writes the unit's tests in one pass,
   from the spec lines and the table below — not from the code — and
   updates the listed broken tests. For each security case it names the
   guard that makes it pass (`file:line`).
3. **Fix.** A failing new test is a defect or a spec gap. The developer
   fixes the code; a disputed test goes back to the test engineer
   (Rule 70.4). Never weaken a test to pass.
4. **Branch gate** (Rule 70.12): `pnpm typecheck`, `pnpm lint`,
   `pnpm format:check`, `pnpm exec vitest run --changed $(git merge-base
   main HEAD)`, the two structure suites, and e2e as below.

One layer per behaviour; every test cites a spec line or a threat item
(Rule 60.24a). New routes register in the shared route-contract suite
instead of copying the `401`/`403`/`400` cases (Rule 60.23).

| Unit | Must be proved |
|---|---|
| M4 | **Slice A:** the full role × action matrix for request, approve, deny, read (complete — it is security); self-approval refused; an out-of-scope request id is `404`; double approve causes one reset and one ledger item; permission lost between request and decision; LiteLLM failure leaves the request open and tells nobody it was approved; expiry; one open request per person; the control is absent on an unlinked team and when the operation is off; the reset that runs is the one after which the member can spend again; a notification reaches only its recipients and only its owner can read or mark it; the reason renders as text. **Slice B:** one ledger item per reset on all three paths with the amount read before the reset; no item when LiteLLM fails; the 400-day expiry; count and amount per role scope — a user never sees another person's, a lead never another team's (leak tests); only team totals before the per-user approval; the 90-day cap |
| M1 | The order of both groups per role; the LiteLLM item and each tab per role (present, read-only, absent and `404`); every old URL redirects and keeps its query; team-link writes: admin and org-admin allowed, auditor and lead `403`; the link form offers every app team and every LiteLLM team, marks linked ones as not selectable, has no free-text id field, and the server still refuses an unknown id and a duplicate |
| M2 | Create: who may, `403` before parsing, duplicate name, id never collides with a registry team; the new team appears in the team list and can take members and a link; no `$0` Bedrock row for it; the Team spend panel is gone from the Team page for every role; Team usage: a lead sees only the teams in its scope (leak test), a caller with no scope gets `404`, and the linked and unlinked figures equal what the panel showed |
| M3 | Dev lead sign-in gets a real scope from the store and none from typed text; off in production; Add user shows only the steps the caller may do; link: admin and org-admin may link, auditor and lead `403`, nobody links their own identity, usage aliases stay admin-only, no automatic link, approval needed, manual link needs a reason, duplicate `409`, no user creation on Enterprise, body has `auto_create_key: false`; the LiteLLM users list: all users pages on the server (25 a page) with no search text, the team filter shows exactly that team's members, "not in LiteLLM" is never `$0`, per-user cost is hidden under the cap, and a lead or a user gets `404` |
| M5 | No chart or column holds both sources; the three figures; Combined equals L6's rule on the counted-once fixture; the warning and the hidden total without a gateway; a LiteLLM outage leaves the Bedrock panel working; "not in LiteLLM" is never `$0` |

**E2E budget** (Rule 70.12). M1 changes shared files (`lib/nav.ts`,
`components/layout/**`), so it runs the full e2e once at its green gate. M3
(`components/auth/**`, the seed) and M4 (`AppHeader`) the same. M2 and M5
run only their targeted specs, once. Integration tests and e2e share one
DynamoDB Local and one port: take the cross-worktree lock
(`scripts/e2e-lock.mjs`, coordinator prompt §2a) and run them one unit at a
time. Unit tests may run in parallel.

## 7. Orchestration — parallel agents and workflows

- **Opt-in:** the user's, for this prompt (§1). Load the
  `workflow-authoring` skill before you write a script; do not write one
  from memory.
- **Cap: 5 agents at once** (Rule 70 — *Workflows*). Tell the coordinator in
  your first message: `workflow mg: up to 5 agents`.
- **Before a unit starts**, you create its worktree
  (`git worktree add .claude/worktrees/mg-<n> -b <branch> main`), install
  its dependencies, and write its brief to `temp/run-manage/brief-m<n>.md`:
  the absolute worktree path, the branch, the owned files, the spec
  sections, the decisions, the test table row.
- **First workflow, at once:** M4's slice A, fanned out against one test
  bar with up to three build agents — the request and decision routes with
  the ledger write; the notification routes and the bell; the My usage and
  Team page controls — then *Test pass → Fix → Gate* (§6). M0 runs beside
  it as one agent.
- **Wave 1 workflow:** four pipelines in parallel (M1, M2, M3, M5), each
  *Build → Test pass → Fix → Gate*. M4's slice B takes the fifth place; if
  M4 still needs more, a wave-1 pipeline waits, never M4.
- **Models, named on every dispatch:** `typescript-developer` and
  `tdd-test-engineer` on sonnet; gate runs and git summaries on haiku; M0
  and any hard design question on opus. Escalate per Rule 70 — *Model
  routing*.
- **Every agent prompt says:** work only in your worktree; edit only the
  owned files; results, not logs (redirect every run to a file; read the
  exit code and the count lines); never commit, merge or push.
- **Agents never commit** (Rule 70.9). When a workflow returns, you commit
  each worktree on its branch with Conventional Commits; hooks run.
- **Usage:** check before each workflow and each dispatch
  (`jq '.rate_limits' ~/.claude/usage-snapshot.json`). Caution at 60% of the
  5-hour window: no new pipeline except M4's. At 75%: start no agent, log,
  write the report, stop.

## 8. Guards and out of scope

Threat items the spec steps add (M4 for its own, M0 for the rest), each
with its test in §6:

- A request or a notification never widens who may reset (D12).
- Self-approval; replay and double approval; a decision after scope,
  membership, link or toggle changed.
- Request ids and notification ids from another team or person (`404`,
  same body as a missing one).
- Request spam (one open request; the count is the record).
- A wrong user link shows one person another person's LiteLLM spend and key
  metadata (D16: verified email, approval, reason, audit, one-to-one, no
  self-link — more so now that org-admin may link).
- A dev lead sign-in that exists outside dev (D14).
- A naive sum that counts gateway traffic twice (D18).
- The request reason as stored text (rendered as text, length-capped).

Never: merge into `main`, push, bypass a hook, deploy, commit `temp/`, a
secret or a real AWS account ID. Never weaken a permission, a toggle default
that is off today, or a test to finish faster — list it for the user.

Out of scope: email or chat notifications; renaming or deleting app teams;
LiteLLM user creation on Enterprise; a LiteLLM "service" dimension; L7 key
requests (M4's request and notification code is written so L7 can reuse it,
but builds nothing for keys); changes to `infra/`, `poc/`, the collector or
`tools/bedrock-simulator/`.

## 9. Handover to the coordinator

You run **no review agent** — no `quality-reviewer`, `spec-guardian`,
security reviewer or `playwright-ui-reviewer`. The coordinator runs the
quality and security checks on the merged candidate (Rule 70.12 — *Batched
under a coordinator*), and lands each unit.

Per unit, when its branch gate is green with `main` merged in, do the
*Ready self-check* (Rule 70.12), leave the worktree clean, and write
`temp/run-manage/handover-m<n>.md`:

- the commit, and the gate evidence at that commit (exit codes, count lines);
- `git diff --name-only main...HEAD`, with any shared file marked;
- the decisions taken, with their spec lines;
- **the security surface:** each new or changed write route and who may call
  it, each new permission row, each new entity and who can read it, each
  threat item with the guard (`file:line`) and its test;
- what was not verified.

Then send one line: `ready to merge m<n> at <commit>`. Other messages are one
line too: `progress`, `blocked`, `overlap`, `frozen`. Blockers from the
coordinator's review come back as one checklist; fix them through the same
Build → Test pass → Fix order, behaviour first as a failing test.

## 10. Completion criteria

The run is complete when all of these hold, or when it ends on a usage
freeze with the report written:

1. The spec changes of M4 and M0 are on `main`: D1–D19 (with D4a and D16a)
   recorded with reasons, the five run directions recorded as the user's
   (2026-11-17), the answers to Q1–Q6 recorded as user decisions, Q7 asked
   and its answer or default recorded. No rule contradicts its spec.
2. Each of the sixteen items is delivered by its unit and shown by the
   tests in §6, not asserted in prose.
3. Every unit M1–M5 has a green branch gate at its final commit with `main`
   merged in, one branch, owned files only, and a handover file.
4. `ready to merge m<n> at <commit>` was sent for every unit, M4 first. The
   coordinator reviews and lands; the user pushes.
5. `temp/report_261117_manage.md` is written: per unit what changed, the
   decisions and reasons, test counts, the agents and models used per workflow,
   **what was not verified** (no real LiteLLM Enterprise, no Entra sign-in,
   no deploy), the open questions with the default now in force, and the
   user's actions in order.

`/goal` line:

```
/goal plans/management_improvements.md §10 completion criteria met for units M0–M5 (M4 first), each reported ready to merge, and the report written — or the run ended by a usage freeze, with the report written.
```
