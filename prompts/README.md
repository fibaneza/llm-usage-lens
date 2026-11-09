# Prompts — guarded improvement runs

The Bedrock Cost Dashboard is built through **guarded 60-minute runs**. Each
run delivers **one unit**: it writes the failing tests, makes them pass, gets
the Rule 70 reviews, gates, squash-merges into local `main`, and writes a
report in `temp/`. You push.

| File | Purpose |
|---|---|
| `master_prompt.md` | Run discipline (timing, usage guard, agents, git rules, report) and the core phase plan (Phases 4.9 and 5) |
| `shared-contracts.md` | Defined once and used by both feature prompts: environments, roles, identity and usage-key format, audit log, combined Bedrock + LiteLLM totals, governance, platform (ECS, CDK), operations, the finance statement |
| `rbac_prompt.md` | Role-based access from Entra ID (`Viewer`, `Auditor`, `Lead`, `Admin`), scopes, memberships, visibility, plus the platform unit |
| `litellm_prompt.md` | LiteLLM team and user administration, budgets, rate limits, keys, combined usage, self-service keys, the monthly statement |

## Run order

One unit per run. A run takes the **first unit not done** in its prompt.
Spec units come before code.

| # | Unit | Prompt | What it delivers |
|---|---|---|---|
| 1 | **Phase 4.9** Settings | `master_prompt.md` | The Settings page (accounts CRUD, sync status, tag coverage) |
| 2 | **R0** spec | `rbac_prompt.md` | Spec amendments and every decision in `shared-contracts.md`; threat model |
| 3 | **L0** spec | `litellm_prompt.md` | The LiteLLM spec, the OpenAPI snapshot, the allowlist table. Can run right after R0 |
| 4 | **RP** platform | `rbac_prompt.md` | `infra/` CDK: InfraStack and AppStack, ECS service, ALB import or create, health route, alarms, CI role |
| 5 | **R1** identity and roles | `rbac_prompt.md` | Roles including Auditor, `oid`, the identity record, deny by default, dev login per role |
| 6 | **R2** authorization data | `rbac_prompt.md` | Scopes, memberships, visibility, usage identities and aliases, the audit log |
| 7 | **R3** server-side scoping | `rbac_prompt.md` | The policy module; every route filtered; leak tests |
| 8 | **R4** management UI | `rbac_prompt.md` | Settings for scopes, members, aliases, visibility; access review export; works-council gate |
| 9 | **R5** UI gating | `rbac_prompt.md` | Scoped navigation; role-aware landing (*My usage*, *My teams*) |
| 10 | **L1** connection | `litellm_prompt.md` | Service key from SSM via ECS secrets, host allowlist, connection test, edition by env |
| 11 | **L2** gateway | `litellm_prompt.md` | The typed allowlist gateway, operation toggles, team links |
| 12 | **L3** read views | `litellm_prompt.md` | The LiteLLM page: spend, budgets, members, keys, model access, limits |
| 13 | **L4** writes | `litellm_prompt.md` | Members, budgets, rate limits, keys, model access, enable and disable |
| 14 | **L5** polish | `litellm_prompt.md` | Accessibility, responsive layout, runbook, full role × operation matrix |
| 15 | **L6** combined usage | `litellm_prompt.md` | Bedrock + LiteLLM totals without double counting; *My usage* completed |
| 16 | **L7** self-service keys | `litellm_prompt.md` | Request, Lead approval, reveal once |
| 17 | **L8** monthly statement | `litellm_prompt.md` | Finance CSV per department and team |
| 18 | **Phase 5** polish and accessibility | `master_prompt.md` | Includes the focus-ring token |

Phase 6 (the collector) stays last. It also adopts the canonical usage key
(`shared-contracts.md` §3.1) and, if R0 records it, the move to the
CollectorStack in CDK.

## How to start a run

1. Make sure `main` is clean, and push the previous run's commits if you
   want CI.
2. Check usage. If the weekly window is at or above **85%**, the run freezes
   at T+00 and only writes a report. Wait for the reset.
3. Start the run with `/goal` and the **exact condition** below, never the
   bare file path. A bare path makes the goal check loop, because one run can
   never finish every unit.

| Prompt | `/goal` condition |
|---|---|
| `master_prompt.md` | `prompts/master_prompt.md §12 completion criteria met for this run's target, and the report written — or the run ended by a usage freeze, the T+60 deadline, or a missing dependency, with the report written.` |
| `rbac_prompt.md` | `prompts/rbac_prompt.md §6 completion criteria met for this run's target unit, and the report written — or the run ended by a usage freeze or the T+60 deadline with the report written.` |
| `litellm_prompt.md` | `prompts/litellm_prompt.md §6 completion criteria met for this run's target unit, and the report written — or the run ended by a usage freeze, the T+60 deadline, or a missing dependency, with the report written.` |

For example, for unit 2:

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
- **Entra:** app roles (`Viewer`, `Auditor`, `Lead`, `Admin`) on both app
  registrations (dev and prod); security groups assigned to them;
  "Assignment required" on; Conditional Access (MFA or compliant device).
- **AWS:**
  - the VPC and private subnet ids
  - the ACM certificate ARN
  - either the LiteLLM ALB HTTPS listener ARN plus an agreed rule priority,
    or the company CIDRs for a new internal ALB
  - the internal DNS name
  - an existing SNS topic ARN for alarms
- **LiteLLM:**
  - confirmation that it is at least 1.104.0
  - the service user and **service key** with `allowed_routes` from the L0
    table, stored by hand in SSM under `/bedrock-dashboard/<env>/litellm/service-key`
  - the internal hostname
  - the **gateway principals** LiteLLM uses to call Bedrock
- **Governance:** the works-council or data-protection approval, before
  per-user views in `prod`; audit retention.
