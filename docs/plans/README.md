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

Run plans, named `<YYYYMMDD>_<slug>.md` by the date each was first written (user, 2026-11-18), so the newest sorts last:

| File | Purpose |
|---|---|
| `20261103_master.md` | Run discipline (timing, usage guard, agents, git rules, report) and the core phase plan (Phases 4.9 and 5, including the two Phase 5 workstreams the user added on 2026-11-11) |
| `shared-contracts.md` | Defined once and used by both feature plans: environments, roles, identity and usage-key format, audit log, combined Bedrock + LiteLLM totals, governance, platform (ECS, CDK), operations, the finance statement |
| `20261109_rbac.md` | Role-based access from Entra ID (global `internal-admin`, `internal-org-admin`, `internal-auditor`, `internal-viewer`; scoped `internal-team-admin`; the legacy `Admin` alias only outside `APP_ENV=prod`), SSO group mapping, single-team affiliation and admin scopes, visibility and inheritance, the master user, password users and the pre-SSO mode, the audit log, plus the platform unit |
| `20261109_litellm.md` | LiteLLM team and user administration through an allowlist gateway and a scoped service key in SSM, budgets, rate limits, keys, combined usage, self-service keys, the monthly statement. Its permissions follow the role model in `20261109_rbac.md` §1.1 |
| `20261118_litellm_user_sync.md` | Units RS1, SYNC1 and SYNC2 (user, 2026-11-18): Reset spend from the LiteLLM users tab and the Users page; LiteLLM users synced into Management → Users on demand and on a schedule, with team membership only through linked LiteLLM teams that exist (supersedes Access Control D27 "never automatic"; T-MI1 stays) |
| `20261118_teams_users_and_litellm_sync.md` | Teams, users and LiteLLM sync (management round 2 (user, 2026-11-18): it combines the LiteLLM user sync units with 17 new items in six units (LF1 LiteLLM page fixes, ST1 settings and small UX, TM1 team list then team, US1 users table with API sort, US2 user page, SRT1 sort in other tables), in three waves; runs at the weekly usage reset) |

## How runs save tokens (Rule 70.12, decided 2026-11-14)

- **One review per phase**, when it is green, before it lands on `main`.
  Required security passes (4R.3, 4R.4, L1, L2, L4) are part of that review.
  Re-reviews after REQUEST CHANGES cover only the fixes.
- **Branches run only new and impacted tests**:
  `pnpm exec vitest run --changed $(git merge-base main HEAD)` plus
  typecheck, lint and format. The **full suite runs once, on the `main`
  candidate** (the branch with `main` merged in, just before it lands), and
  CI repeats it on your push.
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
| 8 | **R4** management UI and writes | `20261109_rbac.md` | ready | Settings for members, admin scopes, group mappings, role grants, password users, identity links and mapping rules, visibility and caps, the per-user approval; audit log view; access review export |
| 9 | **R5** UI gating | `20261109_rbac.md` | | Scoped navigation; role-aware landing (*My usage*, *My teams*) |
| 10 | **L1** connection | `20261109_litellm.md` | done (`c82fb1e`) | Service key from SSM via ECS secrets, host allowlist, connection test, edition by env, the Settings → LiteLLM panel |
| 11 | **L2** gateway | `20261109_litellm.md` | ready (may run parallel with R4) | The typed allowlist gateway, operation toggles, team links, `litellm-changed-by` |
| 12 | **L3** read views | `20261109_litellm.md` | needs R3 | The LiteLLM page: spend, budgets, members, keys, model access, limits, LiteLLM audit view |
| 13 | **L4** writes | `20261109_litellm.md` | needs R3 and R4 | Members (incl. remove), budgets, rate limits, keys, model access, enable and disable |
| 14 | **L5** polish | `20261109_litellm.md` | | Accessibility, responsive layout, runbook, full role × operation matrix |
| 15 | **L6** combined usage | `20261109_litellm.md` | | Bedrock + LiteLLM totals without double counting; *My usage* completed |
| 16 | **L7** self-service keys | `20261109_litellm.md` | | Request, Lead approval, reveal once |
| 17 | **L8** monthly statement | `20261109_litellm.md` | | Finance CSV per department and team |
| 18 | **Phase 5** polish and accessibility | `20261103_master.md` | UI refresh done (`85609ea`) | Full accessibility audit (includes the focus-ring token), responsive checks, e2e journeys, and the periodic read-only **security and best-practices review** (HIGH findings block the next unit) |

**Parallel allowances** (user direction, recorded in Rule 30 and
implementation-phases): L1 and L2 may run alongside R3–R5; L3 waits for R3;
L4 waits for R3 and R4. Phase 4.9b (tag coverage) is deferred and does not
block Phase 5. Phase 6 (the collector) stays last; it adopts the canonical
usage key, the effective-dated Sydney price table, and decides whether Cost
Explorer access is allowed by company policy.

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
