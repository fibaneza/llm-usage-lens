# Plans — guarded improvement runs

The LLM Usage Lens is built through **guarded 60-minute runs**. Each
run delivers **one unit**: it writes the failing tests, makes them pass, gets
one Rule 70 review for the phase, gates, lands on local `main`, and writes a
report in `temp/`. You push.

Runs can go **one at a time** in a single session, or **in parallel** in
worker sessions under a coordinator session (see *Parallel runs* below).

**Two folders (user, 2026-11-18).** This folder holds the **run plans**: one per goal, which the
planner writes here as `docs/plans/<YYYYMMDD>_<slug>.md` (renamed from `prompts/*_prompt.md`). The standing **role prompts**
(coordinator, planner, worker) and the sessions runbook live in [`.claude/prompts/`](../../.claude/prompts/):

| Role prompt | Purpose |
|---|---|
| `.claude/prompts/coordinator_prompt.md` | How one session coordinates the worker sessions that run the goals above: briefs, file ownership and conflict prevention, milestones, the shared usage freeze, **every merge into `main`** (full tests on the `main` candidate, fix agents, clean-up), and the live state in `temp/coordinator/` that survives a context reset |
| `.claude/prompts/planner_prompt.md` | The planner session: it writes plans, spec text and prompts and never executes them (user, 2026-11-18); it reaches the coordinator only through the file relay in `temp/coordinator/` (coordinator prompt §2b). Start sheet: [`docs/guides/planner-session.md`](../guides/planner-session.md) |
| `.claude/prompts/worker_prompt.md` | The role prompt for every worker session (`improvements_worker`, `bedrock_worker`, `litellm_worker`): run the unit the coordinator's brief assigns, in its worktree, stop at "ready to merge". The unit's own prompt says what to build. Roles overview: [`docs/guides/session-roles.md`](../guides/session-roles.md) |
| `.claude/prompts/README-sessions.md` | How to run the planner, coordinator and worker sessions: set up, start lines, a piece of work step by step, the relay, clearing or replacing a session, stopping, troubleshooting |

Run plans, named `<YYYYMMDD>_<slug>.md` by the date each was first written (user, 2026-11-18), so the newest sorts last. A plan is **removed once all its units are on `main`** (user, 2026-11-18: delete the plans that are no longer needed): the specs, the phase plan and `git log` are the record.

| File | Purpose | Status (2026-11-18) |
|---|---|---|
| `20261103_master.md` | Run discipline (timing, usage guard, agents, git rules, report) and the core phase plan (Phases 4.9 and 5, including the two Phase 5 workstreams the user added on 2026-11-11) | In use: the run discipline; Phase 5 is open |
| `shared-contracts.md` | Defined once and used by both feature plans: environments, roles, identity and usage-key format, audit log, combined Bedrock + LiteLLM totals, governance, platform (ECS, CDK), operations, the finance statement | In use: reference |
| `20261109_rbac.md` | Role-based access from Entra ID (global `internal-admin`, `internal-org-admin`, `internal-auditor`, `internal-viewer`; scoped `internal-team-admin`; the legacy `Admin` alias only outside `APP_ENV=prod`), SSO group mapping, single-team affiliation and admin scopes, visibility and inheritance, the master user, password users and the pre-SSO mode, the audit log, plus the platform unit | Units R0–R5 and RP are on `main`. Kept: other plans, the role prompts and a test cite its role model (§1.1) |
| `20261109_litellm.md` | LiteLLM team and user administration through an allowlist gateway and a scoped service key in SSM, budgets, rate limits, keys, combined usage, self-service keys, the monthly statement. Its permissions follow the role model in `20261109_rbac.md` §1.1 | L0–L6 are on `main`; **L7 and L8 are open** |
| `20261117_litellm_role_views.md` | L3b views by role, L3c dev identity login, the Settings admin area and the LiteLLM component overlap | L3b and L3c are on `main`; the Settings admin area and the overlap unit are **to confirm**, then remove |
| `20261117_ui_refresh.md` | The compact workspace (Phase 5 UI refresh) and the test consolidation | Slices A, B1, B2 and B2b and the test consolidation are on `main`; the rest of Slice B is **to confirm** against implementation-phases — *Phase 5*, then remove |
| `20261118_litellm_user_sync.md` | Units RS1, SYNC1 and SYNC2 (user, 2026-11-18): Reset spend from the LiteLLM users tab and the Users page; LiteLLM users synced into Management → Users on demand and on a schedule, with team membership only through linked LiteLLM teams that exist (supersedes Access Control D27 "never automatic"; T-MI1 stays) | RS1 is on `main`. SYNC1 and SYNC2 are queued; a revision of 2026-11-18 (units LW1 and INV2, automatic links, the two sign-in modes) is with the coordinator to fold in |
| `20261118_teams_users_and_litellm_sync.md` | Teams, users and LiteLLM sync (management round 2; user, 2026-11-18): it combines the LiteLLM user sync units with the user's new items in seven units (LF1 LiteLLM page fixes, ST1 settings and small UX, TM1 team list then team, US1 users table with API sort, US2 user page, SRT1 sort in other tables, RS2 reset any LiteLLM user), in three waves | **Next to run**, at the weekly usage reset (2026-11-23) |

Removed on 2026-11-18, all units on `main`: the POC plan (`poc/` is built),
the app config file plan (unit CFG, `5484f12`), the base path plan (unit BP,
`ae9c4c9`) and the management improvements plan (units M0–M5).

## How runs save tokens (Rule 70.12, decided 2026-11-14)

- **One review per phase**, when it is green, before it lands on `main`.
  Required security passes (4R.3, 4R.4, L1, L2, L4) are part of that review.
  Re-reviews after REQUEST CHANGES cover only the fixes.
- **Branches run only new and impacted tests**:
  `pnpm exec vitest run --changed $(git merge-base main HEAD)` plus
  typecheck, lint, format and the two structure suites. **The full suite
  runs in CI** on your push (amended 2026-11-15; Rule 70.12).
- **Results, not logs**: runs read exit codes and count lines only.
- Models are set explicitly: sonnet for tests and code, opus for reviews,
  haiku for gate re-runs.

## Run order

One unit per run. A run takes the **first unit not done** in its plan.
Spec units come before code.

| # | Unit | Plan | Status | What it delivers |
|---|---|---|---|---|
| 1 | **Phase 4.9** Settings | `20261103_master.md` | done | The Settings page (accounts CRUD, sync status, data retention display; tag coverage is the deferred Phase 4.9b) |
| 2 | **R0** spec | `20261109_rbac.md` | done (`ccd8e72`) | Spec amendments (Access Control and Platform specs) and every decision in `shared-contracts.md`; threat model |
| 3 | **L0** spec | `20261109_litellm.md` | done (`1733671`, `e9e8fa4`) | The LiteLLM spec, the OpenAPI snapshot in `docs/litellm/`, the allowlist table, the confirmed version and Enterprise SSO user id |
| 4 | **RP** platform | `20261109_rbac.md` | done (`3d3b0bf`) | `infra/` CDK: FoundationStack and DashboardServiceStack on ECS Fargate, ALB import or create, `GET /api/health`, alarms, CI deploy role. Synthesised, never deployed |
| 5 | **R1** identity, roles and sign-in | `20261109_rbac.md` | done (`23bac5b`) | The role model, `oid`/`tid`, the identity record, session caps (8 h / 4 h / 1 h), the master user (Argon2id, TOTP in `prod`, lockout), dev login, the no-access page, `APP_ENV`, `AUTH_ACCESS_MODE` |
| 6 | **R2** authorization data | `20261109_rbac.md` | done (`d7aa182`, `79bd4dc`, `7a50f5a`) | Split into R2a (access data layer and audit), R2b (sign-in resolution, password users and SSO binding) and R2c (pre-SSO platform, data isolation). The storage boundary, the audit log with `denied` records, password users with setup links and TOTP, the task-role policy, table and key policies |
| 7 | **R3** server-side scoping | `20261109_rbac.md` | done (`b88c2cb`) | The policy module (`resolveScope`, `can`); every route filtered; `/api/me`; leak tests |
| 8 | **R4** management UI and writes | `20261109_rbac.md` | done (`aa36636`, `718c0e0`) | Settings for members, admin scopes, group mappings, role grants, password users, identity links and mapping rules, visibility and caps, the per-user approval; audit log view; access review export |
| 9 | **R5** UI gating | `20261109_rbac.md` | done (`308eec3`)
| 10 | **L1** connection | `20261109_litellm.md` | done (`c82fb1e`) | Service key from SSM via ECS secrets, host allowlist, connection test, edition by env, the Settings → LiteLLM panel |
| 11 | **L2** gateway | `20261109_litellm.md` | done (`9813100`, `d86b935`) | The typed allowlist gateway, operation toggles, team links, `litellm-changed-by` |
| 12 | **L3** read views | `20261109_litellm.md` | done (`4889fcd`); L3b `6d0bf13`, L3c `cb43e0f`, L3d `00e3093` | The LiteLLM page: spend, budgets, members, keys, model access, limits, LiteLLM audit view |
| 13 | **L4** writes | `20261109_litellm.md` | done (`379365b`); L4b app-team spend `e76e2e5` | Members (incl. remove), budgets, rate limits, keys, model access, enable and disable |
| 14 | **L5** polish | `20261109_litellm.md` | done (`dd80e93`)
| 15 | **L6** combined usage | `20261109_litellm.md` | done (`7562f29`)
| 16 | **L7** self-service keys | `20261109_litellm.md` | **open**
| 17 | **L8** monthly statement | `20261109_litellm.md` | **open**
| 18 | **CFG** app config file | removed | done (`5484f12`) | The dashboard configured from `config/config.yaml`, which wins over database configuration |
| 19 | **BP** base path | removed | done (`ae9c4c9`) | Every app URL under an optional prefix (`/llm-lens`) |
| 20 | **M0–M5** management improvements | removed | done (`7313ca6`, `e0d9b03`, `abfe8e3`, `1c08319`, `50f51c6`, `5b1766b`) | Management navigation and the LiteLLM area, app teams, users and LiteLLM user links, budget reset requests, usage source panels |
| 21 | **RS1**, **INV1** | `20261118_litellm_user_sync.md` (RS1) | done (`38c2e93`, `0105002`) | Reset spend from the LiteLLM users tab and the Users page; accept a pending team invite |
| 22 | **Round 2, wave 1:** LF1, LW1, RS2, ST1, TM1 | `20261118_teams_users_and_litellm_sync.md`, `20261118_litellm_user_sync.md` (LW1) | **next**, at the weekly usage reset (2026-11-23) | LiteLLM page fixes; "create and link" only when SSO is not enabled; reset any LiteLLM user, linked or not; settings and small UX; the team list, then the team |
| 23 | **Round 2, wave 2:** SYNC1, US1, US2 | the same two plans | after wave 1 | LiteLLM users synced on demand with automatic links; the users table with API sort; the user page |
| 24 | **Round 2, wave 3:** SYNC2, SRT1, INV2 | the same two plans | after wave 2 | The scheduled sync; sorting in the other tables; invite, add to team, approve and add |
| 25 | **Phase 5** polish and accessibility | `20261103_master.md` | fluid workspace done (`85609ea`); compact workspace slices A, B1, B2, B2b on `main`; **the rest is open** | Full accessibility audit (includes the focus-ring token), responsive checks, e2e journeys, and the periodic read-only **security and best-practices review** (HIGH findings block the next unit) |

**Parallel allowances** (user direction, recorded in Rule 30 and
implementation-phases): the management units and round 2 run before L7,
L8 and the rest of Phase 5. Round 2 runs in three worker sessions, one
wave at a time (the wave table is in
`20261118_teams_users_and_litellm_sync.md` §4). Phase 4.9b (tag coverage)
is deferred and does not block Phase 5. Phase 6 (the collector) stays
last; it adopts the canonical usage key, the effective-dated Sydney price
table, decides whether Cost Explorer access is allowed by company policy,
and gets the Settings → Sync **Refresh now** button (user, 2026-11-18).

## How to start a run (one session)

1. Make sure `main` is clean, and push the previous run's commits if you
   want CI.
2. Check usage (`20261103_master.md` §2). In the **caution** tier (5-hour
   window at or above 60%, or weekly at or above 85%) the run uses at most 2
   agents and skips optional work. In the **freeze** tier (5-hour at or above
   75%, weekly at or above 95%, or the spend limit at or above 85%) the run
   starts no agent and only writes a report. Wait for the reset. Implementation
   freezes at T+55 and the report is due at T+60.
3. Start the run with `/goal` and the **exact condition** below, never the
   bare file path. A bare path makes the goal check loop, because one run can
   never finish every unit.

| Plan | `/goal` condition |
|---|---|
| `20261103_master.md` | `docs/plans/20261103_master.md §12 completion criteria met for this run's target, and the report written — or the run ended by a usage freeze, the T+60 deadline, or a missing dependency, with the report written.` |
| `20261109_rbac.md` | `docs/plans/20261109_rbac.md §6 completion criteria met for this run's target unit, and the report written — or the run ended by a usage freeze or the T+60 deadline with the report written.` |
| `20261109_litellm.md` | `docs/plans/20261109_litellm.md §6 completion criteria met for this run's target unit, and the report written — or the run ended by a usage freeze, the T+60 deadline, or a missing dependency, with the report written.` |
| `20261118_litellm_user_sync.md` | `docs/plans/20261118_litellm_user_sync.md §10 completion criteria met for unit <RS1\|SYNC1\|SYNC2>, reported ready to merge, and the report written — or the run ended by a usage freeze or a missing dependency, with the report written.` |
| `20261118_teams_users_and_litellm_sync.md` | `docs/plans/20261118_teams_users_and_litellm_sync.md §8 completion criteria met for unit <LF1\|ST1\|TM1\|US1\|US2\|SRT1\|RS2>, reported ready to merge, and the report written — or the run ended by a usage freeze or a missing dependency, with the report written.` |

Send the instruction first (for example "Run docs/plans/20261109_rbac.md for unit
R3 in this worktree…", mentioning the plan with `@docs/plans/20261109_rbac.md`),
then the `/goal` line as a second message.

4. After the run, read the report in `temp/`: §8 lists your actions (push,
   CI, decisions). Make any decisions it asks for before the next run.

## Parallel runs (coordinator and workers)

Several sessions can run at once: a planner (plans only), one coordinator,
and worker sessions (`improvements_worker`, `bedrock_worker`, `litellm_worker`). How to
start, resume, clear and stop each one is in
[`.claude/prompts/README-sessions.md`](../../.claude/prompts/README-sessions.md); the reference is
[`docs/guides/session-roles.md`](../guides/session-roles.md). A worker
runs 2 agents for a goal with no plan, and its allocation from the shared pool for a
plan unit (80 agents running at once, summed across all sessions and
distributed dynamically by the coordinator). Workers
stop at "ready to merge"; the coordinator lands every unit, and the user
pushes.

## Your inputs, collected early

The units ask for these as they need them, but they can be gathered up
front:
- **Entra** (when SSO is approved; until then `prod` runs in pre-SSO mode
  with the master user and password users): app roles (`internal-admin`,
  `internal-org-admin`, `internal-auditor`, `internal-viewer`) and the
  assigned-groups `groups` claim on both app registrations (dev and prod);
  security groups assigned to them; "Assignment required" on; Conditional
  Access (MFA or compliant device); the real Entra group object IDs for the
  group mappings (never committed).
- **Master user:** an Argon2id password hash and a TOTP secret, stored by
  hand as SSM SecureStrings and sealed with two people; the GitHub repository
  variable `MASTER_USERNAME` for the deploy workflow.
- **AWS:**
  - the VPC and private subnet ids
  - the ACM certificate ARN
  - either the LiteLLM ALB HTTPS listener ARN plus an agreed rule priority,
    or the company CIDRs for a new internal ALB
  - the internal DNS name
  - an existing SNS topic ARN for alarms
  - the break-glass IAM Identity Center permission set role (`opsRoleArn`,
    recommended in `prod`) and CloudTrail data events on the table
  - optionally an existing DynamoDB gateway endpoint (`dynamodbVpcEndpointId`)
  - the region is fixed: `ap-southeast-2` (Cost Explorer stays on `us-east-1`)
  - **open:** whether company policy allows the Cost Explorer role in the
    management account (ask before Phase 6)
- **LiteLLM:**
  - the company runs **1.109.1** (checked 2026-11-14); dev uses a local
    LiteLLM at `http://localhost:4000` with a Management service key kept
    only in `apps/dashboard/.env.local`
  - for deployed environments: the service user and **service key** with
    `allowed_routes` from the LiteLLM spec, stored by hand in SSM under
    `/llm-usage-lens/<env>/litellm/service-key`, and the allowed hosts
    (`litellmAllowedHosts` CDK input)
  - LiteLLM audit logging on (`litellm_settings.store_audit_logs: true`)
  - the endpoint behind LiteLLM's team join link, if invitations should use
    it (not in the contract yet)
  - the **gateway principals** LiteLLM uses to call Bedrock
- **Governance:** the works-council or data-protection approval, before
  per-user views in `prod`; the privacy wording (D6). Audit retention is
  confirmed at 400 days.
