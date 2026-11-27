# Run plan — Management improvements, round 4 (units MR4, TM2, TD1, UP2, AU1, AD1)

Written by the planner, 2026-11-27, from the user's list of the same day
("Plan those changes"). Package for the coordinator:
`temp/planner/mgmt-round4/` (`plan.md`, `spec-changes.md`, one brief per
unit, one workflow design per worker session). Where the two differ, this
file wins.

## 1. The ask (the user, 2026-11-27, in their words)

| # | Area | The user's words |
|---|---|---|
| 1 | Teams | "delete app teams" |
| 2 | Teams | Getting "This person is already belongs to a team. Use Move to change their team" but the new member is not listed as member |
| 3 | Teams | "Add member", "Add admin" and "Save visibility" should be part of the Edit page |
| 4 | Teams | "Approve and add" - rename to approve and we dont need a search people to approve - only a confirmation and done |
| 5 | Teams | "Pending invitations" section should be merge to team "member" and clearly see that the user is not a member yet and show then "approve" button |
| 6 | All | When creating a user, team u other, it should display automatically, no by reloading the page |
| 7 | Users | Add app user, tried to create a new one manually but nothing happens |
| 8 | Users | Pagination when you sync users - Why admin user are skipped? |
| 9 | Users | Add search user in "Not signed in yet" |
| 10 | Users | click on synced user the "add user" button - it does not appear in People table or teams view - also "Add User" button is still visible |
| 11 | Users | we dont need Authenticator code when you "Add user" and set password - this process should be simpler |
| 12 | Sign-in | Remove Authenticator code for login - we dont need it |
| 13 | Audit | Pagination and search |

## 2. What exists, and what the code shows (read 2026-11-27, `main` at `938eb853`)

Nothing was run; these are readings of the code, to be confirmed by each
unit's first step ("diagnose first").

- **Item 2.** "Add member" by email (`components/settings/access/MembersSection.tsx`)
  always creates a **pending invite** (`createPendingItem`,
  `lib/data/access/pending.ts`), never a member. It then refreshes only the
  member list (`["access","members"]`), not the pending list, so the invite
  does not show without a reload. One email holds one invite
  (`attribute_not_exists(PK)`), and that conflict is reported as
  `ALREADY_AFFILIATED`: "This person already belongs to a team. Use Move to
  change their team." So a second "Add member" for the same email gives the
  message the user saw, about a person who is in no list on screen. The same
  code also comes from the accept step when the person is a member of
  another team; the message never names the team.
- **Items 7 and 10.** `POST /api/password-users` needs recent authentication.
  When the session is not recent, the "Confirm it's you" step is a full
  sign-in that returns to **Settings → Access → Sign-in**
  (`STEP_UP_REDIRECTS["password-users"]` in `lib/auth/step-up.ts`), closes
  the dialog and does not replay the write. From the Users page that looks
  like "nothing happens". When the write does succeed, the new password
  user is **not in People**: the people list reads identity records
  (`lib/data/access/directory-rows.ts`), and an identity is written only at
  the first sign-in (`createPasswordUser` writes the sign-in item only). The
  team step of the dialog sends an **email invite**, which in password mode
  never binds (Access Control — SM8: an invite binds only at an SSO
  sign-in), although the dialog says "the person joins at their first
  sign-in". The "Not signed in yet" row keeps its **Add user** button because
  the placeholder is consumed only at the first sign-in (SM6), and the panel
  reloads only itself.
- **Item 8.** The sync reads every page of LiteLLM's user list
  (`lib/litellm-user-sync/run.ts`); the dialog shows each group 25 rows at a
  time and grows with "Show more". LiteLLM admin users and the service user
  are skipped **on purpose** (Access Control — *LiteLLM user links*,
  *Privileged targets refused*; LiteLLM spec LT18): a link shows that
  LiteLLM user's spend and key metadata to the linked person and puts the
  user under the team's resets.
- **Item 13.** The App audit (`components/settings/access/AuditLogSection.tsx`,
  `GET /api/audit`) shows one UTC day, oldest first, with "Load more" and no
  search. The Gateway audit (`components/litellm/AuditSection.tsx`,
  `GET /api/litellm/audit`) follows the page's date range and shows one page;
  LiteLLM's `/audit` takes `page`, `page_size` and `search`.
- **Items 11 and 12.** Authenticator codes are in the setup page
  (`components/auth/PasswordSetupForm.tsx`), the sign-in form
  (`components/auth/SignInOptions.tsx`), the step-up dialog, the password
  change form, Settings → Password users ("Authenticator" column and the
  TOTP reset), `lib/auth/{totp,totp-user,password-setup,password-credentials,master-user,step-up}.ts`
  and `env.ts`. They are required by the user's decision D23 (2026-11-14)
  for every password user above `internal-viewer`, and for the master user
  in `prod` (D16, D19).

## 3. Decisions

Agent decisions (planner, 2026-11-27, Rule 00.3) unless marked **user**.
Each goes into the spec with its reason (`spec-changes.md`).

| Id | Decision | Reason |
|---|---|---|
| D-R4-1 | **user (item 5).** One member list: a pending member invite is a row of the Members list, marked "Invited — not a member yet", with **Approve** and **Cancel invite**. A pending admin invite is a row of the Team admins list, marked "Invited — not an admin yet" (Cancel only; INV1 accepts member invites only). An invite older than 30 days carries "Stale". The separate "Pending invitations" section is retired wherever it is mounted; the `pending-access` slug resolves to the member list | The user's words; one place shows who is in the team and who is waiting |
| D-R4-2 | **user (item 4).** The action is **Approve** everywhere ("Approve and add" is retired). It is a confirmation: no search box and no written reason. One candidate: confirm. No candidate: the dialog says the person has not signed in yet and joins at their first SSO sign-in. Several: a choice among the server's candidates. The target is always one of the server-computed candidates, for every role; the directory search of the candidates route (`q`) is removed. `reason` becomes optional in the accept body and is stored only when sent | The user's words. Removing the search narrows what an admin can bind; a person whose sign-in differs from the invited email is placed from Users → the person → Add to team |
| D-R4-3 | A second invite for an email answers `409 ALREADY_INVITED` ("This person already has a pending invite" plus the team name when the caller may see that team). `ALREADY_AFFILIATED` keeps its meaning (a member of a team) and names the team under the same rule | Item 2: the old message described a member, and the person was an invite |
| D-R4-4 | **user (item 3), shape by the planner.** Edit is a page, `/dashboard/manage/team/[teamId]/edit`: Details (name, department; created teams; `internal-admin`, `internal-org-admin`), Add member, Team admins (list, Add admin, Revoke), Visibility (Save). The Team page keeps Summary, the one member list with its row actions (Approve, Cancel invite, Move, Remove), Budgets and Keys. `TeamEditDialog` is retired; its form is the Details panel. The page's button is "Edit team" for a caller who may write something there and "Team settings" for a read-only caller (`internal-auditor`). No permission changes: every route decides as today | Four forms with their own save do not fit a dialog; a page has a URL; the auditor keeps the read it has today |
| D-R4-5 | **user (item 6).** A write shows its result without a reload: after a create or a change, every list on screen that the write affects re-reads. Recorded once in the Design System; each unit fixes its pages and proves it by test | The user's words |
| D-R4-6 | **user (item 1); rule = the default of Q-R4-2.** `DELETE /api/teams/[id]`: created teams only; `internal-admin` or `internal-org-admin`, `403` before parsing; body `{ version }`. Only an **empty** team: no members, no pending invites, no team admins, no LiteLLM team link — otherwise `409 TEAM_NOT_EMPTY`, the message naming what is left. Removes the team, its name reservation and its visibility settings in one transaction, audited `team.delete`. A member, invite, admin or link written while the delete runs never ends up on a deleted team. No step-up (as create and edit). Nothing is written to LiteLLM | People are never left without a team silently; the smallest irreversible action |
| D-R4-7 | Creating a password user also writes the person's **identity record** (the `local:` id it already gets, email, display name, sign-in method, no last sign-in). The dialog's team step then adds a **member by id** (not an email invite), and the creation runs the LiteLLM link step a first password sign-in runs (`PENDING#{email}`, no LiteLLM call). SSO mode is unchanged (an invite). Deleting the password user removes what creation wrote. Password users created before this unit appear at their first sign-in, as today | Items 7 and 10: the person shows in People and in the team at once and the "Not signed in yet" row goes. The email key of a password user is the email the admin typed at creation and at sign-in alike (SM3), so linking at creation is not weaker than at first sign-in; the Joiner rule (invites bind at an SSO sign-in) is untouched |
| D-R4-8 | The step-up returns to where it started. A new step-up section `users` returns to `/dashboard/manage/users?add=user`, which opens the Add user dialog (the flag is removed from the URL once read). When the password step is offered and the session is not recent, the step-up comes **before** the form. A step-up at submit returns to the empty dialog with "Confirmed. Enter the details again." (the draft is never kept, T32). Add user never ends silently: the result view or a visible error | Item 7. Recent authentication itself is unchanged |
| D-R4-9 | **user (item 9).** "Not signed in yet" gets a search box (2–100 characters, server-side, substring over the email and the LiteLLM user id) and reads through TanStack Query. A row whose email already has a password user shows "User added — setup pending" and no Add user button | The user's words; item 10 |
| D-R4-10 | **user (item 8).** The sync dialog pages each group (25 a page, Previous and Next, "1–25 of n") instead of growing. A skipped row states its reason; "LiteLLM admin user" carries a help text with the rule. The rule itself stays (Q-R4-3) | The user's words |
| D-R4-11 | **user (items 11, 12), 2026-11-27; scope per Q-R4-1.** Authenticator codes are removed for password users: setup, sign-in, step-up, password change, the "Authenticator" column and the TOTP reset (button and route). A stored secret is ignored and deleted at the person's next successful sign-in or password change. Supersedes D23 and the TOTP part of D31; the lockout, the rate limit and the password rules stay. The master user follows the answer to Q-R4-1 | The user's instruction. It removes a control the user set on 2026-11-14, so it is recorded as the user's decision, with the residual risk |
| D-R4-12 | **user (item 13).** The App audit follows the page's date range (the range control the Gateway source already uses; `DateRangeQuerySchema`, 90 days) and shows newest first by default. One request reads at most 31 day-partitions | A search across days is the point; oldest-first over a month would open on old records (supersedes D-SR1 for this table only) |
| D-R4-13 | **user (item 13).** Both audit sources page 50 rows with Previous and Next and "Rows a–b" ("of n" where LiteLLM gives a total). "Load more" is retired. The page is not in the URL | The user's words |
| D-R4-14 | **user (item 13).** One search box (2–100 characters, 500 ms debounce, URL `q`). App: server-side, case-insensitive substring over action, result, code, target type and id, and actor id, plus the people whose name or email contains the text (as actor or as identity target); one request scans at most 2,000 records and says how far it searched ("Searched to <day>", Continue). Gateway: LiteLLM's own `search` parameter. The search text is not stored in the `audit.view` record | The user's words; bounded reads |

### Questions

**User-only. The unit named does not start before the answer.**

| Id | Question | Options | Gates |
|---|---|---|---|
| Q-R4-1 | Authenticator codes: remove them for whom? | **(a)** password users, the step-up and the setup page; the break-glass master user keeps its code in `prod` (recommended: it is the one account that can grant `internal-admin`). **(b)** everyone, the master user in `prod` too (changes D16 and D19 and the production configuration) | AU1 |
| Q-R4-2 | Delete a team: who, and what about members? | **(a)** `internal-admin` and `internal-org-admin` (as create and edit); only an empty team (recommended). **(b)** the same roles; deleting also removes the team's members, invites, admins and link | TD1 |

**With a default in force (the unit runs; say so to change it).**

| Id | Question | Default |
|---|---|---|
| Q-R4-3 | Should the sync link LiteLLM admin users? | No: they stay skipped (LT18); the dialog explains why |
| Q-R4-4 | Edit as a page (D-R4-4), and Approve without the written reason (D-R4-2)? | Yes to both, as the list reads |
| Q-R4-5 | A password user shows in People, and can be placed in a team, from the moment an admin adds them (D-R4-7)? | Yes |

Still open from earlier plans: Q-F-2 (the same chart on My usage and the
app Team page; default later), Q-F-3 (remove `display.orgName` from the
config schema; default keep).

## 4. Units

| Unit | Title | Items | Session | Worktree | Branch | Depends on | Review |
|---|---|---|---|---|---|---|---|
| MR4 | Spec for TM2, UP2, AD1 | — | the coordinator | `.claude/worktrees/mr4` | `docs/management-round4` | — | spec-guardian |
| TM2 | Team page: one member list, Approve, the Edit page | 2, 3, 4, 5, 6 | `bedrock_worker` | `.claude/worktrees/tm2` | `feature/team-members-edit-page` | MR4 | quality + UI; **security scope** (the accept route, the new page's access) |
| TD1 | Delete an app team | 1 | `bedrock_worker` | `.claude/worktrees/td1` | `feature/team-delete` | TM2; **Q-R4-2** | quality + spec-guardian + UI; **security scope** (a new write route) |
| UP2 | Users page: Add user, Not signed in yet, the sync dialog | 6, 7, 8, 9, 10 | `litellm_worker` | `.claude/worktrees/up2` | `feature/users-add-user-and-pending` | MR4 | quality + UI; **security scope** (identity at creation, the step-up return) |
| AU1 | Remove authenticator codes | 11, 12 | `litellm_worker` | `.claude/worktrees/au1` | `feature/remove-authenticator-codes` | UP2; **Q-R4-1** | quality + spec-guardian + UI; **security review** (sign-in) |
| AD1 | Audit: pages and search | 13 | `improvements_worker` | `.claude/worktrees/ad1` | `feature/audit-pages-search` | MR4; OC3 landed | quality + UI; **security scope** (the audit read) |

One branch and one squash commit per unit (Rule 30.4). TD1 and AU1 apply
their own spec text in their first commit, after the user's answer (it is
not in MR4, so nothing gated lands early).

**Start condition.** The weekly usage stood at the caution tier (85 %) on
2026-11-27; the coordinator decides when to start. Suggested order by value
if only one session can run: TM2, UP2, AD1, then AU1 and TD1.

## 5. What each unit delivers

### MR4 — spec (the coordinator)

Applies `spec-changes.md` Part A (sections A1–A5) and commits this plan and
its `docs/plans/README.md` row. Docs only; `spec-guardian` reviews.

### TM2 — Team page (items 2, 3, 4, 5, 6)

1. **Diagnose first.** Reproduce item 2 against DynamoDB Local in three
   cases — an email that already has an invite, an email of a member of
   another team, an email of a member of this team — and write what each
   answers today into `temp/run-tm2/diagnosis.md`.
2. The Members list shows members and invites (D-R4-1); the Team admins
   list shows admin invites; the pending section is retired.
3. **Approve** (D-R4-2): the label, the confirmation dialog, the accept
   body, the candidates route without `q`, the same label in
   `PersonPlacement` and the LiteLLM members panel.
4. `ALREADY_INVITED` and the team name in the two messages (D-R4-3).
5. The Edit page (D-R4-4); `TeamEditDialog` removed.
6. Item 6 on these pages: after Add member, Approve, Cancel invite, Add
   admin, Revoke, Save visibility, Move, Remove and New team, the lists on
   screen re-read (D-R4-5).

### TD1 — Delete an app team (item 1)

`DELETE /api/teams/[id]` (D-R4-6), registered in `test/route-registry.ts`;
a "Delete team" panel at the foot of the Edit page with a confirmation
dialog that lists what blocks the delete; after a delete the browser goes
to the team list, which no longer shows the team. Rule 10.3 and Rule 50.4
name the new write. `docs/future-improvements.md` — *App team rename and
delete* is marked adopted.

### UP2 — Users page (items 6, 7, 8, 9, 10)

1. **Diagnose first.** With a fresh and with a stale session, in each
   sign-in mode available locally, run Add user by hand in the test
   harness (Vitest and one Playwright case), and write what happens into
   `temp/run-up2/diagnosis.md`.
2. Identity at creation, the team step by id, the link step (D-R4-7).
3. The step-up return and its order (D-R4-8).
4. "Not signed in yet": search, TanStack Query, "User added — setup
   pending" (D-R4-9).
5. The sync dialog's pages and reasons (D-R4-10).
6. Item 6 on this page: Add user, Invite, Remove, the sync's Apply and a
   LiteLLM link change re-read People **and** "Not signed in yet".

### AU1 — Remove authenticator codes (items 11, 12)

Per the answer to Q-R4-1 (D-R4-11). The setup page asks for a password
only; the sign-in form and the step-up have no code field; the password
change form asks for no code; Settings → Password users loses the
"Authenticator" column and the TOTP reset; `POST
/api/password-users/[email]/totp-reset` is removed with its registry
entry. A stored secret is ignored at sign-in and deleted at the next
successful sign-in or password change. `TOTP_KMS_KEY_ID` stays an accepted
variable and is no longer required in `prod` when no code remains that
uses it; removing the key from the CDK stacks is a follow-up for the user
(a deploy). Under option (a) the master user's code and `AUTH_MASTER_TOTP_SECRET`
are untouched.

### AD1 — Audit (item 13)

The App source on the page's date range, newest first (D-R4-12); pages of
50 on both sources (D-R4-13); the search box on both (D-R4-14):
`GET /api/audit` takes `dateFrom`, `dateTo`, `q`, `dir`, `cursor`;
`GET /api/litellm/audit` takes `q` and passes it as LiteLLM's `search`.
The audited view stays: one `audit.view` record per request, its target
the range. No new route.

## 6. Ownership

Paths under `apps/dashboard/` unless they start with `docs/`, `packages/`
or `.claude/`.

| Unit | Owns (may create and edit) |
|---|---|
| MR4 | `docs/specs/**` (Part A), `docs/plans/**` |
| TM2 | `components/settings/access/{MembersSection,TeamAdminsSection,VisibilitySection,PendingAccessSection,AcceptInviteDialog,AccessSections}.tsx` and their tests; `components/manage/{TeamPageContent,TeamEditDialog,TeamSummaryPanel,TeamSummarySection,TeamCreateTrigger}.tsx` and tests; a new `components/manage/team-edit/**`; `app/dashboard/manage/team/[teamId]/**` (the page and a new `edit/`); `app/api/teams/[id]/members/route.ts`, `app/api/teams/[id]/members/pending/**`; `lib/data/access/pending.ts`; `components/manage/users/PersonPlacement.tsx`; `components/litellm/team/MembersPanel.tsx` (the label only); `lib/settings-tabs.ts` (the slug); `e2e/{manage-team,manage-team-views,team-invite-approve,accept-invite,team-edit,team-edit-role-landing,settings-access}.spec.ts` |
| TD1 | `app/api/teams/[id]/route.ts` (the `DELETE`) and its test; `lib/data/access/` — the team delete function and the guard on the writes that add to a team; a new `components/manage/team-edit/DeleteTeamPanel.tsx`; a new `e2e/team-delete.spec.ts`; `.claude/rules/10-server-only-boundary.md`, `.claude/rules/50-security-and-secrets.md`, `docs/future-improvements.md`, the specs (Part B) |
| UP2 | `components/manage/users/{AddUserDialog,UsersPeoplePanel,PendingLinksList,LiteLLMSyncDialog,LiteLLMSyncButton}.tsx` and tests; `app/dashboard/manage/users/page.tsx`; `app/api/password-users/route.ts`; `app/api/identities/pending-links/route.ts`; `lib/data/access/password-users.ts` and the pending-links read; `lib/auth/step-up.ts` (one entry), `lib/auth/add-user-steps.ts`; `e2e/{manage-users,users,users-litellm-sync}.spec.ts` |
| AU1 | `auth.ts`, `env.ts`, `lib/auth/{totp,totp-user,password-setup,password-credentials,password-change,password-providers,master-user,step-up,auth-config,secret-envelope}.ts`, `lib/data/access/{password-credentials-store,password-users,sso-binding}.ts`; `components/auth/{PasswordSetupForm,SignInOptions}.tsx`, `components/account/ChangePasswordForm.tsx`, `components/settings/access/{PasswordUsersSection,StepUpDialog}.tsx`; `app/account/setup/page.tsx`, `app/dashboard/account/page.tsx`, `app/api/account/password/route.ts`, `app/api/password-users/[email]/totp-reset/**` (removed); `e2e/{account-setup,account,sign-in-form,base-path-sign-in,settings-access}.spec.ts`; the specs (Part C), `docs/guides/auth-setup.md`, `docs/guides/operations.md` |
| AD1 | `components/settings/access/AuditLogSection.tsx`, `components/litellm/AuditSection.tsx`, `components/manage/AuditPageContent.tsx` and tests; a new `components/manage/audit/**`; `app/api/audit/route.ts`, `app/api/litellm/audit/route.ts`; `lib/data/access/audit-view.ts`; the audit query schema in `lib/litellm/read-views.ts` and the `listProxyAuditLog` parameters in `lib/litellm/operations.ts`; `e2e/manage-pages.spec.ts` (the audit cases) and a new `e2e/manage-audit.spec.ts` |

### Declared overlaps

| File | Units | Rule |
|---|---|---|
| `components/settings/access/access-error-message.ts` | TM2, TD1, UP2 | Append-only (kind A): one line per code |
| `packages/shared/src/schemas/**`, `test/route-registry.ts` | TM2, TD1, UP2, AD1, AU1 | Append-only, except AU1's removal of the TOTP reset entry; each unit then runs the full Vitest once |
| `lib/auth/step-up.ts` | UP2 (one new entry), then AU1 (the code fields) | Same session, in order |
| `lib/data/access/password-users.ts` | UP2 (creation, delete), then AU1 (the secret) | Same session, in order |
| `components/settings/access/StepUpDialog.tsx` | UP2 reads; AU1 edits | UP2 passes a `section` and edits nothing |
| `e2e/settings-access.spec.ts` | TM2 (members and invites), AU1 (password users) | Different cases; AU1 merges `main` first |
| `components/manage/team-edit/**` | TM2 creates; TD1 adds one panel | TD1 after TM2 |
| Specs | MR4 (Part A), TD1 (Part B), AU1 (Part C) | Each part names its own sections |

## 7. Tests

Ids go into the spec text (`spec-changes.md`); tests cite the spec section
and id, never this plan. Security cases are marked **S**.

| Id | Proves | Layer |
|---|---|---|
| T-TM1 | The member list shows members and invites; an invite row reads "Invited — not a member yet" with Approve and Cancel invite for a caller who may; stale invites are marked; no separate pending section; the admins list shows admin invites without Approve | component |
| T-TM2 **S** | Accept: the target must be one of the server's candidates for every role (`404` otherwise); the candidates route no longer reads `q` (a request with `q` answers the same candidates); `reason` optional and stored when sent; self-accept `403`, privileged `409`, the refusal order unchanged; one `denied` record per refusal | integration |
| T-TM3 | The Approve dialog: one candidate confirms; none explains; several offers the choice; no search box, no reason field; the label "Approve" on the Team page, the Users page and the LiteLLM members panel | component |
| T-TM4 | A second invite for the same email is `409 ALREADY_INVITED`; the two messages name the team only when the caller may see it; the three diagnosed cases answer as specified | integration + component |
| T-TM5 **S** | The Edit page: `404` for a caller with no access to the team; a Lead in scope sees Add member, Team admins and Visibility and not Details; `internal-auditor` sees it read-only; every write still decided by its route (no client-only gate) | page test + integration |
| T-TM6 | After each write of the Team page and the Edit page, the lists on screen re-read without a reload | component |
| T-TM7 | E2E: invite, see the row, Approve, see the member; open Edit as an admin and as a Lead; axe at 375px and desktop | e2e |
| T-TD1 **S** | `DELETE /api/teams/[id]`: the role table (`403` before parsing, one `denied` record), registered in the route registry; a team not created in the app is refused as the edit route refuses it; a stale version `409` | integration |
| T-TD2 **S** | `409 TEAM_NOT_EMPTY` for each of: a member, an invite, a team admin, a LiteLLM link; an empty team is deleted with its name reservation and visibility; the name is free again; `team.delete` audited; no LiteLLM call | integration |
| T-TD3 **S** | A member, invite, admin or link write that races the delete never leaves an item on a deleted team | integration |
| T-TD4 | The Delete panel: shown to the two roles on a created team; the dialog lists what blocks; after a delete the list shows no such team | component + e2e |
| T-UP10 **S** | Creating a password user writes the identity record with the `local:` id; the directory lists the person at once; nothing is granted (no role, no team, no scope); deleting the user removes the identity, the membership and the link | integration |
| T-UP11 **S** | The team step adds a member by id for a password user and an invite in SSO mode; the creation makes the LiteLLM link from `PENDING#{email}` under the sign-in rule's refusals (claimed, privileged, another link) with no LiteLLM call | integration |
| T-UP12 **S** | The step-up section `users` returns to `/dashboard/manage/users?add=user` and to nowhere else (the redirect is from the fixed table, never from the request); recent authentication is still required for the write | unit + integration |
| T-UP13 | Add user never ends silently: the step-up comes first for a stale session; a step-up at submit returns to the empty dialog with the notice; the result view or an error always shows | component |
| T-UP14 | "Not signed in yet": the search (`q` bounds, the narrowed list, the empty state); a row with a password user shows "User added — setup pending" and no Add user; the route's `400` on a bad `q` | integration + component |
| T-UP15 | The sync dialog pages each group; a skipped row states its reason; the help text on "LiteLLM admin user" | component |
| T-UP16 | After Add user, Invite, Remove, Apply and a link change, People and "Not signed in yet" both re-read | component |
| T-UP17 | E2E (password mode): Add user from People and from a "Not signed in yet" row — the person is in People and in the chosen team, the row is gone; axe | e2e |
| T-AU1 **S** | Sign-in with a password alone succeeds for a password user of any role; a stored secret is ignored and removed; the lockout and the rate limit still hold; the generic failure message is unchanged | integration |
| T-AU2 **S** | Setup needs no code; `TOTP_REQUIRED` and `TOTP_INVALID` are gone; the reset link sets a password only | integration |
| T-AU3 **S** | The step-up accepts the password alone; the TOTP reset route is gone (`404`) and out of the registry | integration |
| T-AU4 **S** | The master user: as answered in Q-R4-1 (option (a): the code is still required in `prod` and the misconfiguration check T21 still fails closed) | unit + integration |
| T-AU5 | No authenticator field or column in the setup page, the sign-in form, the step-up dialog, the password change form and Settings → Password users | component + e2e |
| T-AD1 **S** | `GET /api/audit`: the role table unchanged; `dateFrom`/`dateTo` over 90 days `400`; newest first by default; at most 31 day-partitions per request; one `audit.view` record per request, target the range, without the search text; a bad cursor audits nothing | integration |
| T-AD2 **S** | The App search: matches by action, result, code, target, actor id and by a person's name or email; at most 2,000 records scanned, with the continuation; a `q` outside 2–100 is `400`; no snapshot field is searched or returned | integration |
| T-AD3 | `GET /api/litellm/audit`: `q` goes to LiteLLM as `search` and only that; `page` and the totals pass through; the OSS state unchanged | integration |
| T-AD4 | The Audit page: Previous and Next with "Rows a–b" on both sources; the search box and its URL parameter; the range; the empty and the "Searched to" states | component |
| T-AD5 | E2E: page forward and back, search, both sources for `internal-admin` and `internal-auditor`; axe at 375px and desktop | e2e |

## 8. Orchestration

- Queues: `bedrock_worker`: TM2 → TD1. `litellm_worker`: UP2 → AU1.
  `improvements_worker`: OC3 (in flight) → AD1.
- MR4 lands first. TM2, UP2 and AD1 can run at the same time: their files
  are disjoint apart from the append-only ones (§6).
- TD1 and AU1 wait for their unit before them **and** for the user's
  answer; the coordinator fills the answer into the brief.
- E2E: UP2 and AU1 touch `lib/auth/**` (a shared file): the full e2e once
  at the green gate; AU1 also runs the `base-path` project once locally
  (sign-in). TM2, TD1 and AD1 run their targeted specs (the briefs list
  them). Every unit changes a shared schema or the route registry: the
  full Vitest once at its final commit.
- Agents per unit (started at most / at once): TM2 7 / 3, TD1 4 / 2, UP2
  7 / 3, AU1 5 / 2, AD1 5 / 2; sonnet for tests and code.

## 9. Guards and out of scope

- No permission is widened. TM2 moves forms and removes a search; UP2
  keeps recent authentication; AD1 keeps the audit read's roles.
- AU1 removes a control by the user's instruction and only that one: the
  lockout, the rate limit, the password rules, the generic error and the
  setup link's single use stay.
- Nothing is written to LiteLLM by any unit. The sync's skip rule stays.
- Not in this plan: the master user's code unless the user answers (b);
  removing the KMS key from the CDK stacks; deleting a team that still has
  people unless the user answers (b); a result or action filter on the
  audit; invites binding at a password sign-in (SM8, the user's "No, keep
  as today").

## 10. Handover and completion

Each unit: the ready self-check (Rule 70.12), the test delta, and for the
security cases the route's guard `file:line`, the refusal order and the
fields of the answer. TM2 and UP2 attach their `diagnosis.md`. The round
is complete when the six units are on `main`, CI is green and the
implementation-phases boxes are ticked.

## 11. `/goal` lines (the user types these, one per fresh worker session)

After MR4 has landed:

- `bedrock_worker`: `/goal Unit TM2 of docs/plans/20261127_management_round4.md: follow your brief in temp/coordinator/briefs/ until the branch gate is green and you have sent "ready".`
- `litellm_worker`: `/goal Unit UP2 of docs/plans/20261127_management_round4.md: follow your brief in temp/coordinator/briefs/ until the branch gate is green and you have sent "ready".`
- `improvements_worker` (after OC3): `/goal Unit AD1 of docs/plans/20261127_management_round4.md: follow your brief in temp/coordinator/briefs/ until the branch gate is green and you have sent "ready".`

After the answers: the same line with `TD1` (`bedrock_worker`, after TM2)
and `AU1` (`litellm_worker`, after UP2).
