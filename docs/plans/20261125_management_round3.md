# Run plan — management round 3: defects, pages for a LiteLLM team and user, help, refresh, sign-in

Written by the planner on 2026-11-25 for the coordinator and the worker
sessions. Package: `temp/planner/mgmt-round3/` (`plan.md`, `spec-changes.md`,
one `brief-<unit>.md` per unit, one `workflow-<session>.md` per session).
`main` when written: `cc39bde4` (INV2).

## 1. The ask (the user, 2026-11-25, in their words)

1. "a button to reload data/sync in all Usage and Management pages"
2. "in /dashboard/manage/litellm/organisation when 'Per app team. Rows
   overlap with each other and do not add up to the total.' section, think
   we can remove it"
3. "/dashboard/manage/litellm/teams":
   - 3a. "add a magnifying glass in the 'Search teams' field"
   - 3b. "'Search teams' field should display results"
   - 3c. "the 'LiteLLM team' names should be clickable and show a page with
     the team info, spent, members, team lead name, and so on … in a new
     page"
4. "/dashboard/manage/litellm/users":
   - 4a. "add a magnifying glass in the 'Search users' field"
   - 4b. "'Search users' field should display results"
   - 4c. "when I click on a user, a error is displayed; 'Invalid input:
     expected string, received undefined' - however it should display
     detailed litellm info of that user in a new page, no under the user
     table, also if is linked to any app user and team"
   - 4d. "when I select 'Members of one team', displays an error: Invalid
     input: expected string, received undefined"
5. "/dashboard/manage/team/XXXXXX":
   - 5a. "I dont understand what each field means, add a information icon
     to display a modal with a short text of that field is"
   - 5b. "It should display team detailed info, and add an edit button to
     configurate the team (current information) - try to add more features"
6. "/dashboard/manage/users":
   - 6a. "I dont understand what 'create and link' means, add a information
     icon … also rename to 'Create litellm user' or similar, suggest names"
   - 6b. "the label 'Match found' no need"
   - 6c. "when you click on user, it should display user detailed info, and
     add an edit button … try to add more features"
7. "In docker deployed version, the login page shows 3 input fields without
   any information on it … improve it with good UI standards"
8. The pasted `ZodError` on `/dashboard/users` (Cost by user): `data.users[n]`
   has no `userId`, `email`, `teams`.

"the [app] is running, try to use playwright for debuggin" (the user,
2026-11-25): every item was opened in the running app
(`http://localhost:3000/llm-lens`, dev sign-in as `internal-admin`).

## 2. What exists, and what the browser showed

| Item | Finding | Evidence |
|---|---|---|
| 8 | **Defect.** The Cost by user LiteLLM panel asks `GET /api/litellm/users?page=N` (no `q`) and parses the answer with the **search** schema. With no `q` the route answers the **list** shape (`{ key, linkState, appUser, litellmUser }`, D-LF1). Every row fails | `components/users/UsersLiteLLMPanel.tsx:31`; `app/api/litellm/users/route.ts:110,162–210` |
| 4c | **Defect.** The user detail under the table asks `GET /api/litellm/users/[id]` with no date range; the route requires `dateFrom` and `dateTo` → `400` | `components/litellm/UserSearch.tsx:67`; `app/api/litellm/users/[litellmUserId]/route.ts:53` |
| 4d | **Defect.** The team picker asks `GET /api/litellm/org` with no date range → `400` | `components/manage/users/LiteLLMUsersList.tsx:649`; `app/api/litellm/org/route.ts:59` |
| 3b | **Defect.** "Search teams" filters only the team **links**, by id; it never filters the LiteLLM teams table. With no link, typing changes nothing | `components/settings/litellm-panel/LiteLLMTeamLinksSection.tsx:105–133` |
| 6c | The user page exists (US2). The name is the only link and does not look like one. Its LiteLLM block says "No LiteLLM user with that email" while the list shows a match for the same person | `components/manage/users/detail/UserLinksPanel.tsx:36–40` (always `state: "none"`) |
| 7 | The three fields are the master user's: username, password, authenticator code. They have `aria-label`s and no visible label. **Also:** the page has no form for a password user; the `password` provider is reached only by the step-up. The spec requires "an email + password form (with a TOTP step when required)" | `components/auth/SignInOptions.tsx:106–133`; `auth.ts:498–560`; Design System — *Sign-in page* |
| 5 | The team page shows no team name, department, lead or member count for a global reader, and no field explains itself. No route edits a team (`/api/teams/[id]` has `GET` only) | `components/manage/TeamPageContent.tsx`; `app/api/teams/[id]/route.ts` |
| 1 | **Specified, not built:** `RefreshButton` (Design System — *Caching Strategy* → Refresh, *Component Inventory*; implementation-phases — PERF-R) | no `RefreshButton` in `apps/dashboard` |
| 4b | **Works, but says nothing.** A term of two or more characters lists the matching users (checked in the browser: "te" → two rows). One character changes nothing and shows no hint; the field has no magnifier | `components/manage/users/LiteLLMUsersList.tsx:55,700–707` (`MIN_TERM = 2`) |
| 3a, 4a | A search field with a magnifier exists and is used by one table | `components/table/SearchInput.tsx` |
| 3c, 4c | No page for one LiteLLM team or one LiteLLM user. Reads that exist: `GET /api/litellm/proxy-teams/[id]/members`, `GET /api/litellm/users/[id]`, `GET /api/litellm/users/[id]/memberships`; gateway `getTeam`, `getUser` | `app/api/litellm/**` |

**Why the tests did not catch items 8, 4c and 4d.** The component tests and
the e2e specs stub `/api/*` with the shape the client expects. The contract
test of LF1 (`app/api/litellm/__tests__/client-schemas.test.tsx`) compares
schemas only, for the components it lists; it does not list the Cost by
user panel and does not check the query a client sends.

Not in this plan, seen in the browser: `/favicon.ico` is requested outside
the base path and answers `404`.

## 3. Decisions

Agent decisions (2026-11-25, Rule 00.3) unless marked **user**. Each goes
into the spec through unit MR0 (`temp/planner/mgmt-round3/spec-changes.md`).

| Id | Decision | Reason |
|---|---|---|
| D-R3-1 | Unit RF1 builds PERF-R now, before PERF-2, and without the LiteLLM read-cache bypass (that part lands with PERF-3). Rule 30 gets the dated exception (**user**, 2026-11-25, item 1) | Invalidating every query needs no key factory; the LiteLLM read cache does not exist yet |
| D-R3-2 | The button is in the top bar for **every signed-in caller**, on every dashboard page (amends "shown wherever the sync status is shown") | The user: "all Usage and Management pages"; a lead sees Management pages and no sync status |
| D-R3-3 | The button reloads what the page shows. It starts no collector run and no LiteLLM user sync. Label "Refresh data" | The collector is Phase 6 and runs hourly; the user sync is an audited write for two roles (SYNC1) |
| D-R3-4 | Item 2 removes the **App teams table and its sentence** from the Organisation tab. `appTeams[]` stays in `GET /api/litellm/org` (Cost by team and Team usage read it). In the LiteLLM teams table the linked app team's name becomes the link to its team page (replaces G2) | The same figures are on Cost by team → LiteLLM panel and on Team usage (Design System — *Where each role reads team spend*). **Open question Q-R3-1** |
| D-R3-5 | One search field: `SearchInput` gains a visible label, `maxLength` and an optional debounce of 0. The search boxes of the Management pages use it | Six boxes are built five ways today |
| D-R3-6 | "Search teams" filters the links and the LiteLLM teams table by name, alias and id, case-insensitive, in the browser; "No matching teams" when nothing matches | Both lists are already loaded |
| D-R3-7 | The LiteLLM team page is `/dashboard/manage/litellm/teams/[litellmTeamId]`, for `internal-admin`, `internal-org-admin`, `internal-auditor`; anyone else gets the missing page. One new read, `GET /api/litellm/proxy-teams/[litellmTeamId]`, with the same roles and refusals as its `/members` sibling; gateway `getTeam` only (no new allowlist entry) | The readers of the LiteLLM teams tab; a lead reads its teams on Management → Team |
| D-R3-8 | The LiteLLM user page is `/dashboard/manage/litellm/users/[litellmUserId]`, same three roles. The existing detail read gains, for those roles only, `teams[]` and `appUser` (the linked person and their team, or `null`). The detail under the table is removed; a lead keeps the member dialog on its Team page | The user: "in a new page, no under the user table, also if is linked to any app user and team" |
| D-R3-9 | Both pages are `app/dashboard/manage/litellm/[tab]/[id]/page.tsx`: `tab` is `teams` or `users`, anything else is not found. The id is decoded once and validated with the route's id schema | One dynamic folder; no clash with the `[tab]` page |
| D-R3-10 | Help is `FieldHelp`: an `Info` icon button (`aria-label="About <field>"`) that opens a small popover on click or Enter and closes on Escape. Not a hover tooltip and not a blocking dialog | Works with a keyboard and on touch; the user's "modal" is read as "a panel that opens on click" |
| D-R3-11 | "Create and link" becomes **"Create LiteLLM user"** (**user**: "rename to 'Create litellm user' or similar"). Other names considered: "Create LiteLLM account", "Add to LiteLLM" | The first says what is created; the link is in the help text |
| D-R3-12 | The "Match found" badge is removed (**user**, 2026-11-25; supersedes the label of D16, 2026-11-17). A match shows the LiteLLM email and **Link** | — |
| D-R3-13 | The user page shows the same LiteLLM state as the people list: linked, a match (email and Link), or none. No LiteLLM user is created there (D-US9 stays) | The page must not contradict the list |
| D-R3-14 | **Edit team** changes the name and the department of a **created** team, through a new `PATCH /api/teams/[id]`: `internal-admin`, `internal-org-admin` (the roles of team creation, D6); `403` before parsing; versioned; audited. A registry team (from an AWS account) is edited in Settings → AWS accounts | The precedent of creation. **Open question Q-R3-2** |
| D-R3-15 | The sign-in page gets visible labels, a hint for the code, one generic error, and the **email and password form** the spec requires; the master user moves behind "Sign in as master user" | Design System — *Sign-in page*. **Open question Q-R3-3** |
| D-R3-16 | Items 8, 4c, 4d: the client follows the route. The contract test covers every component that calls `/api/litellm/**`, and checks the query as well as the schema | The route shapes are specified (D-LF1) |
| D-R3-17 | Tests first (Rule 70). "Tests near the end" was for M1–M5 only | — |
| D-R3-18 | An e2e stub for a route with a required date range answers `400` without one, as the route does | So the class of 4c and 4d also fails in a browser test |

### Questions (answered by the user, 2026-11-25)

| Id | Question | Answer (user, 2026-11-25) |
|---|---|---|
| Q-R3-1 | Item 2: remove the whole App teams table, or only the sentence above it? | The whole table |
| Q-R3-2 | Edit team: who may rename a created team or move it to another department? Moving changes which department lead sees it | `internal-admin` and `internal-org-admin`, both fields |
| Q-R3-3 | Sign-in: add the email and password form for password users (the spec requires it; it was not asked for today)? | Yes |

Recorded in the specs: App Teams — *Organisation view*; Access Control — *Edit a created team*; Access Control — *Password users*.

## 4. Units

| Unit | Title | Session | Worktree | Branch | Starts when | Security review |
|---|---|---|---|---|---|---|
| MR0 | Spec and rules for this plan | Coordinator | — | `docs/management-round3` | now | spec-guardian |
| FX1 | The three LiteLLM client defects and the contract test | `litellm_worker` | `fx1` | `fix/litellm-client-contracts` | MR0 on `main` | no |
| RF1 | Refresh button (PERF-R) | `improvements_worker` | `rf1` | `feature/phase-5-perf-r-refresh-button` | MR0 on `main` | yes (the cache bypass and its limit) |
| UP1 | Users page: names, help, the user page | `bedrock_worker` | `up1` | `feature/users-page-round3` | MR0 on `main` | scope only: who gets the match (T-UP5) |
| LP1 | LiteLLM teams tab, Organisation, the LiteLLM team page | `litellm_worker` | `lp1` | `feature/litellm-team-page` | FX1 on `main` | yes (new read route) |
| SI1 | Sign-in page | `improvements_worker` | `si1` | `feature/sign-in-form` | RF1 on `main` | yes (sign-in) |
| TP1 | Team page: summary, help, Edit team | `bedrock_worker` | `tp1` | `feature/team-page-detail` | UP1 on `main` | yes (new write route) |
| LP2 | LiteLLM users tab and the LiteLLM user page; the links into both pages | `litellm_worker` | `lp2` | `feature/litellm-user-page` | LP1, UP1 and TP1 on `main` | yes (the read gains link data) |

Queues: `litellm_worker` FX1 → LP1 → LP2; `improvements_worker` RF1 → SI1;
`bedrock_worker` UP1 → TP1. Two builders per window by default (FX1 and
RF1 first; UP1 when one lands). At most one unit that touches an e2e shared
file is in flight: RF1, then SI1.

Start check for any unit: `git log --oneline main | grep -c '<unit id>'`
for each unit it waits for.

## 5. What each unit delivers

### MR0 — spec (the coordinator)

Applies `temp/planner/mgmt-round3/spec-changes.md`: Design System
(*Sign-in page*, *Caching Strategy* → Refresh, *Component Inventory*,
*Management pages*), LiteLLM spec (*API routes*, *Views by role*), App Teams
spec (*Organisation view*), Access Control (*Permission matrix*, *API
routes*, *Audit log*), implementation-phases (the section and its Verify
lines), Rules 10, 30 and 50. `spec-guardian` reviews it.

### FX1 — the three defects (items 8, 4c-error, 4d)

- Cost by user → LiteLLM users: parse the list answer with
  `UsersListResponseSchema`; each row reads `litellmUser`.
- LiteLLM users tab: the user detail request and the team picker request
  carry the URL date range (`useUrlRange`), and their query keys include it.
- The contract test: every component under `components/**` that requests
  `/api/litellm/**` is rendered; for each request the test proves the query
  parses with the route's own query schema and the client's schema is the
  one the route answers with for that query. A component that calls
  `/api/litellm/` and is not covered fails the test.
- E2E: the stubs for `/api/litellm/org` and `/api/litellm/users/[id]`
  answer `400` without a date range (D-R3-18); one case clicks a user, one
  chooses "Members of one team", one opens Cost by user with a list-shaped
  answer.

### RF1 — refresh button (item 1)

`RefreshButton` in `AppHeader`, for every signed-in caller. One click
invalidates every query and refreshes the server-rendered parts of the
page. The icon spins and the button is disabled while anything is
fetching; no spin under `prefers-reduced-motion`. For a caller who sees the
sync status, the refresh round's `GET /api/sync-status` carries
`Cache-Control: no-cache`; the route then skips its 5-minute cache, at most
once per 10 seconds per key and task. The rollup cache key gains the last
sync run, so a new run is read at once. Never `revalidateTag`.

### UP1 — Users page (items 6a, 6b, 6c)

- `FieldHelp` (D-R3-10), with the texts of spec-changes §2.6.
- "Create LiteLLM user" with its help; the gate of LW1 is unchanged.
- No "Match found" badge.
- People table: the name is a visible link; a click on the row opens the
  person's page (not on its buttons); the keyboard path is the link.
- User page: the LiteLLM block shows linked, a match or none (D-R3-13;
  `GET /api/identities/[oid]` gains the match for the callers who may
  link); a **LiteLLM usage** block for a linked person (spend and budget,
  from the existing detail read, with the URL range; the teams are on the
  LiteLLM user page, LP2); the profile edit is a labelled button, "Edit
  name".

### LP1 — LiteLLM teams (items 2, 3a, 3b, 3c)

- `SearchInput` gains the label and `maxLength` (D-R3-5); "Search teams"
  uses it and filters both lists (D-R3-6).
- Organisation: the App teams table and its sentence are removed
  (D-R3-4); a linked LiteLLM team's app team is a link to its team page.
- `GET /api/litellm/proxy-teams/[litellmTeamId]` (D-R3-7): alias, id,
  spend, budget and its reset time, member count, models, and the linked
  app team with its lead names; under the Organisation cap (LD23) spend
  and budget are omitted.
- The page: a summary, the budget as a `BudgetBar`, the members (the
  existing `/members` read, with Reset spend and Reset budget where RS2
  gives them), the linked app team and its leads. The LiteLLM team names in
  the teams tab and in the Organisation table link to it.

### SI1 — sign-in page (item 7)

- Every field has a visible label; the code field says what it is ("6-digit
  code from your authenticator app") and when it is needed; a show/hide
  control on the password; `autocomplete` values stay.
- One titled group per method. The email and password form (Q-R3-3) posts
  to the existing `password` provider through a new server action in
  `auth.ts`; it is absent while password sign-in is off (D24). The master
  user form opens from "Sign in as master user".
- One generic message for any failed password or master sign-in. Lockout,
  timing-equal paths and the audit are unchanged.

### TP1 — Team page (items 5a, 5b)

- A summary panel: the team name, department, kind (from an AWS account, or
  created here), lead names, member count, the LiteLLM team (the id only
  for the three global roles, ruling Q-B1), budget resets in the range.
  Built on the server from reads that exist; no new read route.
- `FieldHelp` on the fields of the page (spec-changes §2.5).
- **Edit team** (D-R3-14): a dialog with name and department;
  `PATCH /api/teams/[id]`; a stale version is `409`; a taken name is the
  creation error; a registry team is `400`. The write refreshes the cached
  team directory.

### LP2 — LiteLLM users (items 4a, 4b, 4c-page)

- "Search users" uses `SearchInput`, with the hint "Type at least 2
  characters" for a one-character term; so do the member search on the
  Team page and the search in the link dialog (one line each).
- `GET /api/litellm/users/[litellmUserId]` gains `teams[]` and `appUser`
  for the three global roles (D-R3-8); a lead's answer is unchanged.
- The page: identity, spend, budget, daily spend for the range, the
  combined figure, teams (each a link to its page), the linked person and
  their team (a link to the user page), Reset spend and Link / Unlink where
  the caller has them today.
- The user cell of the LiteLLM users table is a link to the page; the
  detail under the table is removed.
- The links into the two pages from the app pages: the user page's LiteLLM
  block, and the Team page summary's LiteLLM team.

## 6. Ownership

Paths are under `apps/dashboard/` unless they start with `packages/` or
`docs/`. "(new)" marks a new file. Tests next to a file belong to the
file's unit.

| Unit | Owns |
|---|---|
| FX1 | `components/users/UsersLiteLLMPanel.tsx`; `components/litellm/UserSearch.tsx` (the `UserDetail` request only); `components/manage/users/LiteLLMUsersList.tsx` (the `TeamMode` request only); `app/api/litellm/__tests__/client-schemas.test.tsx`; `e2e/litellm-users-tab.spec.ts` (new); `e2e/usage-source-panels.spec.ts` (the Cost by user cases) |
| RF1 | `components/status/RefreshButton.tsx` (new); `components/layout/AppHeader.tsx`; `app/api/sync-status/route.ts`; `lib/api/cached-reads.ts`; `lib/api/load-range-rollups.ts`; `lib/query/fetch-api.ts` (a per-request header option only); `e2e/refresh-button.spec.ts` (new); `e2e/refresh-button-role-landing.spec.ts` (new; the lead case, role-probe project; added 2026-11-25 in the RF1 review) |
| UP1 | `components/display/FieldHelp.tsx` (new); `components/manage/users/LiteLLMLinkCell.tsx`; `components/manage/users/UsersPeoplePanel.tsx`; `components/manage/users/detail/**`; `app/api/identities/[oid]/route.ts`; `lib/manage/litellm-email-suggestion.ts` (new; the people list's email suggestion, moved unchanged from `app/api/identities/directory/route.ts`, which calls it: coordinator ruling 2026-11-25, a suggestion that never binds); `app/dashboard/manage/users/[oid]/page.tsx` (one line: the detail goes through `withLiteLLMSuggestion`, coordinator ruling 2026-11-26; T-UP5 found the page read bypassing the route); `lib/data/access/litellm-match.ts` (read only; a new function is kind C); `e2e/manage-users.spec.ts`, `e2e/manage-user-page.spec.ts`, `e2e/manage-users-links.spec.ts` |
| LP1 | `components/table/SearchInput.tsx`; `components/settings/litellm-panel/LiteLLMTeamLinksSection.tsx` and its table parts; `components/litellm/OrganisationSection.tsx`; `app/api/litellm/proxy-teams/[litellmTeamId]/route.ts` (new); `app/dashboard/manage/litellm/[tab]/[id]/page.tsx` (new; the `teams` branch); `components/litellm/proxy-team/**` (new); `e2e/litellm-team-page.spec.ts` (new); `e2e/manage-litellm-teams.spec.ts`; the Organisation cases of `e2e/manage-litellm.spec.ts`, `e2e/manage-team-views.spec.ts`, `e2e/litellm-a11y.spec.ts`, `e2e/manage-pages.spec.ts` (broken on purpose); `lib/litellm/operations.ts` (one line: `budget_reset_at` on `TeamInfoResponse`; coordinator ruling 2026-11-25, kind A); `lib/litellm/proxy-team-exists.ts` (new, server-only, `getTeam` only; coordinator ruling 2026-11-25) |
| SI1 | `components/auth/SignInOptions.tsx`; `app/sign-in/page.tsx`; `auth.ts` (one new server action, `signInWithPassword`; nothing else); `e2e/sign-in-form.spec.ts` (new); `e2e/dev-login.spec.ts`, `e2e/sign-in-role-choice.spec.ts` (broken on purpose) |
| TP1 | `components/manage/TeamPageContent.tsx`; `components/manage/TeamSummaryPanel.tsx` (new); `components/manage/TeamEditDialog.tsx` (new); `app/dashboard/manage/team/[teamId]/page.tsx`; `app/api/teams/[id]/route.ts` (the `PATCH`); `lib/data/access/app-teams.ts` (the update); `lib/manage/team-list.ts` (read only; a new function is kind C); `components/settings/access/**` (the `FieldHelp` mounts only); `components/litellm/team/BudgetLimitsPanel.tsx` (the `FieldHelp` mounts only); `e2e/team-edit.spec.ts` (new); `e2e/manage-team.spec.ts` |
| LP2 | `components/manage/users/LiteLLMUsersList.tsx`; `components/litellm/UserSearch.tsx`; `app/api/litellm/users/[litellmUserId]/route.ts`; `app/dashboard/manage/litellm/[tab]/[id]/page.tsx` (the `users` branch); `components/litellm/proxy-user/**` (new); `e2e/litellm-user-page.spec.ts` (new); `e2e/litellm-users-tab.spec.ts`; `e2e/reset-spend-users.spec.ts` (broken on purpose) |

### Declared overlaps

| File | Units | Rule |
|---|---|---|
| `components/manage/users/LiteLLMUsersList.tsx`, `components/litellm/UserSearch.tsx`, `e2e/litellm-users-tab.spec.ts` | FX1, then LP2 | Same session, in order |
| `app/dashboard/manage/litellm/[tab]/[id]/page.tsx` | LP1 creates it, LP2 adds the `users` branch | Same session, in order |
| `components/table/SearchInput.tsx` | LP1 extends it; LP2 uses it | Contract: props `label: string`, `hideLabel?: boolean`, `maxLength?: number`, `delayMs?: number` (0 = no debounce), `value`, `onChange`, `placeholder?` |
| `components/display/FieldHelp.tsx` | UP1 creates it; TP1 uses it | Contract: `<FieldHelp field="Team totals">text</FieldHelp>`; same session, in order |
| `components/manage/users/detail/UserLinksPanel.tsx` | UP1 owns it; LP2 adds one link line | LP2 starts after UP1 is on `main` (kind D) |
| `components/manage/TeamSummaryPanel.tsx` | TP1 owns it; LP2 adds one link line | LP2 starts after TP1 is on `main` (kind D) |
| `components/litellm/team/MembersPanel.tsx`, `components/manage/users/LiteLLMLinkCell.tsx` | LP2 swaps the search box for `SearchInput` (one mount each) | After UP1 and TP1 are on `main` (kind D) |
| `packages/shared` schema and index files; `test/route-registry.ts`; the spec files | LP1 (+1 `GET`), TP1 (+1 `PATCH`), UP1, LP2, FX1 | Append-only (kind A) |
| `packages/shared/src/schemas/access-control.ts` (the audit action list) and its count test in `access-control.test.ts` | TP1 adds `appteam.update` (beside `appteam.create`) | Append-only (kind A); the count test changes by one |

E2E: RF1 and SI1 each change an e2e shared file (`components/layout/**`,
`auth.ts`) and run the full e2e once at their gate; SI1 also runs the
`base-path` project locally (it touches `auth.ts`). Every other unit runs
its targeted specs once. A case that signs in as a role-probe identity goes
in a spec that matches `PROBE_SPEC` (`playwright.config.ts`:
`role-landing` or `settings-tabs`).

## 7. Tests

Every row is written into the unit's spec text by MR0, so a test cites the
spec section, never this plan (spec-changes §8). Role tables stay complete
(Rule 60.24a).

| Unit | Id | Proves |
|---|---|---|
| FX1 | T-FX1 | Cost by user: a list-shaped answer renders the LiteLLM users; spend is "Hidden" under the cap |
| FX1 | T-FX2 | The user detail request carries the URL date range; the detail renders |
| FX1 | T-FX3 | The team picker request carries the URL date range; the picker lists the teams |
| FX1 | T-FX4 | For every component request to `/api/litellm/**`: the query parses with the route's query schema and the client schema is the route's for that query; an uncovered caller fails the test |
| FX1 | T-FX5 | E2E, stubs that refuse a missing date range: click a user, choose "Members of one team", open Cost by user — no alert |
| RF1 | T-RF1 | The button is in the top bar for a global reader, a lead and a member; `aria-label="Refresh data"`; tooltip; 32px, and 44px below `md` |
| RF1 | T-RF2 | A click refetches every mounted query once and refreshes the page; disabled and spinning while fetching; no spin under reduced motion |
| RF1 | T-RF3 | With `Cache-Control: no-cache`, `GET /api/sync-status` skips its cache; a second bypass for the same key within 10 seconds gets the entry just read (call count, fake timers) |
| RF1 | T-RF4 | Without the header the route serves its cache; `private, no-store` and the `401` are unchanged |
| RF1 | T-RF5 | The rollup cache key includes the last sync run: a new run is read from DynamoDB once; the same run is served from the cache |
| RF1 | T-RF6 | The refresh path never calls `revalidateTag` (structural) *(T-RF2 and T-RF6 amended 2026-11-25 in the RF1 review, U-W1 and Q-W1; the Design System text wins)* |
| UP1 | T-UP1 | The action reads "Create LiteLLM user" on the people rows and in its dialog; its help text; absent when `createUser` is unavailable (LW1) |
| UP1 | T-UP2 | No "Match found" badge; a match shows the email and Link; the confirm dialog is unchanged |
| UP1 | T-UP3 | `FieldHelp`: the button's name, opens on click and Enter, closes on Escape, focus returns, axe clean |
| UP1 | T-UP4 | The name is a visible link; a row click opens the user page, a click on a row button does not |
| UP1 | T-UP5 | The user page's LiteLLM state equals the list's for the same person; `GET /api/identities/[oid]` returns the match only to a caller who may link; an auditor sees "Not linked"; no create action on the page |
| UP1 | T-UP6 | The LiteLLM usage block for a linked person: spend and budget for the URL range; omitted under LD23; "LiteLLM unavailable" on an outage |
| UP1 | T-UP7 | The profile edit is the labelled button "Edit name", only where the caller may edit |
| LP1 | T-LP1 | "Search teams" has the magnifier and a visible label; typing filters both lists by name, alias and id; "No matching teams" |
| LP1 | T-LP2 | Organisation shows no App teams table and no "Rows overlap" sentence; `appTeams[]` is still in the route's answer; a linked app team's name links to its team page |
| LP1 | T-LP3 | `GET /api/litellm/proxy-teams/[id]`: role table (admin, org-admin, auditor `200`; lead `403`; member `403`; unauthenticated `401`); an unknown id `404`; an invalid id `400`; `getTeam` off → `403` before any call; LD23 omits spend and budget; no key and no secret in the answer |
| LP1 | T-LP4 | The page: summary, `BudgetBar`, members, linked app team and lead names; an unlinked team says so; an unknown id is the missing page; a lead gets the missing page |
| LP1 | T-LP5 | The team names in the teams tab and the Organisation table link to the page; E2E per reading role; axe at 375px and desktop |
| SI1 | T-SI1 | Every field of every form has a visible label bound to it; the code field's hint; show/hide on the password; `autocomplete` kept |
| SI1 | T-SI2 | One titled group per enabled method; the master form opens from "Sign in as master user"; nothing renders for a method that is off |
| SI1 | T-SI3 | A password user signs in with email and password, and with the code when enrolled; the session is the `password` provider's |
| SI1 | T-SI4 | One generic message for an unknown, disabled, locked or SSO-bound user, a wrong password and a wrong code (T23); the same message for the master user (T20); no credential in the URL |
| SI1 | T-SI5 | The form is absent while password sign-in is off (D24) |
| SI1 | T-SI6 | Lockout, the security event per attempt and the audit record are unchanged (the existing suites stay green, none edited) |
| SI1 | T-SI7 | E2E: each form at 375px and desktop, axe clean; the sign-in works under the base path |
| TP1 | T-TP1 | The summary shows name, department, kind, lead names, member count and the LiteLLM team; a lead sees "Linked" or "Not linked", never the id |
| TP1 | T-TP2 | `PATCH /api/teams/[id]`: role table (admin, org-admin `200`; lead, auditor, member `403` before parsing; unauthenticated `401`); one `denied` record per refusal |
| TP1 | T-TP3 | A stale version is `409`; a taken name is the creation error; a registry team is `400`; an unknown or out-of-scope team is the same `404` |
| TP1 | T-TP4 | The write records `appteam.update` with the old and new values; the team directory cache is refreshed, so the list, the pickers and the users table show the new name |
| TP1 | T-TP5 | After a move, a lead of the old department no longer has the team in scope and a lead of the new one has (the scope is read per request) |
| TP1 | T-TP6 | `FieldHelp` on each field of spec-changes §2.5, with that text |
| TP1 | T-TP7 | Edit team is absent for a lead, an auditor and on a registry team; E2E click for admin and org-admin; axe with the dialog open at 375px and desktop |
| LP2 | T-LP6 | "Search users" has the magnifier; one character shows "Type at least 2 characters"; a longer term narrows the list, and "No users found" when nothing matches |
| LP2 | T-LP7 | The detail read returns `teams[]` and `appUser` to the three global roles and neither to a lead; the role table of the route is unchanged; LD23 unchanged |
| LP2 | T-LP8 | The page: identity, spend, budget, daily spend, teams, the linked person and their team, or "Not linked to a dashboard user"; an unknown id and a lead get the missing page |
| LP2 | T-LP9 | The user cell links to the page; nothing renders under the table; Reset spend and Link / Unlink work from the page for the roles that have them |
| LP2 | T-LP10 | The user page and the Team page summary link to the LiteLLM pages only for the three global roles |

## 8. Orchestration

- Each worker runs its units as a workflow (`workflow-<session>.md`), with
  the user's opt-in per run. Agents: 37, plus a reserve of 6 for fix rounds
  (43 of the pool of 80). Peak: 3 per session, 9 across sessions.
- Gate per `temp/planner/process/adopted-run-rules.md`: cheap checks first,
  the gate as a shell script, long runs once. Before `ready`:
  `temp/planner/mgmt-round2/review-lessons.md`.
- Overlap of the four kinds is a note in the handover; a sensitive file is
  a question first. SI1's one action in `auth.ts` and TP1's write route are
  declared here and reviewed with security scope.
- Merge order: MR0; FX1; RF1 and UP1 in either order; LP1; SI1 and TP1 in
  either order; LP2. After each landing the units in flight merge `main`
  before their gate. RF1 and SI1 bring an e2e shared file: units in flight
  re-run their targeted specs once after merging them.
- At a usage freeze: FX1 keeps priority (it removes errors users see), then
  SI1. Every worker commits what passed and writes its report.

## 9. Guards and out of scope

- No write to LiteLLM is added. No gateway operation is added.
- No permission is widened: the two new pages and the new read are for the
  roles that read the same data in the tabs today; the user page shows a
  match only to a caller who may link; a lead's answers are unchanged.
- `auth.ts`: one new server action; no provider, callback or session rule
  changes.
- Never `revalidateTag` from the refresh path.
- Out of scope: deleting a team; password reset, disable or delete on the
  user page (they stay in Settings, the user, 2026-11-18); PERF-2, PERF-3;
  the favicon under the base path; exports.

## 10. Handover and completion

Each unit hands over with: the gate evidence at the final commit; the test
delta (Rule 70.12); files outside its ownership row as the row to add;
`overlap-note` lines; for RF1, SI1, LP1, TP1 and LP2, the list of threat
items its tests prove.

Complete when: MR0 and the seven units are on `main`; every Verify line of
implementation-phases — *Management improvements, round 3* is ticked with
its evidence; CI is green on the push.

## 11. `/goal` lines (the user types these, one per worker session)

- `litellm_worker`: `/goal FX1, then LP1, then LP2 of docs/plans/20261125_management_round3.md are ready: each at a green branch gate with its handover sent, in that order`
- `improvements_worker`: `/goal RF1, then SI1 of docs/plans/20261125_management_round3.md are ready: each at a green branch gate with its handover sent, in that order`
- `bedrock_worker`: `/goal UP1, then TP1 of docs/plans/20261125_management_round3.md are ready: each at a green branch gate with its handover sent, in that order`
