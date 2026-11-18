# Goal Prompt: Role-Based Access from Entra ID — LLM Usage Lens

Companion to `master_prompt.md`. All three prompts live in `prompts/`. It reuses that prompt's run discipline
(timing, usage guard, progress monitoring, orchestration, git guardrails,
report skeleton) and replaces its mission with one production feature:
**role-based, scope-limited access driven by Microsoft Entra ID**, fit for use
across a company. Where this file is silent, `master_prompt.md` applies. Where
they conflict, this file wins for this feature only.

**Related files (all in `prompts/`):**
- `shared-contracts.md`: environments, roles, identity, the audit log, the
  combined Bedrock + LiteLLM usage rules, governance, the platform,
  operations and the finance statement. It is defined once and **wins over
  this file**.
- `litellm_prompt.md`: LiteLLM administration, built on this feature.
- `README.md`: the run order and the exact `/goal` conditions.

## 0. Read first — precedence

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`shared-contracts.md` → this prompt → `master_prompt.md`. Record any conflict with a rule or spec in the
report (§10 "Spec/rule conflicts"), and never resolve it silently (Rule 00.2).

Read in this order before dispatching any work:

1. `docs/specs/2026-05-15-system-architecture.md`:
   - *Authentication & Access*, especially *Sign-in providers* and
     *Account-mutation role*. Today every signed-in member can read everything,
     the `Admin` app role gates writes, a session is capped at 8 hours, and
     roles are read at sign-in.
   - *Organizational Hierarchy*: Organization → Department → Team, where a team
     is one AWS member account.
2. `docs/specs/2026-05-15-data-model.md`:
   - entities and `AccountMeta`
   - `byUser` keys, which are IAM Identity Center usernames taken from CloudTrail
   - *Historical Snapshots for Department/Team Names*
   - the API Routes table and HTTP status codes
3. `docs/specs/2026-05-15-implementation-phases.md`: Phases 1–4.8 are done and
   4.9 Settings is next. Read 4.9's tasks.
4. `docs/guides/auth-setup.md`: the Entra app registration, app roles and the
   dev-only local login.
5. Code:
   - `apps/dashboard/auth.ts`
   - `apps/dashboard/lib/auth/{roles,auth-config,session-lifetime}.ts`
   - `apps/dashboard/lib/api/respond.ts` (`withRoute`, `requireAdmin`)
   - `apps/dashboard/app/api/__tests__/write-routes.integration.test.ts`
   - `apps/dashboard/e2e/support/session.ts`
   - `apps/dashboard/lib/api/load-range-rollups.ts` (caching)
6. `.claude/rules/10, 20, 30, 50, 60, 70`, and every `temp/report_*.md`.

## 1. Mission

Replace "every signed-in member sees everything" with role-based,
scope-limited access, fit for company-wide use. Identity comes from
Microsoft Entra ID. Each decision is **enforced on the server**, and every
change is **audited**.

The model follows LiteLLM's user-management hierarchy, role-based access,
JWT team mapping and inheritance rules (docs.litellm.ai: *User Management
Hierarchy*, *Role-based Access Control*, *JWT-based Auth*, *Access
Management Overview* and *Inheritance*). It also defines what those pages
leave unstated: SSO versus UI precedence, and empty groups.

It follows the usual access-control principles:
- **Least privilege** and **deny by default** for data
- **Separation of duties**: whoever grants access is not whoever audits it
- **Joiner-mover-leaver** handling
- **Periodic access review**
- **A controlled break-glass account**

These map to ISO/IEC 27001:2022 Annex A 5.15–5.18 and 8.2, and to NIST SP
800-53 AC-2, AC-5, AC-6 and AU-2. Cite them in the spec only as
alignment, not as a certification claim.

Decided 2026-11-10 (user direction). These decisions supersede earlier
drafts of this prompt and of `shared-contracts.md` §2.

### 1.1 Hierarchy and roles

**Hierarchy.** Organization → Department → Team → User. This is LiteLLM's
Organization → Team → Internal User chain, without keys.
- A **team** is one AWS member account.
- A **department** is LiteLLM's organization level.
- Permissions are evaluated top-down, and a child level can only **narrow**
  its parent (§1.4).

**Two kinds of role.** Every value is lower-kebab-case and case-sensitive,
and lives only in `apps/dashboard/lib/auth/` (Rule 50.3). App-role values
carry the `internal-` prefix.

| Role | Kind | LiteLLM analogue | Source | Reads | Writes |
|---|---|---|---|---|---|
| `internal-admin` | Global; a **small, named group** (at least 2 people plus the master user) | `proxy_admin` | Entra app role; an in-app grant by an `internal-admin`; the master user (§1.3) | Everything | Everything: any team, any user, all configuration. **Only role that can grant or revoke `internal-admin` and `internal-org-admin`** |
| `internal-org-admin` | Global | none (between `proxy_admin` and `org_admin`) | Entra app role, or an in-app grant by an `internal-admin` | Every team and department | Lead and member assignments, moves and visibility in **any** team or department. **No configuration**, no global-role grants |
| `internal-auditor` | Global | `proxy_admin_viewer` | **Entra app role only** | Everything, read-only, organisation-wide, including the audit log and access review. Never key values or secrets | Nothing; every write returns `403` |
| `internal-viewer` | Global; **the default** | `internal_user` | Entra app role, or the default (§1.2) | Their own usage (*My usage*); their affiliation's data as visibility allows | Nothing |
| `internal-team-admin` | Scoped to **one or more** teams and/or departments; each is a separate admin scope (`scope: team \| department`) | `team_admin` (team scope), `org_admin` (department scope) | UI or SSO group mapping | Everything in its scope | Members, promoting or demoting members of its scope (never themselves), and visibility; with department scope, also moves between the department's teams and the department cap |
| member (no role value) | A plain affiliation to one team | team role `user` | UI or SSO group mapping | The team, as visibility allows | Nothing |

**Configuration** means:
- group mappings
- account CRUD (Phase 4.9)
- the per-user approval
- local users
- the LiteLLM gateway and edition settings
- audit retention

Only `internal-admin` changes configuration.

**Role rules:**
- **Union.** Effective permission is global role grants ∪ scoped role
  grants, then narrowed by inheritance (§1.4).
- **Separation of duties.** `internal-auditor` comes only from Entra, so no
  in-app administrator can create or remove an auditor. An auditor cannot
  write anything.
- **In-app global-role grants** (`internal-admin`, `internal-org-admin`):
  - **Only an `internal-admin`** may make or revoke one. Anyone else gets
    `403`.
  - Each needs a sign-in within the last 15 minutes (otherwise
    `403 REAUTH_REQUIRED`) and a written reason.
  - Each is audited (`role.grant` / `role.revoke`) and emits an id-only
    security event that the DashboardServiceStack alarms on.
  - Each grant shows its source (`entra`, `app` or `master`) in the access
    review.
  - The last `internal-admin` cannot be revoked (`409`).
  - Removing the Entra role does not remove an in-app grant; the access
    review flags that case.
- **Group mappings never target a global role.** A mapping to
  `internal-*` is rejected by the schema.
- **Migration.** The legacy app-role value `Admin` is an alias for
  `internal-admin` until `AUTH_ACCESS_MODE=enforce` in `prod`, then it is
  removed. No `Lead`, `Viewer` or `Auditor` app roles are created.

### 1.2 Identity, SSO mapping and defaults

**Stable identity.**
- Key users by the token's `oid` together with `tid`. `email` and
  `preferred_username` (UPN) are display attributes only.
- `auth.ts` Zod-parses `oid`, `tid`, `roles` and `groups` into the JWT and
  `session.user`.
- **Fail closed** on a malformed token: a missing `oid`, a `tid` other than
  the configured tenant, or a `roles` or `groups` claim that is present but
  not an array means no session.
- **Identity record.** At each sign-in, upsert `oid → { tid, email, upn,
  displayName, lastSignInAt, lastSeenRoles[] }`, with `email` and `upn`
  lower-cased (shared-contracts §3).

**Entra configuration** (the user applies it; the run documents it).
- The enterprise application has **"Assignment required?" = Yes**, so only
  assigned users and groups can sign in.
- Security groups are assigned to the app roles. Placeholders:
  `llm-usage-lens-admins` → `internal-admin`,
  `-org-admins` → `internal-org-admin`, `-auditors` →
  `internal-auditor`, `-users` → `internal-viewer`.
- Assigning groups to app roles needs Entra ID P1 or P2. Nested groups are
  not honoured, so membership must be direct.
- The `groups` claim is restricted to **"Groups assigned to the
  application"**. This emits only those groups' object IDs and keeps the
  token below the group-overage limit.
- **Conditional Access** (MFA or a compliant device) applies to the app
  (shared-contracts §6).

**Default role.** A token with a missing or empty `roles` claim, or only
unknown values, means **`internal-viewer`**. Entra's "Default Access"
assignment emits no `roles`. Unknown values never grant anything.

**Group mapping** (Settings; `internal-admin` only; audited):
`{ groupId, target: { type: "team" | "department", id }, scopedRole }`.
It maps Entra groups to internal teams or departments and **scoped** roles.
It is LiteLLM's `team_ids_jwt_field` plus team-role assignment.

**Resolution at every sign-in** (deterministic; the sync step):
1. Take the token's groups that have a mapping.
2. **None, an empty claim, or no claim.** No SSO affiliation. Keep a
   UI-sourced affiliation if one exists. Otherwise **no team is set, and
   the user is `internal-viewer`**. They see *My usage* and "Ask your team
   lead for access".
3. **Admin-scope mappings** (`scopedRole: internal-team-admin`). Every
   mapped target becomes an SSO-sourced admin scope; there may be several.
   The sync adds and removes SSO-sourced admin scopes so they match the
   mapped groups exactly. UI-sourced admin scopes are never touched.
   Each change is audited with actor `system`.
4. **Member mappings, exactly one target.** Apply it as the SSO member
   affiliation (`source: "sso"`). It replaces a UI-sourced affiliation
   (audited, actor `system`).
5. **Member mappings, several distinct targets.** The mapping is
   ambiguous: apply none (fail closed), keep only a UI-sourced affiliation,
   and flag the user in Settings. Ambiguity never blocks admin scopes.
6. **Group overage** (`_claim_names` or `hasgroups` instead of `groups`).
   Treat it as case 2 and flag the user. SSO-sourced admin scopes are
   suspended until a sign-in with a full claim. v1 makes no Microsoft Graph call.

**Precedence: SSO-sourced > UI-sourced > none.**
- Precedence applies per item: the member affiliation, and each admin
  scope.
- A UI change to an SSO-sourced item returns `409 MANAGED_BY_SSO`. The
  change is made in Entra instead.
- A UI-sourced admin scope may be added alongside SSO-sourced ones, and it
  is kept across sign-ins.

**Timeliness.**
- Entra role and group changes take effect at the next sign-in. The session
  cap bounds the delay: 8 hours, or **4 hours for a session holding
  `internal-admin` or `internal-org-admin`**.
- In-app changes are read per request, so they take effect on the next
  request (§1.6 item 4).

### 1.3 Sign-in methods

| Method | Where | Role |
|---|---|---|
| Entra ID (OIDC) | All environments; **required in `prod`** | From the token (§1.2) |
| **Master user** (username and password) | All environments; the only password login in `prod` | Always `internal-admin` |
| Local users (no password) | **Outside production, and only while Entra is not configured** | As set in Settings; the built-in default local identity is `internal-admin` |

**Master user** (break-glass and first-time setup). It is an exception to
System Architecture *Sign-in providers* ("no production password login").
R0 amends that section.
- **Credentials.**
  - The username is `AUTH_MASTER_USERNAME`.
  - Only an **Argon2id hash** of the password is kept, in an SSM
    SecureString injected through the task definition's `secrets`. It is
    never in the repo, the image or DynamoDB.
  - Both go through `env.ts`. When they are absent, the method is not
    offered.
- **Second factor.** TOTP is required in `prod`. Its secret is also an SSM
  SecureString.
- **Verification.** Constant-time, with generic error messages.
- **Lockout.** After 5 failures, for 15 minutes. This is the one recorded
  exception to "no rate limiting" (§1.6 item 6).
- **Session.** Capped at 1 hour.
- **Audit and alarm.** Every sign-in, failure and lockout is audited and
  alarms.
- **Identity.**
  - A fixed, namespaced `oid` (`master:`) that never collides with an Entra
    `oid`.
  - It cannot be demoted or deleted in the app.
  - It is listed in the access review.
- **Operations.** The runbook covers:
  - sealed custody of the credentials, with two people
  - rotation after every use, and at least yearly
  - a quarterly test sign-in

**Local users** (development convenience).
- An `internal-admin` adds users and sets their roles in Settings
  (`LocalUser`, `/api/local-users`, audited). The last local
  `internal-admin` is protected (`409`).
- Each local user gets a deterministic fake `oid` and a placeholder `tid`,
  so binding and links behave as in production.
- **While Entra is configured,** the section is hidden, `/api/local-users`
  returns `404`, and stored local users are ignored.
- The existing production fail-closed checks are unchanged (env and
  runtime).
- The e2e forged-session helper gains `role`, `scopedRole`, `affiliation`
  and `oid` options.
- No production bypass exists (Rule 70.11).

### 1.4 Visibility and inheritance

There are settings per team, plus one per department.
- **Who edits them:** `internal-admin`, `internal-org-admin`, and the lead
  whose scope covers them.
- **Defaults:** least privilege. A missing item means the defaults.

| Setting | Values | Default |
|---|---|---|
| Team level: members see this team's totals and breakdowns (Team Detail; the team's rows on Teams, Services, Ranking) | `visible` / `hidden` | `visible` |
| User level: per-user rows for this team | `all` / `own` / `none` | `own` |
| Department level: the department's totals (Departments card, Department Detail, department rows in Overview and Ranking) for the department's lead and members | `visible` / `hidden` | `hidden` (a department total reveals sibling teams' aggregate spend) |
| Department cap: `maxUserLevel` for its teams | `all` / `own` / `none` | `own` |

**Inheritance: a child narrows its parent.** This follows LiteLLM's rule
that a key and its team must both allow, so the child never exceeds the
parent.
- `effective = min(organisation cap, department cap, team setting)`.
- The orders are `hidden < visible` and `none < own < all`.
- The **organisation cap** is the per-user approval gate (shared-contracts
  §6). In `prod`, the user level is capped at `own` until an
  `internal-admin` records the works-council or data-protection approval.
  Until then, leads see team totals and per-user **counts** only.
- A team setting above its department cap is stored, but **applied as the
  cap**, and shown as "limited by department".
- **Scoped views.** Organisation-wide views for anyone below
  `internal-org-admin` show only in-scope data, labelled "your teams".
  They never include out-of-scope cost.
- **Privacy.** Per-user cost is personal data. The spec states the legal
  basis and retention as a **user decision** (DPO or HR input); the run
  proposes wording only.

**Evaluation order.** `resolveScope` is one pipeline. Any failure denies
(`401`, `403` or `404`, per §1.6 item 2):
1. token valid (issuer, `tid`, `oid`, session cap)
2. global role (§1.2 default)
3. affiliation (SSO > UI > none)
4. scoped role
5. inherited caps
6. `can(action, resource)`

### 1.5 Affiliation and lifecycle (joiner, mover, leaver)

Access comes from **explicit affiliation**, never from usage data.
Deriving it from `byUser` would exclude people who never call Bedrock, and
would admit anyone who once used an account.

- **Member affiliation: at most one team.** A user is a member of **at
  most one** team. Its department is implied per day by the rollups
  (*Historical Snapshots*).
  - The record is `{ teamId, source: "sso" | "ui", version, updatedBy,
    updatedAt }`.
  - There is one item per user, so the key design enforces "single team".
- **Admin scopes: one or more.** A lead may hold `internal-team-admin` on
  **one or more** teams and/or departments.
  - Each scope is its own item: `{ type: "team" | "department", id,
    source: "sso" | "ui", grantedBy, grantedAt }`.
  - An admin scope implies read access to that team or department, so no
    member affiliation is needed for it.
  - The lead's own member team, if any, is independent of their admin
    scopes.
- **Overseeing several teams.** Grant several team scopes, or one
  department scope. A department scope also covers teams added to the
  department later.
- `internal-admin`, `internal-org-admin` and `internal-auditor` need no
  affiliation or scope.
- **Department scope is per day** (decision W3). A team that moved
  department counts for the old department's lead and members only for
  its pre-move days. Teams created later fall into the department
  automatically.

**Joiner.**
- A lead enters a work email or UPN, stored as a **pending** affiliation.
- At first sign-in it is **bound to the `oid`**. Binding needs the
  configured `tid` and a case-insensitive `preferred_username` or `email`
  match. It is audited with actor `system`.
- After binding, `oid` is the key, so a UPN change or UPN reuse cannot
  redirect it.
- An SSO mapping at the same sign-in wins, and the invite is discarded
  (audited).
- No Graph permission and no client secret is needed.
- A pending affiliation grants nothing.

**Mover.** Moving a user to another team:
- needs authority over **both** the source and the destination
- is **one atomic transaction** (`TransactWriteItems` with the `version`
  condition), with one `affiliation.move` audit record
- **removes the user's team-scope admin on the source team** in the same
  transaction, so no privilege carries over. Admin scopes on other teams and
  departments are unaffected
- is refused for an SSO-sourced affiliation (`409 MANAGED_BY_SSO`)

Adding a user who already has an affiliation returns
`409 ALREADY_AFFILIATED`; use move instead.

**Leaver.**
- A user disabled in Entra cannot sign in. Their affiliation and grants
  then grant nothing.
- Settings lists **stale** entries for cleanup:
  - pending affiliations not bound after 30 days
  - affiliations and in-app grants whose user has not signed in for 90 days
- R0 confirms both windows.

**Permission matrix:**

| Action | `internal-admin` | `internal-org-admin` | `internal-team-admin` (department scope) | `internal-team-admin` (team scope) | Others |
|---|---|---|---|---|---|
| Add an unaffiliated user (or pending email or UPN) to a team | ✓ | ✓ any team | ✓ teams in dept | ✓ own team | ✗ |
| Grant or remove a team-scope `internal-team-admin` (a user may hold several) | ✓ | ✓ any team | ✓ teams in dept | ✓ teams in their own scope; never themselves | ✗ |
| Make or remove a department-scope `internal-team-admin` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Remove a member (becomes unaffiliated) | ✓ | ✓ | ✓ | ✓ own team | ✗ |
| Move a user to another team | ✓ | ✓ | ✓ both teams in dept | ✗ (remove; the destination lead adds) | ✗ |
| Edit visibility | ✓ | ✓ | ✓ dept and its teams | ✓ own team | ✗ |
| Grant or revoke `internal-org-admin` or `internal-admin` | ✓ **only** | ✗ | ✗ | ✗ | ✗ |
| Configuration (§1.1) | ✓ | ✗ | ✗ | ✗ | ✗ |

**Identity links and usage identities** are defined in shared-contracts §3:
`usageIdentities[]`, `aliases[]` and `litellmUserId`.
- They are `internal-admin` only.
- They show a person their own usage and **never grant access**.
- The canonical usage key is the email after the SSO prefix, lower-cased
  (shared-contracts §3.1).

**Access review.** It runs quarterly. `internal-admin` and
`internal-auditor` export it (shared-contracts §6). It lists every
identity with:
- global roles and their source
- affiliation and its source
- `lastSignInAt`
- flags: ambiguous, overage, stale, and an Entra role removed while an
  in-app grant remains

The export is audited.

**Storage.** Use the existing DynamoDB table, not Aurora Serverless v2.
- The data is small and key-addressed.
- The single-team member invariant is in the key design; admin scopes are separate items.
- Moves are atomic with `TransactWriteItems`.
- Aurora would add a VPC-bound cluster, credentials, migrations and
  connection handling, against shared-contracts §7's minimum-resources
  rule. Its auto-pause also adds resume latency.
- **Revisit trigger:** per-request relational reporting, more than about
  100k identities, or SQL access for finance tools. Adopting it is a spec
  amendment.

**Data-model and API deltas** (R0 applies them to the Data Model spec).
- **Entities:**
  - `IDENT#{oid}/AFFILIATION` (member, at most one), with GSI1 `MEMBERS#TEAM#{id}`
  - `IDENT#{oid}/ADMINSCOPE#{TEAM|DEPT}#{id}` (one or more), with GSI1 `ADMINS#{TEAM|DEPT}#{id}`
  - `PENDING#{emailOrUpn}/AFFILIATION`
  - `GROUPMAP#{groupId}/META`, with GSI1 `GROUPMAPS`
  - `ROLEGRANT#{oid}/{role}`
  - `VIS#{TEAM|DEPT}#{id}/META`
  - `LOCALUSER#{email}/META`
- **Routes:**
  - `/api/group-mappings[/{groupId}]`
  - `/api/teams/[id]/members[/{oid}]`
  - `/api/affiliations/[oid]/move`
  - `/api/role-grants[/{oid}/{role}]`
  - `/api/teams|departments/[id]/visibility`
  - `/api/local-users[/{email}]`
  - `/api/identities`, `/api/audit`, `/api/access-review`, `/api/me`,
    `/api/me/usage`, `/api/health`
- **New `409` codes:** `CONFLICT`, `MANAGED_BY_SSO`, `ALREADY_AFFILIATED`.
  **New `403` code:** `REAUTH_REQUIRED`.

**Alternative, for R0 to record but not adopt:** membership read from
Entra group owners through Microsoft Graph. It needs Graph permissions and a
secret, and brings back overage handling.

### 1.6 Enforcement and data rules

1. **A single policy module.**
   - `lib/auth/` exposes a pure scope resolver, roughly `resolveScope(session,
     settings, assignments) → Scope`, plus `can(scope, action, resource)`.
   - Every Route Handler and Server Component calls them after the session
     check and before returning data.
   - The UI hides what the scope hides, but hiding is never the control
     (Rule 10).
2. **Status codes.**
   - Reading an out-of-scope or nonexistent detail returns `404` with the same
     body, so ids cannot be probed.
   - An unauthorised write returns `403`, checked before input parsing
     (Rule 10.3 as amended).
   - Lists contain only in-scope rows.
3. **Aggregates are computed after filtering.**
   - Every total, "% of Total", count, top-N list, "most used model", trend
     and comparison is computed only from in-scope rollups and in-scope
     attribution.
   - Nothing out of scope may be inferable from a difference between two
     visible numbers.
4. **Caching cannot leak.**
   - `unstable_cache` entries stay scope-independent (raw rollups per UTC day).
     Filtering happens after the cache read, outside the cache, like the
     session check (Rule 60.10).
   - **Authorization data is never cached:** roles, role grants, affiliations, group mappings,
     visibility, identity links and toggles are read per request.
   - **No cross-task cache invalidation is relied on** (§1.8). Data that
     dashboard writes change is never cached, and only the hourly rollups
     are.
   - Every `/api/*` response sets `Cache-Control: private, no-store` (or the
     framework equivalent), so no CDN or shared cache stores scoped data. This
     includes the shared ALB and any proxy in the company network.
   - Because that data is uncached, writes to visibility, scopes or links
     take effect on the next request on every task. No `revalidateTag` is
     needed for them.
5. **Exports and search are scoped too:** CSV export, the command menu,
   search, and links in tables and cards.
6. **Writes.**
   - **Validation:** Zod-validated, and the body's `teamId`/`departmentId`
     must match the path.
   - **Concurrency:** writes are optimistic. A `version` attribute is updated
     with a DynamoDB conditional write; a conflict returns `409`. Document the
     new `409` in Data Model *HTTP status codes*.
   - **Origin:** write routes verify same-origin (an `Origin`/`Host` check)
     in addition to the SameSite session cookie (delivered 2026-11-11 in
     `withRoute`; R4 extends coverage to its new write routes, not a second
     implementation).
   - **Structural test:** `write-routes.integration.test.ts` enumerates every
     write route with its required permission, so none ships ungated.
   - **No rate limiting of the dashboard's own routes** (decided 2026-11-09).
     - The dashboard is internal, behind the company VPN (§1.8), with no edge
       WAF and no per-user write counters.
     - Request and token rate limits are **LiteLLM's**. `internal-admin` and leads
       configure them through LiteLLM's API (`litellm_prompt.md` §1.3,
       *Rate limits*), and LiteLLM enforces them.
7. **Timeliness of changes.**
   - As in §1.2 *Timeliness*: Entra changes apply at the next sign-in. The
     session cap is 8 hours, or 4 hours with `internal-admin` or
     `internal-org-admin`, and 1 hour for the master user.
   - Affiliation, role-grant, mapping, visibility and identity-link changes
     are read per request, so they apply on the next request. That includes
     removing a member.
8. **Audit log** (required for company use). The schema, semantics and
   storage are defined in shared-contracts §4. That includes the dedicated
   CloudWatch Logs group for SIEM export. The details below are summarised
   from it.
   - Every write to role grants, group mappings, affiliations (add, remove, move, promote, pending-to-bound),
     visibility, identity links and accounts appends an audit record.
     `litellm_prompt.md` writes to the same log.
   - **Shared schema:** actor `oid` (or `system` for a sign-in bind),
     action, target, `teamId` (when there is one), before and after
     (sanitised: never secrets or key values), `result` (`success` |
     `failed`), timestamp (UTC) and request id.
   - **Shared semantics:**
     - a successful write creates exactly one `success` record
     - a write that passed authorization but failed downstream creates
       exactly one `failed` record
     - a write rejected with `400`/`401`/`403`/`404`/`409` creates none
   - Records are append-only in DynamoDB, with retention set in R0
     (recommendation: at least 1 year).
   - Admins can view them in Settings.
   - An OpenTelemetry event goes out with ids only: no names, emails or cost
     values (Rule 50.6).
9. **Observability.**
   - Count authorization denials (403/404 from the policy) as a metric with no
     personal data.
   - Never log tokens, claims or session contents.
9a. **Cloud permissions.** This feature adds DynamoDB **writes** from the
    dashboard: affiliations, role grants, group mappings, local users, visibility, identity records and links,
    and audit records. The dashboard's AWS credentials are read-only today
    (`docs/guides/dashboard-deployment.md` §2).
    - **R0 defines the least-privilege ECS task role** (DashboardServiceStack, §1.8),
      shared with `litellm_prompt.md` §1.2 item 6a:
      - DynamoDB reads on the table and GSI1
      - writes limited by `dynamodb:LeadingKeys` to this feature's
        partition-key prefixes and `ACCOUNT#` (Phase 4.9)
      - audit-log items with `PutItem` only (no `UpdateItem` or `DeleteItem`,
        so the log stays append-only)
      - nothing else
    - **Credentials** come from the task role through the default chain, so
      there are no static keys (Rule 50.1). Hosting and the CDK layout are in
      §1.8.
    - Runs write and synthesise the CDK and assert the policy. They never
      deploy.
10. **Rollout safety.**
    - **Flag.** One env flag, `AUTH_ACCESS_MODE` (`open` | `enforce`), goes
      through `env.ts` (Rule 50.2).
    - **Default.** It is `enforce` in `prod` (shared-contracts §1: the only
      environments are `dev` and `prod`). `open` exists only to
      stage the migration outside production.
    - **Fail closed.** An unset or invalid value means `enforce`. The environment comes from a validated `APP_ENV` (`dev` | `prod`) in `env.ts`, never from `NODE_ENV` (a deployed `dev` task also runs with `NODE_ENV=production`).
    - **No external admin in `open` mode.** While it is `open`, every write
      route except account CRUD for `internal-admin` returns `403`, and every LiteLLM
      route is disabled (`litellm_prompt.md` §1.2 item 9a).
    - **Runbook.** `docs/guides/auth-setup.md` covers creating the groups,
      assigning app roles, restricting the `groups` claim to assigned groups,
      turning on "Assignment required", creating group mappings, sealing the
      master-user credentials, testing with one user per role and scope
      case (the acceptance checklist), then enforcing.
11. **Local development and tests.**
    - Sign-in methods and local users are defined in §1.3. The default
      local identity is `internal-admin`. Local users cover every role and
      affiliation case.
    - The e2e forged-session helper gains `role`, `scopedRole`,
      `affiliation` and `oid` options.
    - No production bypass exists (Rule 70.11).
12. **Unchanged guarantees:**
    - UTC days and USD
    - cost provenance and estimates (Rule 20.3)
    - the server-only boundary
    - the `{ data }` / `{ error }` shape
    - the 8-hour session cap
    - no real tenant IDs, group IDs or account IDs committed; docs use
      placeholders (Rule 50.9)

### 1.7 Out of scope

- Phase 6 and the collector (including building the CollectorStack), and any
  AWS call or deploy. CDK may be written, synthesised and asserted (§1.8);
  deploying it is a user action.
- Real Entra tenant changes. That is the user's job; the run documents the
  exact steps.
- Row-level security in DynamoDB itself.
- Self-service access requests and approval workflows (propose them only).
- Department-level caps on team visibility (propose them only).
- A directory people-picker through Microsoft Graph, and Entra-group-owned
  membership (§1.5 *Alternative*). Propose them only.

### 1.8 Platform

The AWS hosting and IaC layout (ECS on Fargate, ALB reuse or creation, the
created-resources list, the CDK stacks) is defined **once**, in
`shared-contracts.md` §7. Unit **RP** (§2) builds it. References in this file
to "§1.8" mean that section.

## 2. Units and phase placement (Rule 30)

This work cuts across shipped pages, so it enters the plan through a spec
unit before any code.

| Unit | Branch | Content | Depends on |
|---|---|---|---|
| **R0: spec and threat model** | `docs/rbac-entra-roles` | See the R0 scope below this table, including every shared-contracts decision | — |
| **RP: platform** | `feature/phase-<n>-platform` | The `infra/` CDK app: FoundationStack and DashboardServiceStack per shared-contracts §7, both ALB modes, the ECS service and task definition for the existing dashboard, the `/api/health` route with dependency checks (§8 there), alarms (§8), the CI deploy role. Synthesised and asserted, never deployed | R0 |
| **R1: identity, roles and sign-in** | `feature/phase-<n>-rbac-identity` | The `lib/auth` role model (§1.1: global and scoped roles, union, default `internal-viewer`, the legacy `Admin` alias, fail-closed parsing of `roles`, `groups`, `oid` and `tid`); `oid`/`tid` in the session; the `auth.ts` mapping; the identity record with `lastSeenRoles`; session caps (8 h / 4 h / 1 h); the master user (§1.3: Argon2id hash, TOTP, lockout, audit); local users (§1.3); the "no access" page; `AUTH_ACCESS_MODE` in `env.ts`; `internal-auditor` (read everything, every write `403`); the dev login and e2e helper for every role | R0, RP |
| **R2: authorization data** | `feature/phase-<n>-rbac-data` | The ECS task role's DynamoDB policy for this unit, added to RP's DashboardServiceStack (synthesised and asserted, never deployed); the shared usage-identity canonicaliser (shared-contracts §3.1), applied on read; identity links (unique per person); the audit log to DynamoDB and the CloudWatch audit group (shared-contracts §4); entities and `server-only` data access for affiliations (pending and bound), group mappings, in-app role grants, visibility and caps, local users and the audit log; **sign-in resolution** (§1.2: mapping → affiliation, ambiguity and overage flags, pending bind; audited); atomic move (`TransactWriteItems`); versioned conditional writes; Zod schemas in `packages/shared`; seeds for every role and affiliation case | R0, R1 |
| **R3: server-side scoping** | `feature/phase-<n>-rbac-scope` | The policy module (`resolveScope` with the §1.4 evaluation order and inheritance caps, and `can`); every read Route Handler and Server Component filtered; aggregates computed after filtering; `404` parity; `Cache-Control: private, no-store`; authorization data read uncached (§1.6 item 4); scoped CSV, search and command menu; the role × route matrix and leak tests | R1, R2 |
| **R4: management UI and writes** | `feature/phase-<n>-rbac-settings` | Settings per §1.5's matrix: members (add by email or UPN, remove, promote, demote, move, pending and stale lists); visibility and department caps; group mappings, role grants (re-auth and reason), identity links, local users, and the per-user approval (all `internal-admin`); the audit log view and the access-review CSV (`internal-admin`, `internal-auditor`; both audited); write routes with permission, origin, re-auth and `409` handling; the structural write-route test updated; accessible forms (Phase 5 floor: axe clean, keyboard, focus) | R3, plus Phase 4.9's Settings shell |
| **R5: UI gating and copy** | `feature/phase-<n>-rbac-ui` | Navigation and pages reflect scope: "your teams" labels, "not visible", "limited by department" and "no access" states, no dead links. **Role-aware landing:** `internal-viewer` and member land on *My usage* (direct Bedrock usage via usage identities; LiteLLM is added in L6); leads on *My team* or *My department*; `internal-org-admin`, `internal-admin` and `internal-auditor` on the Overview | R3 |

**R0 scope:**
- **Specs amended:**
  - System Architecture *Authentication & Access* (roles, scopes, deny by
    default, the identity link, the audit log, rollout)
  - Data Model (new entities and keys, access patterns, the API Routes table,
    status codes including `409`, Rule 10.3 wording, and the shared
    error-code registry that `litellm_prompt.md` L0 extends)
  - Design System (Settings sections, the empty and no-access states, the
    "your teams" labels)
  - `auth-setup.md` (portal steps, licensing, break-glass, the rollout runbook)
  - implementation-phases (insert RP and R1–R5 as sub-phases with tasks and
    Verify items, after 4.9 and before LiteLLM L0–L8 and Phase 5; see
    `README.md`)
  - the AWS hosting and CDK layout (§1.8) and the task-role policy (§1.6
    item 9a), jointly with `litellm_prompt.md` L0
  - the inputs and both ALB modes (§1.8): how the imported VPC, subnets,
    certificate and optional listener ARN are supplied (SSM names or CDK
    context), the company CIDRs for create mode, the dashboard hostname and
    the listener-rule priority
- **Decisions to record**, each with problem, options, recommendation and the
  choice:
  - the role model (§1.1): global plus scoped roles, the `internal-*`
    prefix, `internal-org-admin`, and in-app global-role grants by
    `internal-admin` only
  - at most one member team but one or more admin scopes, SSO > UI > none precedence per item, and the empty-group
    default (§1.2, §1.5)
  - affiliation managed explicitly in the app (recommended), with Entra
    group-owner membership as the recorded alternative; the stale windows
    (30 and 90 days)
  - the visibility defaults and inheritance caps (§1.4)
  - the master user and its controls, as an amendment to *Sign-in
    providers* (§1.3)
  - the session caps: 8 h, 4 h for global admin roles, 1 h for the master
    user
  - DynamoDB versus Aurora Serverless v2, with the revisit trigger (§1.5)
  - audit retention (400 days recommended; **user**)
  - privacy wording, proposed for the user to approve
- **A short threat model** (spoofing, elevation, information disclosure
  through aggregates and caches, repudiation through the audit log), with each
  threat mapped to a test.
- **Gate:** `spec-guardian` reviews until APPROVE.

- **One unit per branch, one squash commit each** (Rules 30.4 and 70.10). A
  run's Track B target is the first unit not done. Later units are out of that
  run's scope (§6).
- **Each code unit runs the Rule 70 loop:**
  1. tdd-test-engineer (sonnet) writes the failing tests.
  2. typescript-developer (sonnet) makes them pass.
  3. Review on opus, **once per unit** when it is green (Rule 70.12):
     quality-reviewer, plus spec-guardian only when the unit changed specs or
     rules, playwright-ui-reviewer for UI changes, and ecc:security-reviewer
     for R1–R4 if installed. Otherwise quality-reviewer covers security
     explicitly and the report says so. Re-reviews after REQUEST CHANGES are
     delta-scoped.
- **R3 and R4 add a dedicated security pass inside that one review.**
  quality-reviewer is briefed with the threat model and asked to try to
  break the policy.
- **Token economy (Rule 70.12):** iterate with targeted test runs; only new and impacted tests on the branch
  (`vitest run --changed <merge-base>`); the full `pnpm check` once, on the
  `main` candidate; read results, never full logs.

## 3. Correctness checklist (tests must assert these)

- **Usage identity.**
  - The canonicaliser maps `assumed-role/AWSReservedSSO_X_Y/Jane.Doe@Company.com`
    and `AROAEXAMPLE:jane.doe@company.com` to `jane.doe@company.com`.
  - A non-email session name stays `kind: "non-person"`.
  - An alias or usage identity can belong to only one person; a duplicate
    returns `409`.
  - A Viewer's *My usage* includes exactly their keys and aliases.
- **Auditor.** Reads everything. Every write route returns `403`. Viewing or
  exporting the audit log or the access review is itself audited. Auditors
  never see key values.
- **Works-council gate.** In `prod`, the user level is capped at `own`, and
  leads see counts only, until the approval record exists. The switch is
  `internal-admin` only and audited.
- **Identity and roles.**
  - A missing or empty `roles` claim, or only unknown roles, means
    `internal-viewer`; with no affiliation, that means no team data.
  - A `roles` or `groups` claim that is present but not an array, a missing
    `oid`, or a foreign `tid` means no session.
  - Roles combine as a union. A user with no scoped role has
    `internal-viewer` rights only.
  - The legacy `Admin` is accepted as `internal-admin` only while the alias
    is enabled.
  - Only an `internal-admin` can grant or revoke `internal-admin` or
    `internal-org-admin`. Every other role gets `403`.
  - Grants need a re-authentication within 15 minutes and a reason.
  - The last `internal-admin` cannot be revoked (`409`).
  - A group mapping that targets a global role is rejected.
  - `internal-auditor` can never be granted in the app.
  - **Master user:**
    - always `internal-admin`, and cannot be demoted
    - only the hash is stored
    - TOTP is required in `prod`
    - locks out after 5 failures for 15 minutes
    - 1-hour session
    - every attempt is audited
  - **Local users:** an `internal-admin` sets their roles. The last local
    `internal-admin` is protected. With Entra configured,
    `/api/local-users` returns `404` and local roles are ignored.
- **SSO resolution** (§1.2), one table test per case:
  - no, empty or unmapped groups → no team, `internal-viewer`
  - one member target → that affiliation
  - several admin-scope targets → all of them as SSO admin scopes; a removed group removes its scope at the next sign-in
  - several targets → none, and a flag
  - overage → none, and a flag
  - SSO replaces a UI affiliation
  - a UI edit of an SSO affiliation → `409 MANAGED_BY_SSO`
- **The role × route matrix.**
  - **Routes:** every Route Handler, tested against DynamoDB Local.
  - **Callers:**
    - unauthenticated; malformed token
    - `internal-viewer` with no affiliation, a pending affiliation, or a
      removed affiliation
    - member: own team, another team
    - `internal-team-admin` (team scope): own team, another team
    - `internal-team-admin` (department scope): a team in the department, a team outside it, a
      team that moved mid-range
    - `internal-org-admin`, `internal-auditor`, `internal-admin`, and the
      master user
  - **Assertions:**
    - `401`; `403` before parsing; `404` parity (identical bodies for
      out-of-scope and missing)
    - lists contain only in-scope rows
- **Leak tests.**
  - Changing the cost of an out-of-scope team changes **no** number the
    caller can see: totals, %, counts, top-N, trends, comparisons, CSV.
  - With department visibility `hidden`, a department total cannot be
    reconstructed from the visible team rows plus any visible total.
- **Visibility and inheritance.**
  - Team `hidden` removes the team everywhere for its members.
  - User `own` shows exactly the caller's row through the identity link;
    `none` shows no per-user data.
  - A team setting above the department cap applies as the cap.
- **Affiliation and lifecycle.**
  - A pending affiliation grants nothing until it is bound.
  - Binding needs a matching `tid` and a case-insensitive UPN or email
    match, and happens once. A later UPN change, or UPN reuse, does not
    move it.
  - A user is a member of at most one team. Adding an affiliated user
    returns `409 ALREADY_AFFILIATED`.
  - A user can hold `internal-team-admin` on several teams and departments
    at once. Each scope grants exactly its own team or department.
  - A move needs authority over both teams, is atomic, writes one audit
    record, and removes the team-scope admin on the source team only.
  - A team-scope `internal-team-admin` cannot remove their own scope,
    cannot move users, and cannot act outside their scopes.
  - Removal takes effect on the next request.
  - Usage data alone (appearing in `byUser`) grants nothing.
- **Writes.**
  - **Permissions:** every cell of §1.5's matrix, including that
    `internal-org-admin` cannot reach configuration or grant global roles.
  - **Request checks:** a body/path id mismatch returns `400`; a stale
    `version` returns `409`; a cross-origin write is rejected.
  - **Audit:** each write behaves as the shared semantics in §1.6 item 8
    state: one `success` record; one `failed` record for a downstream
    failure; none for a rejected request.
- **Caching.**
  - Two callers with different scopes, requested back to back, never see
    each other's rows.
  - Every `/api/*` response carries `Cache-Control: private, no-store`.
- **Rollout.** `AUTH_ACCESS_MODE` that is unset or invalid behaves as
  `enforce`, and `open` is rejected when `APP_ENV=prod` (the validated environment switch; Access Control spec — *Environment*).
- **No regressions.** Every existing page test still passes for
  `internal-admin`. Existing guarantees (§1.6.12) hold.

## 4. Verification (in addition to `master_prompt.md` §8)

- Run the gates on each unit branch, then again on `main` after each squash
  merge: `pnpm check` and `pnpm test:e2e`.
- **Seeded probe per role** (R3–R5): a temporary unstubbed spec, never
  committed, against DynamoDB Local.
  - **Setup:** prepare scopes, visibility and identity links.
  - **Run:** sign in through the dev login as each role and scope case, and
    assert what each one sees on every page.
  - **Repeat:** read each API twice, so the data cache refreshes before the
    checks.
  - **Record:** the per-role counts go in the report.
- **Entra configuration** cannot be verified locally; that is a user action.
  The run documents the portal steps and a manual acceptance checklist (one
  test user per role and scope case) in `docs/guides/auth-setup.md`.

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

The report's Track A inventory adds a row per unit R0, RP, R1–R5. It also adds a
role × route matrix summary and a threat-to-test traceability table.

## 6. Completion criteria (what "Completed" means)

A run is **Completed** when all of these hold:

1. Its Track B target, the first unit (in the order R0, RP, R1–R5) not done, is done, reviewed
   (Rule 70 APPROVE, every blocker resolved or recorded with a reason) and
   verified by the orchestrator's own gate runs. For R3–R5, the per-role
   seeded probe has passed too.
   **Under a coordinator** (`.claude/prompts/coordinator_prompt.md` §4, decided 2026-11-15,
   user): the review and the full gate run once per batch and belong to the
   coordinator, so a worker's run is complete at "ready to merge" with a
   green branch gate (typecheck, lint, format, impacted tests) and every
   red test from the run green.
2. Units after the target are **out of scope for that run** and do not count
   against completion.
3. The report exists by T+60, is marked on time, and lists every user action.

A run also ends **legitimately**, recorded as Partially completed or Blocked
and not as a failure of these criteria, when either of these happens:
- **A usage freeze (§2):** consolidate and write the report immediately.
- **The T+60 deadline:** after T+55, only the report.

User-only actions never count against completion:
- `git push` and CI results
- Entra portal configuration (groups, app roles, "Assignment required")
- choosing the privacy and legal wording and audit retention, where R0 marks
  them as needing the user
- switching production to `enforce` after the acceptance checklist
- `cdk deploy` of any stack, and the AWS account bootstrap
- supplying the existing VPC, subnet and certificate identifiers, and either
  the LiteLLM ALB listener ARN (plus an agreed rule priority) or the company
  CIDRs for a new internal ALB
- the internal DNS record for the dashboard host
- generating the master-user password hash and TOTP secret, storing them as SSM SecureStrings, and sealing the credentials (§1.3)
- creating the group mappings for real Entra group object IDs (never committed)
- applying Conditional Access (MFA or compliant device) to both app
  registrations
- recording the works-council or data-protection approval in Settings before
  per-user views are enabled in `prod`
- the existing SNS topic ARN for alarms
- confirming that the Transit Gateway routing reaches Entra ID and the AWS
  service endpoints

If this prompt is tracked with `/goal`, use this exact condition:
**"prompts/rbac_prompt.md §6 completion criteria met for this run's target unit, and
the report written — or the run ended by a usage freeze or the T+60 deadline
with the report written."**
Never use the bare file path or "all units done": those conditions cannot be
met in one run, and they make the goal check loop.
