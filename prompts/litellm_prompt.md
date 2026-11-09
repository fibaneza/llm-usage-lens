# Goal Prompt: LiteLLM Team & User Administration — LLM Usage Lens

Companion to `master_prompt.md` (run discipline) and `rbac_prompt.md` (roles,
scopes, membership, audit). It adds one feature: **administration of a
LiteLLM proxy, limited to teams and users, through the dashboard**, together
with a view of LiteLLM cost per team and per user. Where this file is silent,
`rbac_prompt.md` and then `master_prompt.md` apply. Where they conflict, this
file wins for this feature only.

LiteLLM references:
- **The API contract:** <https://docs.litellm.ai/openapi.json>, the
  authoritative description. At 2026-11-09 it is OpenAPI 3.1, `info.version`
  1.108.3, with 717 paths.
- **Guides:** <https://docs.litellm.ai/api-reference/>,
  <https://docs.litellm.ai/docs/simple_proxy>, and the proxy pages on
  virtual keys, users, access control, cost tracking, rate limits and model
  access.

## 0. Read first — precedence

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`shared-contracts.md` → `rbac_prompt.md` → this prompt → `master_prompt.md`.
`shared-contracts.md` defines environments, roles, identity, the audit log,
the combined usage rules, governance, the platform, operations and the
finance statement once. This file cites it and never contradicts it. Record any conflict in
the report and never resolve it silently (Rule 00.2).

**Read before dispatching any work:**
- `rbac_prompt.md`, all of it. This feature **depends on its R1–R4**: roles,
  scopes, server-side scoping and the Settings sections.
- System Architecture: *Authentication & Access* and *Organizational
  Hierarchy*.
- Data Model: entities, API Routes and status codes; Rule 20.3 (cost
  provenance).
- Design System: Page Architecture and the component inventory.
- Implementation-phases: current state.
- Rules 10, 20, 30, 40, 50, 60, 70; every `temp/report_*.md`.
- **LiteLLM's published OpenAPI document,**
  <https://docs.litellm.ai/openapi.json>, as a snapshot committed in L0.
  It is the authority for endpoint names, methods and fields; the prose docs
  are only a guide. The user confirmed that this contract matches the
  company's LiteLLM.

## 1. Mission

Add a **LiteLLM** area to the dashboard, as a page and Settings panels. There,
using the dashboard's own roles (`Viewer`, `Lead`, `Admin` — see
`rbac_prompt.md`):

| Role | Can see | Can do |
|---|---|---|
| **Viewer** | Through their `litellmUserId` link (an empty state if unlinked): their own LiteLLM spend, budget and limits (max budget, budget duration and reset time, rate limits); their own keys' metadata (alias, models, budget, spend, expiry, blocked state), **never key values** | Nothing |
| **Lead** (within their teams or departments only) | Team spend and budget; per-member spend, budgets and limits; members; keys' metadata; the team's model access | Add and remove **LiteLLM** team members (only people who are already dashboard members of the team); set and reset member budgets and spend; generate, block, unblock and delete keys for team members; enable and disable members; choose which **existing** proxy models the team may use; lower (never raise) the team budget; set rate limits (`rpm_limit`, `tpm_limit`, `max_parallel_requests`) on member keys and members, and lower team limits, never above the team's limits |
| **Auditor** | Every LiteLLM read view, organisation-wide, read-only (shared-contracts §2). **Never** key values | Nothing. Every LiteLLM write route returns `403` |
| **Admin** (the "Bedrock admin") | Everything above, for every team | Everything Leads can do, on every team. Also: link dashboard teams to LiteLLM teams; create LiteLLM teams; set team budgets and team rate limits (team `rpm_limit`, `tpm_limit`, per-model `model_rpm_limit` and `model_tpm_limit`, and the default member `team_member_rpm_limit` and `team_member_tpm_limit`); configure the connection (URL within the allowed hosts, and the edition) and see the service-key status (a scoped LiteLLM key loaded at task start from SSM; the master key is never used, §1.2 item 5); **choose which allowlisted operations are enabled** |

### 1.1 Hard limits (never built, for any role)

The dashboard must not call, proxy, wrap or expose any LiteLLM operation
outside **teams, team members, users, keys, budgets and spend reads**. In
particular:
- **Models:** adding, updating or deleting models (`/model/*` writes);
  team-BYOK model onboarding.
- **Global config:** `/config/update`, `/get/ui_settings`,
  `/update/ui_settings`, guardrails, callbacks, general and LiteLLM settings,
  SSO, alerting.
- **Organisations and agents:** `/organization/*`, `/v1/agents*`.
- **Global resets:** `/global/spend/reset`, and any other global reset or
  delete.
- **Privileged roles:** granting `proxy_admin` or `proxy_admin_viewer` to
  anyone; creating keys with elevated `permissions` (e.g. `get_spend_routes`),
  `allowed_routes`, or no owner.
- **Raw passthrough:** a generic "call any LiteLLM endpoint" route.

**Reads of the model list**, needed to pick existing models, are allowed:
the read-only model list or info endpoint as confirmed in L0.

### 1.2 Security architecture (production)

1. **Backend-for-frontend.**
   - The browser never talks to LiteLLM. Only server code under
     `apps/dashboard/lib/litellm/**` (marked `server-only`) and the Route
     Handlers call it (Rule 10, extended in the spec).
   - Client Components fetch same-origin Route Handlers only.
2. **An allowlist gateway, deny by default.**
   - `lib/litellm/` exposes **one typed function per allowed operation**, for
     example `addTeamMember`, `resetMemberSpend`, `generateMemberKey`.
   - Each function has a fixed method and path, and a strict Zod input schema
     that **builds** the LiteLLM body (never forwards a client body).
   - Each response is Zod-parsed before use.
   - Anything not in the allowlist cannot be called.
   - A structural test enumerates the allowlist and fails if the set changes
     without a spec change.
3. **Operation toggles (Admin only).**
   - Each allowlisted *write* operation has an on/off switch, stored in
     DynamoDB, versioned and audited.
   - Off is the default for destructive operations (delete key, remove
     member, reset spend); L0 sets each default.
   - A disabled operation returns `403 OPERATION_DISABLED` before any LiteLLM
     call. The UI hides or disables its controls.
   - Toggles can only *narrow* the allowlist. They can never add an operation
     to it.
4. **Authorization before every call.**
   - The `rbac_prompt.md` policy module decides whether the caller may act on
     the target dashboard team. Only then is the LiteLLM call made, against
     that team's **linked** LiteLLM `team_id`.
   - Ids are resolved server-side, from the link table and from member and
     key lookups that confirm the key or user belongs to that team.
   - Client-supplied LiteLLM ids are never trusted. A key or user outside the
     caller's scope returns `404`.
5. **Credentials: a scoped service key, never the master key.**
   - **Why (best practice).** The LiteLLM master key is unrestricted proxy
     admin. LiteLLM supports a **virtual key owned by an admin user, limited
     by `allowed_routes`**: it is enforced for every role, including
     admin-owned keys (LiteLLM docs, *Virtual Keys*).
     - So the dashboard holds a **dashboard service key** whose
       `allowed_routes` are exactly the gateway allowlist (§1.2 item 2), and
       nothing else.
     - A leaked service key cannot reach model, config, guardrail or global
       routes.
     - The **master key never enters the dashboard**, its CDK, its CI or its
       SSM parameters. It stays with the LiteLLM operators.
   - **Version floor.** CVE-2026-47101: before LiteLLM 1.83.14,
     `allowed_routes` could be abused to escalate to `proxy_admin`. The pinned
     version must be at least 1.104.0 (§2, L0), which includes the fix. L0
     re-checks open advisories for the pin.
   - **Creating the key** (an operator action, documented in
     `docs/guides/litellm-admin.md`; never automated by the dashboard):
     - The operator, using the master key, creates a dedicated LiteLLM user
       for the dashboard (for example `svc-llm-usage-lens`, with the role
       L0 confirms) and a key owned by it.
     - The key has `allowed_routes` set to the allowlisted paths (exact
       paths; L0 confirms from the snapshot and the company's LiteLLM whether patterns are accepted), a
       `key_alias`, and no `models`, because it calls management routes only.
     - L0 also checks whether a global `admin_only_routes` setting should
       harden the proxy, and records it as a recommendation for the LiteLLM
       operators.
   - **Storage and loading.** The service key lives in an AWS SSM Parameter
     Store `SecureString`, for example
     `/llm-usage-lens/<env>/litellm/service-key`.
     - It is created and updated **by hand**. No CDK, script or app code
       writes it; CDK only references its name and ARN.
     - Encryption uses `aws/ssm` or the project CMK; L0 records which.
     - The AppStack task definition declares `LITELLM_SERVICE_KEY` under
       `secrets` (`valueFrom` the parameter ARN). ECS reads it when each task
       starts, using the **task execution role**, and injects it as a
       server-only environment variable.
     - Application code **never calls SSM**. The value never goes in plain
       `environment`, CDK context, CloudFormation outputs or the image.
     - Cost: standard parameters are free; KMS is free with `aws/ssm`.
       Document it (*Cost posture*).
   - **It never leaks.** It must never appear in the repo, `.env.example`
     values, the client bundle, the UI, API responses, logs, OpenTelemetry
     attributes, error messages, DynamoDB items or the audit log
     (Rules 50.6, 50.9).
     - `env.ts` validates it as server-only and never `NEXT_PUBLIC_*`.
     - It is read at request time, never inlined into build output; a test
       greps the client bundle and the static build output for the value.
     - When it is missing, LiteLLM features report "not configured" (status
       only), and the rest of the dashboard runs.
   - **Local dev and tests** use the fake LiteLLM (§4), with a throwaway
     `LITELLM_SERVICE_KEY` in the gitignored `.env.local`. If the user
     provides a non-production LiteLLM, its operators create a service key
     for it with the same `allowed_routes`. The dashboard always uses **only**
     a service key, exactly as in production.
   - **No UI for the key.** No route or UI sets, rotates or reveals it.
     - Admins see only: key configured (yes/no) and a connection test (OK /
       "unauthorised" / unreachable).
     - Rotation follows the runbook:
       1. Create a new service key in LiteLLM.
       2. Update the SSM parameter by hand.
       3. Force a new ECS deployment, so new tasks read it (ECS resolves
          `valueFrom` only at task start).
       4. Run the connection test.
       5. Block, then delete, the old key.
     - A `401` from LiteLLM is shown to Admins as "service key rejected —
       rotate and redeploy". It is never retried with another key. A `403`
       on an allowlisted route is reported as "service key routes out of
       date".
6. **The connection.**
   - **Admins configure it.** The LiteLLM base URL is set by Admins in
     Settings, stored in DynamoDB, versioned and audited.
   - **But only to approved hosts.** The URL must match an allowlist fixed at
     deploy time (`LITELLM_ALLOWED_HOSTS` in `env.ts`, set by the deploy
     configuration), must be `https` in production, and may contain no
     credentials, query string or fragment.
     - **Why:** the server sends the service key to whatever URL is configured.
       An unrestricted Admin-editable URL would let a mistake or a hijacked
       Admin session send the key to an arbitrary host.
   - Changing the URL requires a successful connection test before it is
     saved. Nothing in the client can override it, which also prevents SSRF.
   - Calls have timeouts (default 10 s). GETs may be retried with backoff;
     writes are never retried automatically.
   - **Failures.** LiteLLM failures return the standard `{ error: { code,
     message } }`, with sanitised messages and no upstream bodies passed
     through. A LiteLLM outage shows a handled "LiteLLM unavailable" state on
     the LiteLLM panels only. The rest of the dashboard keeps working
     (Rule 40.4).
6a. **Cloud permissions (yes, they are required), in the CDK AppStack**
    (`rbac_prompt.md` §1.8).
    - **ECS task execution role.** It injects the secret at task start:
      - `ssm:GetParameters` on the exact parameter ARN only
      - `kms:Decrypt` on its key, with the condition
        `kms:ViaService = ssm.us-east-1.amazonaws.com`
      - plus the standard ECR pull and log permissions
    - **ECS task role (app runtime).** No SSM or KMS access at all. It has
      only the DynamoDB access that `rbac_prompt.md` §1.6 item 9a defines; one
      shared definition.
    - **CI deploy role (GitHub OIDC).** It deploys the AppStack. It cannot
      read the parameter.
    - **No `ssm:PutParameter` anywhere,** because the parameter is managed by
      hand.
    - **Network path to LiteLLM.** LiteLLM already exists and is not deployed
      by these prompts. The dashboard reaches it over the existing internal
      network (same VPC or the Transit Gateway; `rbac_prompt.md` §1.8),
      through its existing internal hostname.
      - No network resources are added for it.
      - `LITELLM_ALLOWED_HOSTS` contains only that hostname.
      - The task security group's egress is limited to what L0 records
        (443 to LiteLLM's address range).
    - Runs write, synthesise and assert the CDK (for example policy
      statements). They never deploy and never call AWS.
7. **Generated key values.**
   - A new key is returned **once** in that response and shown once in the UI
     with a copy action.
   - It is never stored by the dashboard, logged or cached. The response
     carries `Cache-Control: no-store`.
   - Lists show only the key alias, the masked prefix and suffix (as LiteLLM
     returns them) and the LiteLLM token id.
8. **Every write is audited** in the `rbac_prompt.md` audit log: actor, team,
   operation, target (LiteLLM user id or key token id, **never key values**),
   sanitised before and after, and the result. Use the shared audit
  semantics in `rbac_prompt.md` §1.6 item 8.
9. **Rate limits are enforced by LiteLLM and configured through its API.**
   - The dashboard has no rate limiting of its own (`rbac_prompt.md` §1.6
     item 6). Admins and Leads **configure** LiteLLM's limits through the
     gateway (§1.3, *Rate limits*), and LiteLLM enforces them.
   - Every rate-limit write is an allowlisted operation with an Admin
     toggle, and is audited.
9a. **Enforced access only.** While `AUTH_ACCESS_MODE` is `open`
    (`rbac_prompt.md` §1.6.10), every LiteLLM route returns `403` and no
    LiteLLM call is made. The open staging mode never exposes LiteLLM.
10. **Writes use** the same-origin check, Zod validation, body and path id
    matching and the `403` before parsing from `rbac_prompt.md` §1.6. The
    structural write-route test must include every LiteLLM write route.

### 1.3 Data and identity mapping

- **Team link.**
  - The table maps dashboard `teamId` to a LiteLLM `team_id`. It is
    Admin-managed, audited, and allows one LiteLLM team per dashboard team in
    v1.
  - A dashboard team without a link shows "not connected to LiteLLM".
  - **Department leads** act on each linked team inside their department
    scope.
- **LiteLLM edition.**
  - Per shared-contracts §1: `dev` runs **LiteLLM OSS** with no SSO, and
    `prod` runs **LiteLLM Enterprise** with SSO through Entra ID. Everything
    must work on OSS.
  - Enterprise-only operations sit behind the capability flag `edition: oss |
    enterprise`. It is **fixed by environment**: Admins can see it but not
    change it.
    - Examples: key regenerate, global spend report, team-member permissions,
      per-model budgets.
    - On OSS they are hidden and their routes return `403
      OPERATION_UNAVAILABLE`.
  - The flag can only enable operations that are already in the allowlist.
- **User mapping (per edition).** It is resolved through the dashboard
  identity record (`oid`, `tid`, `email`, `upn`; `rbac_prompt.md` §1.2) and
  stored as an identity link `oid → litellmUserId` (`rbac_prompt.md` §1.5).
  - **OSS, no SSO:** LiteLLM users are keyed by the **work email**,
    lower-cased. The dashboard creates the user with `user_id` and
    `user_email` both set to the email.
  - **Enterprise, SSO with Entra ID:** LiteLLM creates users at SSO sign-in.
    The link must point at **the `user_id` LiteLLM assigned through SSO**,
    which may be the Entra object id rather than the email; L0 confirms against
    the company's Enterprise deployment, a user-assisted check.
    - The dashboard looks the user up by email, then stores the link.
    - It never creates a duplicate user that SSO would later shadow.
  - **Changing edition** re-resolves the links. The migration is a runbook
    step, audited.
  - Adding a member creates the LiteLLM user if missing, with the
    least-privilege role (`internal_user`, or what L0 confirms), and adds it
    to the linked team.
  - Leads can add only people who are already members of that dashboard team
    (`rbac_prompt.md` §1.5), so LiteLLM access never exceeds dashboard
    membership.
  - **Removing a dashboard membership never silently changes LiteLLM.** The
    UI tells the Lead the person is still in the LiteLLM team and offers
    "also remove from LiteLLM". That is a separate, audited operation.
    Settings lists such orphaned LiteLLM members for cleanup.
- **Enable and disable a member.**
  - Disable blocks every key the member owns in that team (`/key/block`).
    Enable unblocks them (`/key/unblock`).
  - If L0 finds a supported user- or member-level block for the pinned
    version, prefer it and record the choice.
  - Disabling must never delete data or keys.
- **Budgets.**
  - Team `max_budget` and `budget_duration` are set by an Admin. A Lead may
    lower the team budget only.
  - Member budget (`max_budget_in_team`, `budget_duration`) is set by a Lead
    within the team budget.
  - Reset member spend uses `POST /team/{team_id}/member/{user_id}/reset_spend`.
  - Reset member budget to the team default uses
    `POST /team/{team_id}/member/{user_id}/reset_budget`, which needs
    LiteLLM ≥ 1.104.0.
  - Note from the LiteLLM docs: on team keys, only team and team-member
    budgets are enforced, and the key owner's personal budget does not apply.
    Show this in the UI so people do not misread it.
- **Rate limits.** These are LiteLLM fields, set through LiteLLM's API;
  field names were confirmed in the 2026-11-09 OpenAPI snapshot.
  - **Team level** (`POST /team/update`): `rpm_limit`, `tpm_limit`,
    `model_rpm_limit` and `model_tpm_limit` (per model, only for models the
    team already has), and `team_member_rpm_limit` and
    `team_member_tpm_limit` (the default for each member).
    - An **Admin** sets or raises them.
    - A **Lead** may only **lower** them, the same rule as for team budgets.
  - **Member level** (`POST /team/member_update`): `rpm_limit` and
    `tpm_limit` for one member in the team. Set by a Lead or an Admin, never
    above the team's limits.
  - **Key level** (`POST /key/generate` and `POST /key/update`):
    `rpm_limit`, `tpm_limit` and `max_parallel_requests` on a member's key.
    Set by a Lead or an Admin, never above the member's or the team's
    limits.
  - **Validation.**
    - Limits are positive integers, or "unset", meaning they inherit. An
      unset value is never coerced to `0`, because LiteLLM may read `0` as
      "block".
    - The server reads the current team limits before validating a lower
      level. A request that exceeds them returns `400`, with no LiteLLM call.
  - **Not exposed:** user-level limits outside a team (`/user/update`),
    `mcp_rpm_limit`, `tag_rpm_limit`, and `rpm_limit_type` or
    `tpm_limit_type` overrides. They stay at LiteLLM's settings, and L0 may
    propose them later.
  - **Viewers** see their own effective limits, read-only.
- **Team model access.** Set the team's `models` to a subset of the proxy's
  **existing** models, read from the model list. The value is validated
  server-side against that list. Model access is restricted, never added.
- **Keys.**
  - Generated with the linked `team_id` and the member's `user_id`, and only
    these fields: `models` (a subset of the team's), `max_budget`,
    `budget_duration`, `rpm_limit`, `tpm_limit`, `max_parallel_requests`
    (within the team's and member's limits), `duration` (expiry),
    `key_alias` and `metadata` tags.
  - Never `permissions`, `allowed_routes`, `key_type` overrides, or a key
    without `user_id`.
  - **Rotation.** On Enterprise, use `/key/{key}/regenerate`, with a grace
    period. On OSS (dev), rotation is "generate new, then block old"; the
    same UI action switches on the edition flag.

### 1.4 Cost visualisation

- **Sources (confirmed in the 2026-11-09 OpenAPI snapshot):**
  - team spend from `/team/info` and `/team/daily/activity/aggregated`
  - user spend from `/user/info` and `/user/daily/activity`
  - per-request detail from `/spend/logs/v2`, filtered by `team_id` or
    `user_id`
  - **Enterprise only:** `/global/spend/report` with `group_by=team`, behind
    the edition flag, called only by the server and filtered to the caller's
    scope. `get_spend_routes` keys are never created.
- **Provenance (Rule 20.3).**
  - LiteLLM spend is LiteLLM's own calculation from its model price map. It
    is **not** billed cost.
  - Label it "LiteLLM-reported" everywhere it appears on its own.
  - **Combined totals** follow **shared-contracts §5** exactly:
    - direct Bedrock usage, excluding the LiteLLM gateway principals, plus
      LiteLLM-reported usage
    - the gateway slice shown as "billed via LiteLLM"
    - a reconciliation row
    - every combined figure shows its parts
  - Never present LiteLLM-reported spend as Cost Explorer exact cost, and
    never add it without excluding the gateway slice. That would count
    LiteLLM-to-Bedrock traffic twice.
- **Page.**
  - A new `/dashboard/litellm` page (name and navigation placement in L0),
    with these sections, each in its own Suspense and ErrorBoundary
    (Rule 40.4):
    - "My usage" (all roles)
    - "Team spend & budgets" (Lead and Admin)
    - "Members"
    - "Keys"
    - "Model access"
  - It reuses `UsageTable`, `MetricCard`, the chart wrappers, `UserAvatar` and
    `EmptyState`. New components go through the Design System inventory.
- **Settings panel (Admin).** The LiteLLM connection (URL and edition), the
  service-key status (configured yes/no; no entry, rotate or reveal), the
  connection test, operation toggles, team links and the orphaned-member
  list.
- **Caching.**
  - LiteLLM reads are **not cached** on the server. Each request reads
    LiteLLM, so no task ever serves another task's stale state
    (`rbac_prompt.md` §1.8).
  - TanStack Query on the client may keep data briefly. After a write, the
    UI shows the post-write state from the write response and refetches.
  - Scoping happens after the cache read; responses send `Cache-Control:
    private, no-store` (`rbac_prompt.md` §1.6).
  - Currency is USD. Dates come from LiteLLM in UTC; convert them and label
    the time zone.

### 1.5 Out of scope

- **Hard limits:** everything in §1.1.
- **Infrastructure:** deploying or operating LiteLLM itself, and deploying any
  AWS resource. IaC may be written and synthesised; deploying is a user
  action.
- **Enterprise-only test setup:** Enterprise features are built behind the
  edition flag and tested against the fake LiteLLM, which can emulate both
  editions.
- **Budget alerts (optional, not built):** LiteLLM's alerting is a global
  LiteLLM setting (§1.1), configured by the LiteLLM operators. The dashboard
  only shows budget-usage indicators (spend against max and soft budget).
- **Phase 6 and other AWS changes:** any change to Phase 6 or the collector
  (including the CollectorStack). The only AWS pieces are the AppStack
  additions in CDK (§1.2 item 6a), synthesised and never deployed by a run,
  and a reference to the hand-managed SSM parameter.

## 2. Units and phase placement (Rule 30)

**Global order, shared with `rbac_prompt.md`:**
Phase 4.9 Settings → RBAC R0, RP, R1–R5 → LiteLLM L0–L8 → Phase 5
(see `README.md`).

- L0, the spec unit, may run earlier, in parallel with RBAC R0.
- L1 and later need RBAC R1–R4 on `main`. R4 provides the Settings sections
  the L1 panel extends, on top of the Phase 4.9 Settings shell.

| Unit | Branch | Content | Depends on |
|---|---|---|---|
| **L0: spec, version pin, contract** | `docs/litellm-admin` | See the L0 scope below this table | — |
| **L1: secrets, connection and permissions** | `feature/phase-<n>-litellm-connection` | `env.ts` entries (`LITELLM_SERVICE_KEY` server-only, `LITELLM_ALLOWED_HOSTS`), the AppStack task-definition secret wiring (`valueFrom` the SSM ARN), the Admin-configured base URL checked against the host allowlist, a server-only client (timeouts, GET retries, error mapping), the connection test, the edition flag, the Admin Settings panel (status, URL, edition, test; no key entry), and the CDK AppStack additions: execution-role SSM and KMS access for the one parameter, nothing added to the task role (synthesised and asserted, never deployed) | L0, RBAC R1–R4, Phase 4.9 |
| **L2: gateway and toggles** | `feature/phase-<n>-litellm-gateway` | `lib/litellm/` typed allowlist functions with Zod in and out; operation toggles (DynamoDB, versioned, audited); the team-link table; the structural allowlist test; contract tests against the fake | L1, RBAC R2 |
| **L3: read views** | `feature/phase-<n>-litellm-views` | Read Route Handlers (scoped); the `/dashboard/litellm` page with "My usage", "Team spend & budgets", "Members", "Keys" (metadata only) and "Model access" (read); provenance labels; outage states | L2, RBAC R3 |
| **L4: lead and admin writes** | `feature/phase-<n>-litellm-writes` | Write Route Handlers: member add and remove; member budget set and reset; reset spend; enable and disable; key generate (shown once), block, unblock and delete; team model access; rate limits at team (Admin set or raise, Lead lower), member and key level, validated against the team's limits; team budget (Admin set, Lead lower); team create and link (Admin); audit records | L3 |
| **L5: polish and verification** | `feature/phase-<n>-litellm-polish` | Accessibility (Phase 5 floor), responsive layout, the docs runbook, and the full role × operation matrix against the fake (and against the non-production LiteLLM when provided) | L4 |
| **L6: combined usage and *My usage*** | `feature/phase-<n>-litellm-combined` | The Admin gateway configuration (gateway principals and account ids, audited); combined totals on Overview, Teams, Team Detail and Users per shared-contracts §5 (parts shown, gateway slice, reconciliation, the unconfigured-gateway warning); *My usage* completed with the LiteLLM part (spend, budget, limits, keys) next to direct Bedrock usage; the RBAC R5 landing pages extended | L5, RBAC R5 |
| **L7: self-service key requests** | `feature/phase-<n>-litellm-key-requests` | See *L7 design* below the table | L6 |
| **L8: monthly statement** | `feature/phase-<n>-finance-statement` | The shared-contracts §9 CSV (department and team, Bedrock exact finalised, LiteLLM-reported, combined, reconciliation, provisional flag) for Admin, Auditor and Leads in scope; audited downloads | L6 |

**L7 design: self-service key requests.**
- **Request.** A Viewer who is a LiteLLM member of a linked team requests a
  key. They choose a subset of the team's models, a budget and rate limits at
  or below their member limits, and an expiry (**required**, at most the
  Admin-set ceiling).
- **Approval.** A Lead with scope over that team approves or rejects it.
  - Requests expire after N days (L0 sets N).
  - Everything is audited, and the operation toggle defaults off.
- **Generation happens at reveal, by the requester.** After approval, the
  requester clicks "Create and reveal once". Only then does the server call
  `/key/generate`, so the value is returned only in the requester's
  response. The Lead never sees it, and it is never stored.
- **Limits.** A cap of open requests per person. A rejected or expired
  request can never be revealed.

**L0 scope:**
- **Pin and verify the version.**
  - Download <https://docs.litellm.ai/openapi.json> and commit it as
    `docs/litellm/openapi.json`, recording the fetch date, the
    `info.version` (1.108.3 on 2026-11-09) and a SHA-256.
  - **Version floor:** the company's LiteLLM must be at least 1.104.0 (member
    budget reset; also past the CVE-2026-47101 fix in 1.83.14). The user
    confirms this. No container or instance is needed to obtain the
    contract.
  - From the snapshot, **confirm every endpoint and field in §1**. A check on
    2026-11-09 found these present in the published spec:
    - **Teams:** `/team/new`, `/team/update`, `/team/info`, `/team/list`,
      `/team/delete`, `/team/block`, `/team/unblock`, `/team/member_add`,
      `/team/member_update`, `/team/member_delete`, plus
      `/team/{team_id}/member/{user_id}/reset_spend` and `reset_budget`.
    - **Users:** `/user/new`, `/user/update`, `/user/info`, `/user/list`,
      `/user/delete`.
    - **Keys:** `/key/generate`, `/key/update`, `/key/delete`,
      `/key/block`, `/key/unblock`, `/key/info`, `/key/list`,
      `/key/{key}/regenerate`.
    - **Spend and reports:** `/spend/logs`, `/spend/logs/v2`,
      `/user/daily/activity`, `/team/daily/activity`,
      `/global/spend/report`.
    - **Models (read):** `/model/info`, `/models`, `/v1/models`.
  - L0 still determines from the schemas: whether a key value is returned
    only once, and the response fields used for metadata, spend and
    limits.
- **Write the allowlist table.** One row per operation: role, LiteLLM call,
  input fields, toggle default and audit fields.
- **Amend the specs:**
  - System Architecture: a LiteLLM integration section and the secret
    handling.
  - Data Model: entities, API Routes, and the error codes
    `OPERATION_DISABLED`, `OPERATION_UNAVAILABLE` and `LITELLM_UNAVAILABLE`,
    added to the shared error-code registry that `rbac_prompt.md` R0 also
    extends (`409`).
  - Design System: the page, the panels and the provenance labels.
  - Implementation-phases: L1–L8 as sub-phases with tasks and Verify items.
  - Rule 10, extended to `lib/litellm/**`.
  - A new `docs/guides/litellm-admin.md` runbook.
- **Threat model.** Service-key exposure and over-broad `allowed_routes`
  (including the CVE-2026-47101 class), privilege escalation through
  LiteLLM fields, cross-team key access, SSRF, abuse of bulk writes, and
  confusing LiteLLM spend with billed cost. Map each threat to a test.
- **Gate:** `spec-guardian` reviews until APPROVE.

**Process:**
- One unit per branch and one squash commit (Rules 30.4, 70.10). A run's
  target is the first unit not done; later units are out of that run's scope.
- **Each code unit runs the Rule 70 loop:**
  1. tdd-test-engineer (sonnet) writes the failing tests.
  2. typescript-developer (sonnet) makes them pass.
  3. Review on opus: quality-reviewer, spec-guardian, playwright-ui-reviewer
     for UI changes, and ecc:security-reviewer if installed. Without it,
     quality-reviewer covers security explicitly.
- **L1, L2 and L4 get a dedicated security review pass** against the threat
  model.

## 3. Correctness checklist (tests must assert these)

- **The connection is bound to approved hosts.** A URL outside
  `LITELLM_ALLOWED_HOSTS`, an `http` URL in production, or a URL with
  credentials, a query string or a fragment is rejected with `400` and never
  called. The key is sent only to an allowed host.
- **Edition.** With the OSS flag set, every Enterprise-only operation returns
  `403 OPERATION_UNAVAILABLE` with no LiteLLM call made. User mapping follows
  the edition rules (email on OSS; the SSO-assigned id, looked up by email,
  on Enterprise).
- **Secret never leaks.**
  - Tests inspect: the client bundle (grep the build output), every API
    response, logs, OpenTelemetry attributes, DynamoDB items and the audit log.
  - Each one is checked for the service key, the master key and generated key
    values, and
    none may contain them.
  - The application code makes no SSM or KMS calls: a structural test finds
    no SSM client import under `apps/`.
  - No code path or CDK writes the parameter.
  - The CDK assertions show:
    - SSM read and KMS decrypt only on the task **execution** role, scoped to
      the one parameter ARN
    - none on the task role or the CI role
    - no `ssm:PutParameter`
    - the service key only in the task definition's `secrets`, never in
      `environment`
  - A `401` from LiteLLM shows the "rotate and redeploy" status and makes no
    retry.
- **Allowlist.**
  - Any forbidden operation (§1.1) has no function, no route and no UI.
  - The structural test fails when the allowlist changes.
  - A test asserts that the service key's documented `allowed_routes` list
    (the runbook and the L0 allowlist table) equals the gateway's set of
    paths exactly. Drift either way fails.
  - A body sent to a write route can never add fields beyond what the
    gateway builds; extra fields are rejected by Zod.
- **Toggles.** A disabled operation returns `403 OPERATION_DISABLED` and makes
  no LiteLLM call; this is asserted with the fake. Only an Admin can change a
  toggle, and each change is audited.
- **The role × operation matrix.** Every read and write is tested for:
  - unauthenticated
  - no role
  - Viewer (own data; another user's data)
  - Lead (own team; another team; department scope, including a team that
    moved department)
  - Admin
  The assertions are `401`, `403`, `404` parity and in-scope-only data.
- **Cross-team safety.**
  - Acting on a key, user or member outside the caller's linked teams
    returns `404`, with no LiteLLM write made.
  - Server-side membership checks prevent forged LiteLLM ids.
- **Budgets.**
  - A Lead cannot raise the team budget, and cannot set a member budget above
    the team budget.
  - A reset affects exactly one member of one team.
  - The UI explains which budget is enforced on team keys.
- **Keys.**
  - A generated key has the linked `team_id` and the member's `user_id`, and
    its models are a subset of the team's.
  - It carries no `permissions` or `allowed_routes`.
  - Its value appears in exactly one response and never again.
- **Rate limits.**
  - A Lead cannot raise team limits.
  - Member or key limits above the team's limits return `400`, with no
    LiteLLM call.
  - An unset limit is sent as "unset" (omitted, or `null` per the schema),
    never `0`.
  - Per-model limits are accepted only for models the team already has.
  - Each change produces exactly one audit record.
  - Unexposed limit fields cannot be set through any route.
- **Model access.** Only existing models are accepted; an unknown model
  returns `400`. No model write call exists.
- **Provenance and combined totals** (shared-contracts §5).
  - A combined figure equals direct Bedrock (gateway principals excluded)
    plus LiteLLM-reported usage, and the test fixture proves it: a request
    that went through the gateway to Bedrock is counted once, not twice.
  - The gateway slice and the reconciliation row are present.
  - With no gateway configured, combined totals are hidden from Viewers and
    Leads, and a warning is shown to Admins and Auditors.
  - LiteLLM-only figures are labelled "LiteLLM-reported".
- **Resilience.**
  - With LiteLLM down or timing out, the LiteLLM sections show a handled
    error and other pages are unaffected.
  - Writes are not retried.
  - A `401` from LiteLLM is not retried. It reports "service key rejected —
    rotate and redeploy" (status only) to Admins.
- **Audit** (shared semantics, `rbac_prompt.md` §1.6 item 8).
  - A successful write creates exactly one `success` record.
  - A write that passed authorization but failed upstream (LiteLLM error or
    timeout) creates exactly one `failed` record.
  - A write rejected with `400`/`401`/`403`/`404`/`409` creates none.
  - No record contains secrets.
- **Unchanged guarantees:** everything listed in `rbac_prompt.md` §1.6.12.

## 4. Verification

- **Unit and integration tests** run against a **fake LiteLLM**: an in-process
  HTTP fake or MSW that implements the allowlisted operations exactly per the
  committed OpenAPI snapshot. No test touches the real internet
  (Rule 60.24).
- **Contract check.** A test validates every gateway call (method, path, and
  request and response fields) against `docs/litellm/openapi.json`.
  - Refreshing the snapshot is a deliberate change. Diff it, and re-run the
    contract tests.
- **End-to-end probe** (L3–L5): run only if the user provides a
  non-production LiteLLM URL and service key. Otherwise the probe runs
  against the fake, and the report says so. Sign in as each role through the
  dev login and exercise every enabled operation.
  - **Spend:** check spend shows after a few requests sent with a test key.
  - **Teardown:** the probe cleans up only the LiteLLM teams, users and keys
    it created, uniquely prefixed.
  - **Not committed;** results go in the report.
- **Gates** as in `master_prompt.md` §8, on each branch and on `main` after
  each merge.
- **User actions:**
  - creating and updating the SSM `SecureString` by hand
  - forcing a new ECS deployment after a rotation
  - `cdk deploy` of the stacks (`rbac_prompt.md` §1.8)
  - the LiteLLM network path from the VPC
  - setting `LITELLM_ALLOWED_HOSTS`
  - configuring the production URL and edition in Settings
  - confirming the company's LiteLLM is at least 1.104.0
  - identifying LiteLLM's Bedrock gateway principals (IAM role names) and
    gateway account ids, for the combined totals (shared-contracts §5)
  - the Enterprise SSO identity check (L0's `user_id` confirmation against
    the real tenant)

## 5. Timing, usage, orchestration, git, report

These are as in `master_prompt.md`:
- §2 timing (T+55 freeze, T+60 report) and the usage tiers
- §3 monitoring
- §5 orchestration, model routing and budget
- §6 git guardrails: never `git push`; stage explicit paths; never `temp/`;
  local squash-merge only after gates and APPROVE
- §9 docs
- §10 report at `./temp/report_YYMMDD.md` (suffix `_2`, `_3` if taken), with
  the same skeleton

The report adds:
- a row per unit L0–L8
- the allowlist table with toggle states
- the role × operation matrix summary
- a threat-to-test traceability table
- an explicit line: "service key, master key and key values: leak checks
  passed"

## 6. Completion criteria (what "Completed" means)

A run is **Completed** when all of these hold:

1. Its Track B target, the first unit L0–L8 not done (with `rbac_prompt.md`
   R1–R4 already merged for L1 onward), is done, reviewed (Rule 70 APPROVE,
   every blocker resolved or recorded) and verified by the orchestrator's own
   gate runs. For L3–L5, the local end-to-end probe has passed too.
2. Units after the target, and any `rbac_prompt.md` unit, are **out of scope
   for that run** and do not count against completion. If a dependency is
   missing, the run is **Blocked**: it says so and stops.
3. The report exists by T+60, is marked on time, and lists every user action.

A run also ends **legitimately**, recorded as Partially completed or Blocked
and not as a failure of these criteria, when either of these happens:
- **A usage freeze (`master_prompt.md` §2):** consolidate and write the
  report immediately.
- **The T+60 deadline:** after T+55, only the report.

User-only actions never count against completion:
- `git push` and CI results
- production LiteLLM configuration: the dashboard service user, its
  service key with `allowed_routes`, and the SSM service-key parameter
- `cdk deploy` of any stack, and the network path to LiteLLM
- verifying Enterprise and SSO behaviour against the real tenant
- policy choices that L0 marks as needing the user

If this prompt is tracked with `/goal`, use this exact condition:
**"prompts/litellm_prompt.md §6 completion criteria met for this run's target unit,
and the report written — or the run ended by a usage freeze, the T+60
deadline, or a missing dependency, with the report written."**
Never use the bare file path or "all units done".
