# Goal Prompt: Role-Based Access from Entra ID — Bedrock Cost Dashboard

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
   - `apps/dashboard/app/api/write-routes.integration.test.ts`
   - `apps/dashboard/e2e/support/session.ts`
   - `apps/dashboard/lib/api/load-range-rollups.ts` (caching)
6. `.claude/rules/10, 20, 30, 50, 60, 70`, and every `temp/report_*.md`.

## 1. Mission

Replace "every signed-in member sees everything" with three roles sourced
from Entra ID. Each lead is limited to a **scope** of teams or departments,
and every decision is **enforced on the server and audited**.

### 1.1 Roles

| App role (value) | Who | Reads | Writes |
|---|---|---|---|
| `Viewer` | Regular users | What the visibility settings allow for the teams and departments they are members of (§1.4, §1.5) | Nothing |
| `Lead` (display name "Team / Department Lead") | Leads of one or more teams, or of whole departments | Everything inside their assigned scopes | Visibility settings and Viewer membership inside their scopes, and nothing else |
| `Auditor` | Security, compliance and finance reviewers | Everything, read-only, organisation-wide, including the audit log and the access review (shared-contracts §2) | Nothing |
| `Admin` (existing value; kept for backward compatibility) | Platform administrators | Everything | Everything: account CRUD (Phase 4.9), lead scope assignments, any membership, any visibility setting |

- **Deny by default.**
  - A signed-in user with none of these roles gets no data. They see a
    "no access, contact your administrator" page, not a Viewer view.
  - On the Entra enterprise application, **"Assignment required?" = Yes**, so
    unassigned users cannot sign in at all.
- **Several roles at once.** Permissions are the union, so `Admin` covers
  everything. A `Lead` with no assigned scope has Viewer rights only.
- **Role names live in one place.** Values and checks live only in
  `apps/dashboard/lib/auth/` (Rule 50.3). No role strings appear in routes or
  components.

### 1.2 Identity source: Entra ID groups mapped to app roles

- Create Entra **security groups**, for example `bedrock-dashboard-viewers`,
  `-leads` and `-admins`. Assign them to the app roles on the enterprise
  application.
  - The ID token's `roles` claim then carries the values. App roles are used,
    not raw `groups` claims: they need no group-ID mapping in code and are not
    subject to the group-overage limit (this is the existing rationale in the
    spec).
- **Licensing and limits to document:**
  - Assigning *groups* to app roles requires Entra ID P1 or P2. Without it, the
    roles must be assigned to users directly.
  - Nested groups are not honoured for app-role assignment, so membership must
    be direct.
- **Stable identity.**
  - Key users by the token's `oid` (object ID) together with `tid` (tenant).
    `email` and `preferred_username` (UPN) are display attributes only, because
    they can change.
  - Add `oid` to the JWT and to `session.user`, Zod-parsed like `roles` already
    is. A token without `oid` fails closed.
  - The dev-only login issues a deterministic fake `oid`, `tid` and email per
    local identity, so the identity record, binding and links work the same
    locally.
  - **Identity record.** At each sign-in, upsert an identity record `oid →
    { tid, email, upn, lastSignInAt }` in DynamoDB. `email` and `upn` are
    lower-cased.
    - It is the one place that maps a person to their attributes.
    - Membership binding (§1.5), the usage identities (shared-contracts §3) and the
      LiteLLM user link (`litellm_prompt.md` §1.3) all read it.
- **Who may grant `Admin`.** `Admin` is granted **only in Entra**, through
  group membership. The app can never grant or revoke `Admin`. Admins grant
  lead *scopes* in the app; the `Lead` role itself comes from Entra.
- **Break-glass.** Document that at least two `Admin` holders must exist,
  plus the tenant's break-glass procedure, in `docs/guides/auth-setup.md`.

### 1.3 Lead scopes (teams or departments)

- An Admin assigns a `Lead` one or more scopes, each `{ type: "team" |
  "department", id }`. They are stored in DynamoDB and managed in Settings.
- **Department scope** covers every team whose rollups name that department.
  Membership is per day and follows *Historical Snapshots* (the rule recorded
  as decision W3): a team that moved department is in a department lead's
  scope only for the days its rollups name that department. The spec must
  state this explicitly.
- Teams created later fall into a department scope automatically. Never copy
  a department's team list into team assignments.
- A lead cannot assign or change scopes, including their own. Only Admins can.

### 1.4 Visibility (what `Viewer` members see)

These are settings per team, plus one per department. Each is editable by an
Admin or by a Lead whose scope covers it. The defaults are **least privilege**.

| Setting | Values | Default |
|---|---|---|
| Team level: members see this team's totals and breakdowns (Team Detail; the team's rows on Teams, Services, Ranking) | `visible` / `hidden` | `visible` |
| User level: per-user rows for this team | `all` / `own` / `none` | `own` |
| Department level: the department's totals (Departments card, Department Detail, department rows in Overview and Ranking) are shown to members of the department **and** to members of any of its teams | `visible` / `hidden` | `hidden` (a department total reveals sibling teams' aggregate spend) |

- **Organisation-wide views for Viewers** (Overview KPIs, rankings) show only
  in-scope data, and their labels say so ("your teams"). A Viewer never sees
  an organisation total that includes out-of-scope cost.
- **Precedence.** Visibility is stored per team or per department. The team's
  Lead and the department's Lead can both edit a team's settings; the last
  write wins, with optimistic concurrency (§1.6). A department-level cap on
  team settings is **not** in v1. Propose it if needed.
- **Privacy.** Per-user cost is personal data. Defaulting to `own` minimises
  exposure. The spec states the legal basis and retention as a user decision
  (data protection officer or HR input). The run proposes text; it does not
  decide this.

### 1.5 Membership: Viewers belong to teams or departments, managed by Leads

Access comes from **explicit membership**, never from usage data. Deriving
membership from `byUser` would deny access to people who never invoke
Bedrock (finance, managers, auditors), and would grant access to anyone who
once used a team's account.

**Two layers, kept separate:**

| Layer | Source | Managed by |
|---|---|---|
| Who can sign in, and their role | Entra groups → app roles (§1.2) | Entra admins or group owners |
| Which teams and departments a Viewer may see | Membership records in DynamoDB, audited | A `Lead` within their scope; `Admin` everywhere |

**Membership rules:**
- **Targets.** A Viewer can be a member of one or more **teams** and/or
  **departments**.
- **What department membership grants:**
  - the department's totals, when its department-level setting is `visible`
  - each team in the department, according to that team's team-level
    setting
  - per-user rows, according to each team's user-level setting (`all`,
    `own` or `none`)
  - Department scope follows *Historical Snapshots* per day, as for lead
    scopes (§1.3).
- **Who manages it.**
  - A `Lead` may add and remove members only for teams and departments in
    their own scope.
  - A `Lead` cannot add Leads or Admins, cannot change scopes, and cannot
    touch anything outside their scope.
  - An `Admin` may manage any membership.
- **Membership never grants a role.** The person still needs the `Viewer`
  app role from Entra; with "Assignment required", they cannot sign in
  without it.
- **Adding people without directory permissions.**
  - The Lead enters a work email or UPN. It is stored as a **pending
    membership**.
  - At the user's first sign-in it is **bound to their `oid`**. Binding
    matches on the token's `preferred_username` or `email`, case-insensitive,
    and requires the configured `tid`.
  - After binding, `oid` is the key, so a later UPN change or UPN reuse
    cannot redirect it.
  - This needs no Microsoft Graph permission and no client secret.
- **Identity links and usage identities** are defined in shared-contracts
  §3: `usageIdentities[]`, `aliases[]` and `litellmUserId`.
  - The canonical usage key is the email after the SSO prefix
    (`AWSReservedSSO_…/` or `AROA…:`), lower-cased (shared-contracts §3.1).
  - By default a person's usage identity is their canonical email. Admins
    add other known emails or aliases per person in Settings.
  - Links are used **only** to show a person their own usage, and never
    grant access.
- **Leavers and hygiene.**
  - A user disabled in Entra cannot sign in, so their membership grants
    nothing.
  - Settings lists **stale memberships** for cleanup: pending ones never
    bound after N days, and bound members who have not signed in for N days.
    R0 decides N.
- **No membership:** a signed-in Viewer with no membership gets an explained
  empty state ("ask your team lead for access"), never any team's data.
- **Alternative, for R0 to record but not adopt in v1:**
  - Each team or department is an Entra security group whose **owner** is the
    lead. Membership is read from group claims or Microsoft Graph at sign-in.
  - It suits Entra-centric companies.
  - It brings back group-overage handling (no group list in the token once
    a user exceeds about 200 groups), a group-ID-to-team mapping and,
    usually, Graph permissions with a secret.
  - So it stays a later option.

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
   - **Authorization data is never cached:** roles, scopes, memberships,
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
     in addition to the SameSite session cookie.
   - **Structural test:** `write-routes.integration.test.ts` enumerates every
     write route with its required permission, so none ships ungated.
   - **No rate limiting of the dashboard's own routes** (decided 2026-11-09).
     - The dashboard is internal, behind the company VPN (§1.8), with no edge
       WAF and no per-user write counters.
     - Request and token rate limits are **LiteLLM's**. Admins and Leads
       configure them through LiteLLM's API (`litellm_prompt.md` §1.3,
       *Rate limits*), and LiteLLM enforces them.
7. **Timeliness of changes.**
   - Role changes made in Entra take effect at the next sign-in. The 8-hour
     session cap bounds that delay.
   - R0 decides whether `Admin` sessions get a shorter cap.
   - Scope, membership, visibility and identity-link changes are read per
     request, so they take effect on the next request. That includes
     removing a member.
8. **Audit log** (required for company use). The schema, semantics and
   storage are defined in shared-contracts §4. That includes the dedicated
   CloudWatch Logs group for SIEM export. The details below are summarised
   from it.
   - Every write to scopes, memberships (add, remove, pending-to-bound),
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
    dashboard: memberships, scopes, visibility, identity records and links,
    and audit records. The dashboard's AWS credentials are read-only today
    (`docs/guides/dashboard-deployment.md` §2).
    - **R0 defines the least-privilege ECS task role** (AppStack, §1.8),
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
    - **Fail closed.** An unset or invalid value means `enforce`.
    - **No external admin in `open` mode.** While it is `open`, every write
      route except account CRUD for `Admin` returns `403`, and every LiteLLM
      route is disabled (`litellm_prompt.md` §1.2 item 9a).
    - **Runbook.** `docs/guides/auth-setup.md` covers creating the groups,
      assigning app roles, turning on "Assignment required", assigning lead
      scopes, testing with one user per role, then enforcing.
11. **Local development and tests.**
    - The dev-only login can sign in as each role, with chosen scopes and an
      identity link. It stays fail-closed in production.
    - The e2e forged-session helper gains `role`, `scopes` and `oid` options.
    - No production bypass exists (Rule 70.11).
12. **Unchanged guarantees:**
    - UTC days and USD
    - cost provenance and estimates (Rule 20.3)
    - the server-only boundary
    - the `{ data }` / `{ error }` shape
    - the 8-hour session cap
    - no real tenant IDs, group IDs or account IDs committed; docs use
      placeholders (Rule 50.9)

### 1.8 Platform

The AWS hosting and IaC layout (ECS on Fargate, ALB reuse or creation, the
created-resources list, the CDK stacks) is defined **once**, in
`shared-contracts.md` §7. Unit **RP** (§2) builds it. References in this file
to "§1.8" mean that section.

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
  membership (§1.5 alternative). Propose them only.

## 2. Units and phase placement (Rule 30)

This work cuts across shipped pages, so it enters the plan through a spec
unit before any code.

| Unit | Branch | Content | Depends on |
|---|---|---|---|
| **R0: spec and threat model** | `docs/rbac-entra-roles` | See the R0 scope below this table, including every shared-contracts decision | — |
| **RP: platform** | `feature/phase-<n>-platform` | The `infra/` CDK app: InfraStack and AppStack per shared-contracts §7, both ALB modes, the ECS service and task definition for the existing dashboard, the `/api/health` route with dependency checks (§8 there), alarms (§8), the CI deploy role. Synthesised and asserted, never deployed | R0 |
| **R1: identity and roles** | `feature/phase-<n>-rbac-identity` | `lib/auth` role model (deny by default, union of roles, parsing); `oid`/`tid` in the session; `auth.ts` mapping; the "no access" page; `AUTH_ACCESS_MODE` in `env.ts`; the `Auditor` role (read everything, every write `403`); the identity record with `lastSeenRoles`; the dev login and e2e helper per role (including Auditor) | R0, RP |
| **R2: authorization data** | `feature/phase-<n>-rbac-data` | The ECS task role's DynamoDB policy for this unit, added to RP's AppStack (synthesised and asserted, never deployed); the shared usage-identity canonicaliser in `packages/shared` (shared-contracts §3.1), applied on read; identity links with `usageIdentities[]` and `aliases[]` (unique per person); the audit log written to DynamoDB and to the CloudWatch audit log group (shared-contracts §4); DynamoDB entities and `server-only` data access for lead scopes, team and department memberships (pending and bound), team and department visibility, identity links and the audit log; the pending-to-`oid` bind at sign-in (in `auth.ts` callbacks, audited); versioned conditional writes; Zod schemas in `packages/shared`; seeds per role, including department members and pending invites | R0, R1 |
| **R3: server-side scoping** | `feature/phase-<n>-rbac-scope` | The policy module (`resolveScope` from role + lead scopes + memberships + visibility, and `can`); every read Route Handler and Server Component filtered; aggregates computed after filtering; `404` parity; `Cache-Control: private, no-store`; authorization data read uncached (§1.6 item 4); scoped CSV, search and command menu; the role × route matrix and leak tests | R1, R2 |
| **R4: management UI and writes** | `feature/phase-<n>-rbac-settings` | Settings: Admin manages lead scopes, identity links, aliases and usage identities, and the audit log view; the Admin and Auditor access-review CSV export (shared-contracts §6); the works-council or data-protection approval switch that gates per-user views in `prod` (shared-contracts §6); Lead (within scope) and Admin manage team and department members (add by email or UPN, remove, see pending and stale) and edit visibility; write routes with permission, origin and `409` handling; the structural write-route test updated; accessible forms (Phase 5 floor: axe clean, keyboard, focus) | R3, plus Phase 4.9's Settings shell |
| **R5: UI gating and copy** | `feature/phase-<n>-rbac-ui` | Navigation and pages reflect scope: "your teams" labels, "not visible" and "no access" states, no dead links. **Role-aware landing:** a Viewer lands on *My usage* (their direct Bedrock usage via usage identities; LiteLLM is added in L6), a Lead on *My teams*, an Admin or Auditor on the Overview | R3 |

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
  - §1.5 membership: explicit and lead-managed is recommended; the
    Entra-group-owner model is the recorded alternative; also the stale
    window N
  - the visibility defaults
  - audit retention
  - a shorter `Admin` session cap
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
  3. Review on opus: quality-reviewer, spec-guardian, playwright-ui-reviewer
     for UI changes, and ecc:security-reviewer for R1–R4 if installed.
     Otherwise quality-reviewer covers security explicitly and the report says
     so.
- **R3 and R4 add a dedicated security review pass.** quality-reviewer is
  briefed with the threat model and asked to try to break the policy.

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
- **Works-council gate.** In `prod`, per-user rows are hidden from Leads and
  from `all` visibility until the approval record exists. The switch is
  Admin-only and audited.
- **Identity and roles.**
  - Missing, malformed or unknown roles mean no access.
  - Several roles form a union, and `Lead` without a scope behaves as `Viewer`.
  - A missing `oid` fails closed.
  - A role in the token that the app does not know is ignored.
  - The app cannot grant `Admin`.
- **The role × route matrix.**
  - **Routes:** every Route Handler, tested against DynamoDB Local.
  - **Callers:**
    - unauthenticated
    - no role
    - Viewer: team member; department member; member of both; with no
      membership; with a pending (unbound) membership; removed member; with
      an unmapped identity link
    - Lead: team scope (own team, another team); department scope (a team in
      the department, a team outside it, a team that moved mid-range)
    - Admin
  - **Assertions:**
    - `401`, `403` before parsing, and `404` parity (identical bodies for
      out-of-scope and missing)
    - lists contain only in-scope rows
- **Leak tests.**
  - Changing the cost of an out-of-scope team changes **no** number a Viewer
    or Lead can see: totals, %, counts, top-N, trends, comparisons, CSV.
  - With department visibility `hidden`, a department total cannot be
    reconstructed from the visible team rows plus any visible total.
- **Visibility.**
  - Team `hidden` removes the team everywhere for its members.
  - User `own` shows exactly the caller's row through the identity link;
    `none` shows no per-user data.
  - Department `visible` and `hidden` behave as specified.
- **Membership.**
  - A pending membership grants nothing until it is bound at sign-in.
  - Binding requires a matching `tid` and a case-insensitive UPN or email
    match, and happens once. A later UPN change, or another user taking over
    the old UPN, does not move the membership.
  - Removing a member takes effect on their next request.
  - Membership without the Entra `Viewer` role grants nothing.
  - Usage data alone (appearing in `byUser`) grants nothing.
  - Department membership grants exactly what §1.5 states, including for a
    team that moved department mid-range.
- **Writes.**
  - **Permissions:** a Lead cannot edit outside their scope, cannot manage
    members outside their scope, cannot add Leads or Admins, cannot assign
    scopes or identity links, and cannot reach account CRUD.
  - **Request checks:** a body/path id mismatch returns `400`; a stale
    `version` returns `409`; a cross-origin write is rejected.
  - **Audit:** each write behaves as the shared semantics in §1.6 item 8
    state: one `success` record; one `failed` record for a downstream
    failure; none for a rejected request.
- **Caching.**
  - Two callers with different scopes, requested back to back, never see each
    other's rows.
  - Every `/api/*` response carries `Cache-Control: private, no-store`.
- **Rollout.** `AUTH_ACCESS_MODE` that is unset or invalid behaves as
  `enforce`, and `open` is rejected when `NODE_ENV=production`.
- **No regressions.** Every existing page test still passes for `Admin`.
  Existing guarantees (§1.6.12) hold.

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
