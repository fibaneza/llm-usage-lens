# LiteLLM User Sync Prompt — reset spend from the user lists, and LiteLLM users synced into Management → Users (units RS1, SYNC1, SYNC2)

This prompt defines three units for one worker session, `litellm_worker`,
run in order under the coordinator (`.claude/prompts/coordinator_prompt.md`). The
worker's role — how it takes a brief, its boundaries, the workflow, the
branch gate, the handover and the one-line messages — is
`.claude/prompts/worker_prompt.md`. This file says **what to build**.

Plan package (planner, 2026-11-18): `temp/planner/litellm-user-sync/` in
the primary checkout — `plan.md`, `spec-changes.md`, `brief-sync1.md`,
`brief-sync2.md`, `workflow-litellm_worker.md`.

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`docs/plans/shared-contracts.md` → this file → `.claude/prompts/coordinator_prompt.md`
→ the brief → `.claude/prompts/worker_prompt.md`. This file never overrides a rule
or a spec. Each unit amends its specs **first**, as the first commit on its
branch (Rule 00.2), from `spec-changes.md`.

## 1. What the user asked for (2026-11-18)

1. "Can you add the button in the litllem user as well and user 'page'?" —
   the Team page's *Reset spend*, on Management → LiteLLM → *LiteLLM users*
   and on Management → Users. **Unit RS1.**
2. "the user from litellm must be sync to management users, but not mapped
   automatically to a team, only if the team is mapped with a litellm team
   and exist on litllm". **Unit SYNC1.**
3. "On demand and scheduled". **SYNC1** is on demand; **SYNC2** is the
   schedule.

Item 2 **supersedes "never automatic"** (Access Control D27 as applied to
LiteLLM user links; LiteLLM spec — *Linking*), by user decision. T-MI1 stays
in force: the sync links only on an exact email match.

## 2. What already exists — do not rebuild it

| Need | Exists | Where |
|---|---|---|
| Reset one membership's spend | `POST /api/litellm/teams/[teamId]/members/[oid]/reset-spend`, matrix, audit, `BudgetReset` ledger | LiteLLM spec — `resetMemberSpend`; M4 |
| List LiteLLM users page by page | `searchUsers` without `search`, 25 rows a page | `lib/litellm/operations.ts`; LiteLLM spec — `searchUsers` (D16a) |
| A LiteLLM team and its members | `getTeam` (`members_with_roles`) | `lib/litellm/operations.ts` |
| App team ↔ LiteLLM team links | `listTeamLinks`, `getTeamLink` | `lib/data/litellm/team-links.ts` |
| The team directory (registry and created teams) | `findTeamEntry` and the directory | `lib/api/team-directory.ts` (M2) |
| Write a LiteLLM user link with its one-to-one claim and audit | `writeLiteLLMUserLink` (modes `match`, `manual`) | `lib/data/access/identity-links.ts` (M3) |
| Privileged-target and service-user refusal | `readLinkTarget`, `PRIVILEGED_TARGET` | `lib/api/litellm-user-link.ts` (LT18) |
| Member affiliation, **at most one per person** | `addMember` (`409 ALREADY_AFFILIATED`), `getAffiliation` | `lib/data/access/affiliations.ts` |
| A pending member by email, bound at first sign-in | `createPendingItem`, `listPendingFor`, the binding in `applySignInResolution` | `lib/data/access/pending.ts`, `sign-in-sync.ts`; Access Control — *Joiner* |
| The people list of Management → Users | `GET /api/identities/directory` | Access Control — *API routes* |
| A dashboard-only operation with a toggle and no LiteLLM route | `requestBudgetReset` | `lib/litellm/allowlist.ts`, `packages/shared/src/schemas/litellm-gateway.ts` (MG-D11a) |
| Audited transactions, `denied` records, `403` before parsing | `commitAudited`, `withRoute`, `matrixWrite` | `lib/data/access/**`, `lib/api/**` |
| The platform: task definition, task role, alarms, CDK inputs | `infra/lib/dashboard-service/**`, `infra/lib/inputs.ts` | Platform spec |

**There is no "pending user".** A person has an identity only after they
sign in, or as a password user that an `internal-admin` creates with recent
authentication and a setup link shown once (Design System — *Users*, D15).
The sync never creates a password user, a credential or an identity. See
S3.

## 3. Decisions

The coordinator decided D1–D7 and S1–S11 (2026-11-18, Rule 00.3). The
planner refined some against the specs and the code; each change is marked
**(refined)** and listed in `plan.md` — *Changes to the coordinator's
decisions*. Record every decision in the spec it belongs to, dated, with
its reason.

### RS1 — Reset spend from the user lists

RS1 was briefed from `temp/coordinator/briefs/litellm_worker-rs1.md` and is
built on `feature/reset-spend-users`. Its decisions are unchanged:

- **D1.** Reset is per team membership (`resetMemberSpend`); no new
  allowlist operation.
- **D2.** A *Reset spend* row action on *LiteLLM users* and on Management →
  Users (linked users). A dialog lists the person's LiteLLM team
  memberships with spend and budget, a confirm per team, and *Reset all
  listed* (one call at a time, a result per team).
- **D3.** Every reset goes through the existing reset-spend route: same
  matrix (Lead in scope, org-admin, admin), audit and ledger. The dialog
  lists only the teams the caller may reset. No new write route; a new read
  is a scoped GET (LD37, route registry).
- **D4.** Shown only when `resetMemberSpend` is enabled and the row has an
  `oid`.
- **D5.** Unlimited budgets can be reset; the dialog says "No budget".
- **D6.** Team page: a LiteLLM member with no app membership shows a muted
  note and, for a caller who may write members, **Add to team**.
- **D7.** Member matching also uses the identity link (`litellmUserId`).

### SYNC1 — Sync LiteLLM users into Management → Users, on demand

- **S1. Trigger and permission.** A **Sync from LiteLLM** action on
  Management → Users. `internal-admin` and `internal-org-admin` only: `403`
  before parsing with one `denied` record. A dashboard-only operation
  `syncLiteLLMUsers`, default **on** (LD10: not destructive), with no
  LiteLLM route of its own, like `requestBudgetReset`.
- **S2. Preview, then apply (refined).**
  - `GET /api/identities/litellm-sync` returns the plan: per LiteLLM user
    one outcome, per person-and-team one membership outcome, the drift
    rows, the counts, `truncated`, and a **`planHash`** (SHA-256 of the
    canonical list of changes).
  - `POST /api/identities/litellm-sync` with `{ planHash }` (strict body)
    recomputes the plan and applies it only when the hash is equal;
    otherwise `409 CONFLICT` and nothing is written. Nothing is stored
    between the two calls.
  - LiteLLM not configured (LD37): the GET returns `200` with
    `configured: false` and makes no LiteLLM call; the POST returns the
    gateway's "not configured" error.
- **S3. Users (refined).** For each LiteLLM user with a valid email:
  - **`link-existing`:** exactly one identity has that email as its
    verified canonical email (trimmed, case-folded, equal — never a
    partial match, a name or a guess) and has no LiteLLM link → the link is
    written with `mode: "sync"`, in one transaction with the one-to-one
    claim and the `identity.litellm-link.set` audit record.
  - **`create-pending`:** no identity has that email → a **pending LiteLLM
    link** keyed by the lower-cased email (new entity
    `PendingLiteLLMLink`, `PENDING#{email}` / `LITELLMLINK`), holding the
    claim so nobody else can take that LiteLLM user. It grants nothing. At
    the person's first sign-in it becomes their link under the **Joiner
    rule** the pending affiliation already uses (tenant matches, the
    lower-cased UPN equals the key, a guest UPN never, no fallback to the
    `email` claim), in one transaction, audited with actor `system` and
    `mode: "sync"`. If that identity already has another LiteLLM link, the
    pending link is removed and nothing is overwritten.
  - **`already-linked`**, **`already-pending`:** nothing to do.
  - **`skip`**, with a reason: `no-email` (missing or not an email),
    `duplicate-email` (two LiteLLM users share it: neither is linked),
    `privileged` (`user_role` is not `internal_user` or
    `internal_user_viewer`), `service-user`, `claimed` (another identity or
    pending link holds this LiteLLM user), `identity-linked-elsewhere` (the
    identity has a different LiteLLM user — reported as a conflict, never
    overwritten), `ambiguous-identity` (two identities share the email),
    `own-identity` (the caller; on demand only).
  - **Never:** a role, a lead, an admin scope, a password user, a
    credential, a setup link.
  - **Each run re-validates the pending links the sync wrote:** one whose
    LiteLLM user is gone, has another email or became privileged is removed
    (audited). An admin or org-admin can remove a pending link by hand
    (`DELETE /api/identities/pending-links`). A pending link not bound
    after 30 days is **stale** and the access review lists it (the
    existing rule for pending items).
- **S4. Teams (refined).** Membership is considered only for an app team
  that has a team link, exists in the team directory, and whose LiteLLM
  team exists (`getTeam` succeeds). A person is a **candidate** for that
  app team when they are in the LiteLLM team's `members_with_roles` and are
  linked or pending after S3. A person has **at most one member team**
  (Access Control — *Member affiliation*), so:
  - no affiliation and **exactly one** candidate team → **member** of it
    (`addMember`; for a pending person, a pending affiliation by email);
  - no affiliation and **two or more** candidate teams → no membership,
    reported as `multiple-teams` (the precedent: two pending affiliations
    for different teams bind neither);
  - an affiliation with another team → not moved, reported as
    `other-team`; an SSO-sourced affiliation is never touched;
  - the caller is never added (`own-identity`);
  - **never lead:** a LiteLLM `admin` team role still gives a member;
  - an unlinked app team, a missing LiteLLM team or an app team unknown to
    the directory gets no membership (`skip`, with the reason);
  - **additive only:** the sync never removes or moves a membership.
    Someone in the app team but not in the LiteLLM team is listed as
    **drift** and left alone.
- **S5. Audit.** One record per change, written by the existing domain
  functions, plus one summary `litellm.user.sync` with the counts, the
  trigger (`manual` or `schedule`), `truncated` and the plan hash. New
  audit actions: `litellm.user.sync`, `identity.litellm-pending.set`,
  `identity.litellm-pending.remove`. The count test changes.
- **S6. Visibility.** Pending links and pending affiliations grant
  nothing. A membership the sync adds gives exactly what a manual add
  gives, under the same visibility and per-user approval rules.
- **S6a. Bounds (planner).** At most **80** `/user/list` pages (2,000
  LiteLLM users) and 2,000 identities per run, and 5 concurrent LiteLLM
  reads (LD34's precedent). Past a bound the run sets `truncated: true`,
  applies what it read (it is additive) and says so in the UI and the
  summary. An on-demand apply writes at most **500 changes** per request
  with 5 concurrent writers and returns `remaining`; the UI offers
  **Continue** (a new preview, a new hash). Reason: the load balancer's
  idle timeout; check its value in the Platform spec and lower the cap if
  the timing test needs it.
- **S6b. One run at a time (from S10).** A lease item `LITELLM#USERSYNC` /
  `LOCK` with an owner run id and `leaseUntil`, taken with a conditional
  write (free, or the lease has passed) and released with a conditional
  delete. Correctness comes from the condition, never from DynamoDB's TTL
  removal, which can be late. A second apply gets `409 CONFLICT`. The
  preview takes no lock.
- **S6c. A failure.** A refused single change (a race: already affiliated,
  claimed) is a result row, and the run goes on. A DynamoDB or LiteLLM
  failure stops the run: changes already written stay (each is audited and
  the next run is idempotent), no summary record is written, and the route
  returns the error.
- **S6d. One domain function, free of the Next runtime.**
  `runLiteLLMUserSync({ actor, trigger, mode: "preview" | "apply", planHash? })`
  lives in `apps/dashboard/lib/litellm-user-sync/` with
  `import "server-only"` and imports nothing from `next/*`. Cache
  revalidation, if any, happens in the route. SYNC2 runs this function
  outside Next; a test asserts the module graph has no `next/*` import.

### SYNC2 — The same sync, scheduled

- **S7. Mechanism (refined).** An EventBridge Scheduler schedule in the
  `DashboardServiceStack` runs one ECS task (`RunTask`) from the dashboard
  task definition, with the container command overridden to
  `node apps/dashboard/jobs/sync-litellm-users.cjs`. The job calls
  `runLiteLLMUserSync({ actor: "system", trigger: "schedule", mode: "apply" })`.
  - The job entry is `apps/dashboard/jobs/sync-litellm-users.ts`, bundled
    into the image at build time (esbuild, a dev dependency; `server-only`
    resolved to an empty module in the bundle only).
  - The task uses the existing task role and receives the LiteLLM service
    key as the same ECS secret the web container gets. **The job reads no
    SSM parameter** (`lib/litellm/structure.test.ts`: no SSM client under
    `apps/`).
  - The scheduler's role may only `ecs:RunTask` that task definition and
    `iam:PassRole` its task and execution roles, to `ecs-tasks` only.
  - No new HTTP endpoint and no in-process timer.
- **S8. Schedule (refined).** CDK input `litellmUserSyncSchedule`,
  **optional, with no default**: absent or `off` creates no schedule
  (the precedent of the other optional inputs; production configuration is
  the user's). The deployment guide recommends `cron(0 18 * * ? *)` —
  18:00 UTC, 04:00 Sydney. A `rate(1 day)` cannot name a time of day. The
  `syncLiteLLMUsers` toggle is read at run time: off → the run writes one
  summary record with `skipped: "disabled"` and exits 0.
- **S9. Scheduled run rules.** It applies directly, under S3–S6c, with no
  caller, so `own-identity` never applies. Each change and the summary are
  audited with actor `system` and `trigger: "schedule"`. A failure exits
  non-zero; a CloudWatch alarm on the task's failure goes to the existing
  alarm topic. The apply cap of 500 does not apply.
- **S10. Overlap.** The S6b lease: a scheduled run that finds it held
  writes a summary with `skipped: "locked"` and exits 0.
- **S11. Cost.** Documented in the Platform spec: EventBridge Scheduler is
  free at this volume; one Fargate task of a minute or two a day is a few
  cents a month. Deploying is the user's action.

### Open for the user (defaults in force)

| # | Question | Default |
|---|---|---|
| Q1 | A LiteLLM user with no dashboard identity appears in Management → Users as **"Not signed in yet"** (a pending link), and becomes a full user at their first sign-in. Is that what "sync to management users" means, or should the sync also create a sign-in for them? | Pending link only; the sync creates no sign-in |
| Q2 | A person in two or more linked LiteLLM teams gets **no** team automatically, because a person has one member team | No membership; listed for an admin to place by hand |
| Q3 | Which environments get the schedule, and at what time | None until `litellmUserSyncSchedule` is set at deploy |

## 4. Units and ownership

One session, in order; each unit starts when the one before it is on
`main`. One branch and one squash commit per unit (Rule 30.4).

| Unit | Branch | Worktree | Starts when | Security review at merge |
|---|---|---|---|---|
| RS1 | `feature/reset-spend-users` | `.claude/worktrees/rs1` | running | no |
| SYNC1 | `feature/litellm-user-sync` | `.claude/worktrees/sync1` | RS1 and INV1 are on `main` | **yes** (changes T-MI1's mitigation) |
| SYNC2 | `feature/litellm-user-sync-schedule` | `.claude/worktrees/sync2` | SYNC1 is on `main` | **yes** (IAM) |

**SYNC1 owns** (new unless marked M):

- `packages/shared/src/schemas/litellm-user-sync.ts` and its test
- `apps/dashboard/lib/litellm-user-sync/**`
- `apps/dashboard/lib/data/access/pending-litellm-links.ts`,
  `apps/dashboard/lib/data/litellm/user-sync-lock.ts`, and their tests
- `apps/dashboard/app/api/identities/litellm-sync/**`,
  `apps/dashboard/app/api/identities/pending-links/**`
- `apps/dashboard/components/manage/users/LiteLLMSyncDialog.tsx`,
  `PendingLinksList.tsx`, and their tests
- `apps/dashboard/e2e/users-litellm-sync.spec.ts`
- M: `apps/dashboard/components/manage/users/UsersPeoplePanel.tsx`,
  `apps/dashboard/app/dashboard/manage/users/page.tsx`, and their tests
  (RS1 edits them too; that is why SYNC1 waits for RS1)
- M: `apps/dashboard/lib/data/access/sign-in-sync.ts` (bind a pending
  link), `identity-links.ts` (mode `sync`, a claim held by a pending
  link), `access-review.ts` and `pending-stale.ts` (pending links in the
  review), and their tests
- M: `packages/shared/src/schemas/user-links.ts` (`LiteLLMLinkModeSchema`
  gains `"sync"`) and its test
- M: `apps/dashboard/lib/litellm/allowlist.ts`,
  `apps/dashboard/components/settings/litellm-panel/operation-families.ts`,
  and the tests that list the operations
  (`allowlist.integration.test.ts`, `operation-settings.integration.test.ts`,
  `operations.integration.test.ts`, `structure.test.ts` — the "only
  operation without a route" case becomes two operations,
  `LiteLLMGuardrailsSection.test.tsx`, `litellm-gateway.test.ts`)

**Shared, append-only** (your own lines only): `packages/shared/src/index.ts`;
`packages/shared/src/schemas/access-control.ts` (three audit actions; the
count in `access-control.test.ts` goes from its value on `main` up by
three); `packages/shared/src/schemas/litellm-gateway.ts`
(`syncLiteLLMUsers`); `apps/dashboard/lib/data/access/keys.ts` and
`lib/data/litellm/keys.ts`; `apps/dashboard/test/route-registry.ts`; the
four spec files; and one sentence each in
`.claude/rules/10-server-only-boundary.md` (10.3) and
`.claude/rules/50-security-and-secrets.md` (50.4) for the two new write
routes.

**SYNC1 does not touch:** `scripts/seed*.ts`, `e2e/support/**`,
`lib/nav.ts`, `auth.ts`, `lib/auth/**` (the e2e case is mocked, so no
shared e2e file changes and no full e2e is needed), `infra/**`.

**SYNC2 owns:** `apps/dashboard/jobs/**`;
`infra/lib/dashboard-service/user-sync-schedule.ts`;
`infra/test/dashboard-service-stack-user-sync.test.ts`; M:
`infra/lib/inputs.ts` and `infra/test/inputs.test.ts` (one input),
`infra/lib/dashboard-service-stack.ts` (wiring),
`infra/lib/dashboard-service/alarms.ts` (one alarm),
`apps/dashboard/Dockerfile` (the bundle step and one `COPY`),
`apps/dashboard/package.json` (the `esbuild` dev dependency and one
script), `pnpm-lock.yaml`; the Platform spec, the deployment and
operations guides, implementation-phases.

**SYNC2 does not touch:** `infra/lib/dashboard-service/task.ts` — the sync
writes only under `PENDING#*`, `IDENT#*`, `LITELLM#*` and `LITELLMUSER#*`.
See §8 for `LITELLMUSER#*`.

## 5. What each unit delivers

**SYNC1**

1. Spec amendments (first commit, `docs:`): `spec-changes.md` — SYNC1.
2. Shared schemas: the preview and apply responses, the outcome and reason
   enums, the pending link.
3. Storage: the pending link (put, get, list, delete, re-validate) with its
   claim; the lease.
4. `runLiteLLMUserSync`: build the plan, hash it, apply it.
5. The sign-in binding of a pending link.
6. Routes: `GET`/`POST /api/identities/litellm-sync`;
   `GET`/`DELETE /api/identities/pending-links`. Registered in
   `test/route-registry.ts`.
7. The operation `syncLiteLLMUsers` and its toggle.
8. UI: **Sync from LiteLLM** on Management → Users (a dialog: the counts,
   the rows by outcome, the skips with reasons, the drift, **Apply**,
   **Continue** when `remaining` > 0, the result); pending people in the
   list as "Not signed in yet" with **Remove**. Shown to admin and
   org-admin only; absent when the toggle is off.
9. The access review lists pending links and flags stale ones.

**SYNC2**

1. Spec amendments (first commit): `spec-changes.md` — SYNC2.
2. The job entry and its bundle step in the image.
3. The schedule, its role, the alarm, the input.
4. The deployment and operations guides: the input, the cost, how to run
   the job once by hand, what the alarm means.

## 6. Tests — first (Rule 70)

Tests are written before the code, from the spec lines `spec-changes.md`
adds. Every test cites its line or threat item. One layer per behaviour.

| Threat or rule | Test (layer) |
|---|---|
| T-SY1 (T-MI1): no link without an exact email match | Domain, integration: a different case links; a prefix, a suffix, another domain and a display-name match do not; `duplicate-email` and `ambiguous-identity` skip both sides |
| T-SY1: privileged and service-user targets | Domain: `proxy_admin`, `proxy_admin_viewer`, an unknown role and the service user are `skip` with no link, no pending link and no claim |
| T-SY1: one-to-one | Domain: a claimed LiteLLM user is `claimed`; an identity with another link is `identity-linked-elsewhere`; neither is overwritten |
| T-SY2: no privilege | Domain: no role grant, no admin scope, no lead for a LiteLLM team `admin`; a structure test: the sync modules import no role-grant, admin-scope or password-user write |
| T-SY3: teams | Domain: an unlinked team, a missing LiteLLM team, an app team unknown to the directory → no membership; two candidate teams → `multiple-teams`; an affiliation elsewhere → `other-team`, not moved; SSO-sourced untouched; nothing is ever removed |
| T-SY4: no self-benefit | Route: the caller's own identity is `own-identity` for the link and for the membership |
| T-SY5: stale or repeated apply | Route: another `planHash` → `409`, nothing written; the lease held → `409`; two applies at once → one wins |
| T-SY6: the pending link binds only to its owner | Sign-in, integration: binds on the UPN rule; not for a guest UPN, another tenant or a matching `email` claim alone; an identity with another link keeps it and the pending link is removed; a pending link whose LiteLLM user became privileged is removed by the next run |
| T-SY7: bounds | Domain: three pages are read; page 81 is not, and `truncated` is true; LiteLLM unavailable → an error and no write |
| T-SY9: who may read and write | Route: lead, user and auditor `403` on the sync routes; auditor may read the pending list; `401`; `no-store`. The shared route-contract suite covers the contract through the registry |
| S2, LD37 | Route: not configured → `200`, `configured: false`, no LiteLLM call |
| S5 | Domain: one audit record per change and one summary with the counts |
| UI | Component: the action is absent for a lead and with the toggle off; the dialog shows counts, skips and drift; **Continue** appears with `remaining`. E2E, mocked: preview, apply, the result counts; axe at 375 with the dialog open |
| T-SY8 (SYNC2) | CDK: the schedule and its `RunTask` target; the role's two statements and nothing else; `iam:PassRole` limited to the two roles and `ecs-tasks`; no schedule when the input is absent or `off`; the alarm on the topic. Job, unit: toggle off → skip, exit 0; lease held → skip, exit 0; a failure → non-zero. Job, integration: the **bundled** entry runs against DynamoDB Local and the fake LiteLLM |

The e2e budget (Rule 70.12): SYNC1 runs its one new spec and `users.spec.ts`
once at the gate, normally and with `CI=1`. SYNC2 has no e2e.

## 7. Orchestration

Each unit runs as the workflow in
`temp/planner/litellm-user-sync/workflow-litellm_worker.md`, after the
user's opt-in in the `litellm_worker` session. Agents come from the shared
pool of 80 running at once; this plan needs at most **4** at a time.
`tdd-test-engineer` and `typescript-developer` on sonnet; gate runs on
haiku. The worker runs no review agent.

Usage tiers apply (`.claude/prompts/coordinator_prompt.md` §3): 5-hour caution
60 %, freeze 75 %; weekly caution 85 %, freeze 95 %.

## 8. Guards and out of scope

- Never weaken T-MI1, a permission, a toggle default or a test. A choice
  that would is the user's; send `blocked`.
- No new LiteLLM allowlist route. The sync uses `searchUsers` and
  `getTeam` only, and writes nothing to LiteLLM.
- No deploy, no `cdk deploy`, no real AWS account ID in any file
  (`000000000000`), no secret in a log, a test or the task's command.
- If the bundled job cannot run outside Next, send `blocked`. Do not add
  an HTTP endpoint or a timer instead (S7).
- **Found while planning, not part of these units:** on `main` the task
  role's write keys (`infra/lib/dashboard-service/task.ts`,
  `WRITE_LEADING_KEYS`) do not include `APPTEAM#*`, `APPTEAMNAME#*`,
  `LITELLMUSER#*`, `NOTIF#*`, `BRESET#*` or the budget-request keys that
  M2–M4 write. A deployed dashboard would be refused those writes. SYNC1
  writes the `LITELLMUSER#*` claim. The coordinator has been told; the fix
  is its own unit and must be on `main` before SYNC2 is deployed.
- Out of scope: removing or moving members, syncing roles or budgets,
  writing to LiteLLM, any sync from the dashboard to LiteLLM.

## 9. Handover

As `.claude/prompts/worker_prompt.md` §7. The handover of SYNC1 and SYNC2 always
includes the security surface: each new route and who may call it, each
new entity and who can read it, each T-SY item with its guard
(`file:line`) and its test, and for SYNC2 the synthesised IAM statements.

## 10. Completion criteria

A unit is complete when:

1. Its spec amendments are on the branch and say what the code does.
2. Every row of §6 for the unit has a passing test that cites its source.
3. The branch gate is green at the final commit with `main` merged in
   (`.claude/prompts/worker_prompt.md` §6), and for SYNC2 `pnpm test:infra` and
   `pnpm --filter @llm-usage-lens/infra synth` with the example context.
4. Decisions are in the specs; only built boxes are ticked.
5. The handover and the report are written, and `ready to merge` was sent.

`/goal` line, one unit per run:

```
/goal docs/plans/litellm_user_sync.md §10 completion criteria met for unit <RS1|SYNC1|SYNC2>, reported ready to merge, and the report written — or the run ended by a usage freeze or a missing dependency, with the report written.
```
