# Prompts — guarded improvement runs

The LLM Usage Lens is built through **guarded 60-minute runs**. Each
run delivers **one unit**: it writes the failing tests, makes them pass, gets
the Rule 70 reviews, gates, squash-merges into local `main`, and writes a
report in `temp/`. You push.

| File | Purpose |
|---|---|
| `master_prompt.md` | Run discipline (timing, usage guard, agents, git rules, report) and the core phase plan (Phases 4.9 and 5, including the two Phase 5 workstreams the user added on 2026-11-11) |
| `shared-contracts.md` | Defined once and used by both feature prompts: environments, roles, identity and usage-key format, audit log, combined Bedrock + LiteLLM totals, governance, platform (ECS, CDK), operations, the finance statement |
| `rbac_prompt.md` | Role-based access from Entra ID (global `internal-admin`, `internal-org-admin`, `internal-auditor`, `internal-viewer`; scoped `internal-team-admin`; the legacy `Admin` alias only outside `APP_ENV=prod`), SSO group mapping, single-team affiliation and admin scopes, visibility and inheritance, the master user, dev-only local login, the audit log, plus the platform unit |
| `litellm_prompt.md` | LiteLLM team and user administration through an allowlist gateway and a scoped service key in SSM, budgets, rate limits, keys, combined usage, self-service keys, the monthly statement. Its permissions follow the role model in `rbac_prompt.md` §1.1 |

## Run order

One unit per run. A run takes the **first unit not done** in its prompt.
Spec units come before code.

| # | Unit | Prompt | Status | What it delivers |
|---|---|---|---|---|
| 1 | **Phase 4.9** Settings | `master_prompt.md` | done | The Settings page (accounts CRUD, sync status, data retention display; tag coverage is the deferred Phase 4.9b) |
| 2 | **R0** spec | `rbac_prompt.md` | done (`ccd8e72`) | Spec amendments (Access Control and Platform specs) and every decision in `shared-contracts.md`; threat model |
| 3 | **L0** spec | `litellm_prompt.md` | done (`1733671`, `e9e8fa4`) | The LiteLLM spec, the OpenAPI snapshot in `docs/litellm/`, the allowlist table, the confirmed version and Enterprise SSO user id |
| 4 | **RP** platform | `rbac_prompt.md` | done (`3d3b0bf`) | `infra/` CDK: InfraStack and AppStack on ECS Fargate, ALB import or create, `GET /api/health`, alarms, CI deploy role. Synthesised, never deployed |
| 5 | **R1** identity, roles and sign-in | `rbac_prompt.md` | done (`23bac5b`) | The role model (global and scoped, default `internal-viewer`, legacy `Admin` alias), `oid`/`tid`, the identity record, session caps (8 h / 4 h / 1 h), the master user (Argon2id, TOTP in `prod`, lockout), dev login, the no-access page, `APP_ENV`, `AUTH_ACCESS_MODE`. The persistent audit record for master-user events, stored local users and `/api/local-users` moved to R2 and R4 |
| 6 | **R2** authorization data | `rbac_prompt.md` | **next** | Affiliations (pending, bound), admin scopes, in-app role grants, group mappings and sign-in resolution, visibility and caps, local users (data), identity links, the canonical usage identity, versioned writes, the audit log (DynamoDB and CloudWatch group, alarm, `auth.master.*`, `auth.signin.error`), the task-role DynamoDB policy |
| 7 | **R3** server-side scoping | `rbac_prompt.md` | | The policy module (`resolveScope`, `can`); every route filtered; leak tests |
| 8 | **R4** management UI and writes | `rbac_prompt.md` | | Settings for members, admin scopes, group mappings, role grants, local users, identity links, visibility and caps, the per-user approval; audit log view; access review export |
| 9 | **R5** UI gating | `rbac_prompt.md` | | Scoped navigation; role-aware landing (*My usage*, *My teams*) |
| 10 | **L1** connection | `litellm_prompt.md` | | Service key from SSM via ECS secrets, host allowlist, connection test, edition by env |
| 11 | **L2** gateway | `litellm_prompt.md` | | The typed allowlist gateway, operation toggles, team links |
| 12 | **L3** read views | `litellm_prompt.md` | | The LiteLLM page: spend, budgets, members, keys, model access, limits |
| 13 | **L4** writes | `litellm_prompt.md` | | Members, budgets, rate limits, keys, model access, enable and disable |
| 14 | **L5** polish | `litellm_prompt.md` | | Accessibility, responsive layout, runbook, full role × operation matrix |
| 15 | **L6** combined usage | `litellm_prompt.md` | | Bedrock + LiteLLM totals without double counting; *My usage* completed |
| 16 | **L7** self-service keys | `litellm_prompt.md` | | Request, Lead approval, reveal once |
| 17 | **L8** monthly statement | `litellm_prompt.md` | | Finance CSV per department and team |
| 18 | **Phase 5** polish and accessibility | `master_prompt.md` | | Full accessibility audit (includes the focus-ring token), responsive checks, e2e journeys. Also two workstreams the user started on 2026-11-11 (user direction), each beginning with a spec amendment: the **UI refresh** (fluid full-width workspace layout, denser Grafana-style panel grid, LiteLLM-style grouped sidebar, role and sign-in method in the user menu; light mode stays the default) and a periodic read-only **security and best-practices review** (HIGH findings block the next unit) |

L0 ran early and R1 ran before R2, as the plan allows. The next run takes
**R2**. Phase 4.9b (tag coverage) is deferred and does not block Phase 5.

Phase 6 (the collector) stays last. It also adopts the canonical usage key
(`shared-contracts.md` §3.1) and, if R0 records it, the move to the
CollectorStack in CDK.

## How to start a run

1. Make sure `main` is clean, and push the previous run's commits if you
   want CI.
2. Check usage (`master_prompt.md` §2). In the **caution** tier (5-hour
   window at or above 60%, or weekly at or above 75%) the run uses at most 2
   agents and skips optional work. In the **freeze** tier (5-hour at or above
   75%, weekly at or above 85%, or the spend limit at or above 85%) the run
   starts no agent and only writes a report. Wait for the reset. Implementation
   freezes at T+55 and the report is due at T+60.
3. Start the run with `/goal` and the **exact condition** below, never the
   bare file path. A bare path makes the goal check loop, because one run can
   never finish every unit.

| Prompt | `/goal` condition |
|---|---|
| `master_prompt.md` | `prompts/master_prompt.md §12 completion criteria met for this run's target, and the report written — or the run ended by a usage freeze, the T+60 deadline, or a missing dependency, with the report written.` |
| `rbac_prompt.md` | `prompts/rbac_prompt.md §6 completion criteria met for this run's target unit, and the report written — or the run ended by a usage freeze or the T+60 deadline with the report written.` |
| `litellm_prompt.md` | `prompts/litellm_prompt.md §6 completion criteria met for this run's target unit, and the report written — or the run ended by a usage freeze, the T+60 deadline, or a missing dependency, with the report written.` |

For example, for unit 6 (R2):

```
/goal prompts/rbac_prompt.md §6 completion criteria met for this run's target unit, and the report written — or the run ended by a usage freeze or the T+60 deadline with the report written.
```

Then tell Claude to follow `prompts/rbac_prompt.md`. Mention it with
`@prompts/rbac_prompt.md` in the same message.

4. After the run, read `temp/report_YYMMDD.md`: §8 lists your actions (push,
   CI, decisions). Make any decisions it asks for before the next run.

## Your inputs, collected early

The units ask for these as they need them, but they can be gathered up
front:
- **Entra:** app roles (`internal-admin`, `internal-org-admin`, `internal-auditor`, `internal-viewer`) and the assigned-groups `groups` claim on both app
  registrations (dev and prod); security groups assigned to them;
  "Assignment required" on; Conditional Access (MFA or compliant device).
  The **master user** credentials (an Argon2id password hash and a TOTP
  secret, stored by hand as SSM SecureStrings and sealed with two people),
  and the real Entra group object IDs for the group mappings (never
  committed).
- **AWS:**
  - the VPC and private subnet ids
  - the ACM certificate ARN
  - either the LiteLLM ALB HTTPS listener ARN plus an agreed rule priority,
    or the company CIDRs for a new internal ALB
  - the internal DNS name
  - an existing SNS topic ARN for alarms
  - the region is fixed: `ap-southeast-2` (Cost Explorer stays on `us-east-1`)
- **LiteLLM:**
  - the exact deployed LiteLLM version string for the runbook (the version
    is confirmed as the latest release, above the 1.104.0 floor, and the
    Enterprise SSO `user_id` is confirmed as the email, both on 2026-11-10)
  - the service user and **service key** with `allowed_routes` from the L0
    table, stored by hand in SSM under `/llm-usage-lens/<env>/litellm/service-key`
  - the internal hostname
  - the **gateway principals** LiteLLM uses to call Bedrock
- **Governance:** the works-council or data-protection approval, before
  per-user views in `prod`; audit retention.
