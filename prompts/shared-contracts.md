# Shared Contracts — RBAC + LiteLLM (LLM Usage Lens)

The single source for everything that `rbac_prompt.md` and
`litellm_prompt.md` both depend on.
- **Precedence:** `CLAUDE.md` → `.claude/rules/**` → `docs/specs/**` →
  **this file** → `rbac_prompt.md` / `litellm_prompt.md` → `master_prompt.md`.
- **Changes here** are made in the spec units (RBAC R0 and LiteLLM L0)
  together, then mirrored into `docs/specs/**`. The specs stay the source of
  truth (Rule 00).
- **The prompts cite this file by section,** for example "shared-contracts
  §3". They do not repeat its text. Where a prompt and this file differ,
  this file wins, and the run reports the conflict.

**Role words.** Plain words in the sections below stand for role values
(`rbac_prompt.md` §1.1): **Admin** is `internal-admin`; **Lead** is
`internal-team-admin` within its scope (and `internal-org-admin` on every
team, with no configuration); **Auditor** is `internal-auditor`; **Viewer**
is `internal-viewer` and members. The role values are authoritative.

## 1. Environments (decided 2026-11-09)

| Env (`<env>`) | LiteLLM | Identity mapping to LiteLLM | Entra |
|---|---|---|---|
| `dev` | **OSS** (non-Enterprise) | LiteLLM `user_id` = lower-cased work email | Same tenant; dev app registration |
| `prod` | **Enterprise**, with SSO through Entra ID | The `user_id` LiteLLM assigns at SSO sign-in, looked up by email. It is the email (confirmed by the user 2026-11-10, LiteLLM spec LD13), but is still read from LiteLLM, never composed | Production app registration |

- **Only these two environments exist.** No staging.
- **The dashboard's own environment switch is `APP_ENV` (`dev` | `prod`),**
  a validated variable in `env.ts`. It, never `NODE_ENV`, decides every
  "in `prod`" control (Entra required, master-user TOTP, the per-user
  approval gate, `AUTH_ACCESS_MODE=enforce` only, the legacy `Admin` alias
  removed).
- `<env>` appears in SSM parameter names (`/llm-usage-lens/<env>/…`), CDK
  stack names and the CI deploy jobs.
- **The `edition` flag defaults by environment** (`oss` in `dev`,
  `enterprise` in `prod`). An Admin can see it but not change it away from
  the environment's value; an attempt is rejected and audited.

## 2. Roles

**Revised 2026-11-10** (`rbac_prompt.md` §1.1–§1.5). There are two kinds of role,
modelled on LiteLLM's proxy and team roles, and every app role value carries
the `internal-` prefix.

| Role | Kind and source | Reads | Writes |
|---|---|---|---|
| `internal-admin` | Global; a small selected group. Entra app role, an in-app grant by an `internal-admin`, or the username/password **master user** (`Admin` accepted as a legacy alias until `enforce`) | Everything | Everything: any team, any user and all configuration. **The only role that can grant or revoke `internal-admin` and `internal-org-admin`** |
| `internal-org-admin` | Global; Entra app role, or an in-app grant by an `internal-admin` | Every team and department | department-scope `internal-team-admin`, `internal-team-admin` and member assignments, members, moves and visibility in any team. **No configuration**, and no global-role grants |
| `internal-auditor` | Global; Entra app role only | **Everything**, read-only, organisation-wide: all pages, the audit log, the access-review export, LiteLLM read views. **Never** key values or secrets | Nothing. Every write route returns `403` |
| `internal-viewer` | Global; Entra app role, **or the default** for a signed-in user with no recognised role | Their own usage (§5); their affiliation's data, as visibility allows | Nothing |
| `internal-team-admin` | Scoped to **one or more** teams and/or departments (each a separate admin scope); set in the UI or by SSO group mapping | Everything in its scope | Members, promotions and visibility in its scope; with department scope, also moves within the department and the department cap; LiteLLM team administration for its teams |
| member (no role value) | A plain affiliation to one team; UI or SSO group mapping | The team, as visibility allows | Nothing |

- **Affiliation versus admin scopes.**
  - A user is a **member of at most one team**.
  - A lead may hold `internal-team-admin` on **one or more** teams and/or
    departments.
  - A move needs authority over both teams, is atomic and audited, and
    removes only the team-scope admin on the source team.
- **SSO mapping:** Admin-managed `groupId → team/department + scoped role`.
  Precedence is SSO > UI > none. With unmapped or empty groups, no team is
  set and the user is `internal-viewer`. Admin-scope mappings may yield several scopes. Several distinct member targets are
  ambiguous, so no SSO affiliation is applied. A UI change to an
  SSO-managed affiliation returns `409 MANAGED_BY_SSO`.
- **Inheritance:** a child narrows its parent. The effective setting is the
  minimum of the organisation cap, the department cap and the team setting.
- **Global-role grants:** only an `internal-admin` can grant or revoke
  `internal-admin` or `internal-org-admin` in the app. Each grant needs a
  re-authentication within 15 minutes and a reason, and is audited and
  alarmed. Group mappings never target a global role. The last
  `internal-admin` and the master user cannot be removed.
- **Master user:** one username/password break-glass login, always
  `internal-admin`. It is the only password login in production: an
  Argon2id hash in an SSM SecureString, TOTP in `prod`, a 5-attempt
  lockout, a 1-hour session, and every sign-in audited
  (`rbac_prompt.md` §1.3).
- **Sessions and entry points.** Sessions are capped at 8 hours, 4 hours
  with `internal-admin` or `internal-org-admin`, and 1 hour for the master
  user. A sign-in that fails closed (a malformed token, a foreign `tid`, no
  `oid`) ends on the `/no-access` page. Local users are stored data, ignored while
  Entra is configured. `AUTH_ACCESS_MODE` (`open` | `enforce`) stages the
  rollout and is `enforce` in `prod`.
- **Storage:** the existing DynamoDB table. Aurora Serverless v2 was
  considered and deferred; see `rbac_prompt.md` §1.5 *Storage*.

- **Viewer by default for SSO users (decided 2026-11-10).** A missing or
  empty `roles` claim, or only unknown roles, means `internal-viewer`. Data stays
  deny by default through affiliation, and a malformed claim fails closed.
- **Without SSO (local login, Entra not configured; decided 2026-11-10):**
  the default sign-in is `internal-admin`. Admins may add local users and set their
  roles. This is disabled once Entra is configured. Several roles
  combine as a union.
- **`internal-auditor`** comes only from Entra group assignment; the app
  never grants it.
- **Auditor read access is itself audited:** audit-log views and exports
  record actor and time.

## 3. Identity

- **Identity record**, keyed by `oid` together with the `tid`:
  `{ tid, email, upn, displayName, lastSignInAt, lastSeenRoles[] }`.
  - It is upserted at every sign-in. `email` and `upn` are lower-cased.
  - `lastSeenRoles` feeds the access review (§6).
- **Identity links**, one entity keyed by `oid`:
  - `usageIdentities[]`: the canonical usage keys that belong to this person
    (§3.1).
  - `litellmUserId`: the person's LiteLLM user (`litellm_prompt.md` §1.3,
    per environment).
  - `aliases[]`: other known emails or usernames (a former name, a second
    domain, a contractor address), **managed by Admins**. Leads cannot edit
    them.
  - Every change is audited. An alias or usage identity may belong to **one**
    person only; a duplicate returns `409`.

### 3.1 Canonical usage identity (CloudTrail SSO format)

Employees sign in to AWS through IAM Identity Center, so CloudTrail shows the
Bedrock caller as an assumed SSO role **with a prefix before the email**:
- `userIdentity.arn`:
  `arn:aws:sts::<acct>:assumed-role/AWSReservedSSO_<PermissionSet>_<id>/<email>`
- `userIdentity.principalId`: `AROA…:<email>`

**Canonicalisation, one function in `packages/shared`** (the collector and
the dashboard use the same one; Rule 20.5's "no duplicate tables" applies):
1. Take the substring after the **last** `/` or `:`.
2. Trim it and lower-case it.
3. Accept it only if it is a syntactically valid email address. Anything
   else is **not** a person: it is kept under its raw key with
   `kind: "non-person"` (for example a service role), never guessed into a
   user.

- **Unit tests** cover the ARN form, the `principalId` form, mixed case,
  surrounding whitespace, and non-email session names.
- **Spec impact (R0 records it):** the Data Model `byUser` key becomes the
  canonical email, and the System Architecture CloudTrail query note is
  updated. The collector (Phase 6) applies the function. Until then, the
  dashboard canonicalises keys on read.
- **Matching a person to usage:** a usage key belongs to a person when it
  equals their canonical email, or is in their `usageIdentities[]` or
  `aliases[]`. Matching never uses fuzzy logic.

## 4. Audit log

- **Schema:** actor `oid` (or `system`), action, target, `teamId?`,
  before and after (sanitised: never secrets or key values), `result`
  (`success` | `failed`), timestamp (UTC) and request id.
- **Semantics:**
  - A successful write creates exactly one `success` record.
  - A write that passed authorization but failed downstream creates exactly
    one `failed` record.
  - A write rejected with `400`/`401`/`403`/`404`/`409` creates none.
- **Storage.**
  - DynamoDB is the queryable copy: append-only, `PutItem` only.
  - Each record is **also** written as one structured JSON line to a
    dedicated CloudWatch Logs group, `/llm-usage-lens/<env>/audit`, in
    the DashboardServiceStack, with KMS encryption. The Access Control spec sets
    retention at 400 days in both stores (decision D3; the user confirms).
  - The security team can subscribe their SIEM to that log group. No SIEM
    resource is created here.
- **Retention:** 400 days (Access Control spec, D3), by CloudWatch
  retention and a DynamoDB TTL attribute.
- **Security events.** The master-user events (`auth.master.*`) and
  `auth.signin.error` start as id-only telemetry in R1. R2 writes them to
  the audit record and the DashboardServiceStack alarm. A successful write's audit item
  is written in the same `TransactWriteItems` as the change.

## 5. Usage and cost: two sources, one combined view

Employees use Bedrock **both** directly (their own SSO session) **and**
through LiteLLM (LiteLLM calls Bedrock, or other providers, with its own
credentials). The dashboard has an interface for each, plus combined totals.

| Source | What it gives | Provenance |
|---|---|---|
| **Bedrock (collector)** | Cost Explorer cost per account and model (exact); CloudTrail per-user and per-service usage (estimated split) | Rule 20.3 |
| **LiteLLM** | Spend, tokens and requests per team, user, key and model (LiteLLM's own price calculation) | "LiteLLM-reported" |

**The overlap.** When LiteLLM calls Bedrock, that traffic is **already**
in the Bedrock data, billed under LiteLLM's IAM principal and in LiteLLM's
AWS account. Adding the two sources naively counts it twice.

**The gateway configuration** (Admin, audited): the LiteLLM **gateway
principals**, meaning the IAM role names or canonical usage keys LiteLLM uses
to call Bedrock, and optionally the **gateway account id** or ids.

**Combined rules:**
- **Per person:** direct Bedrock usage (their usage keys, excluding gateway
  principals) **+** their LiteLLM-reported usage. The figure is always marked
  as including estimates.
- **Per team:** the team account's Bedrock cost, excluding gateway-principal
  usage when it occurs in that account, **+** the LiteLLM-reported usage of
  the linked LiteLLM team.
- **Organisation:** the Bedrock exact total, excluding the gateway slice,
  **+** all LiteLLM-reported usage.
  - The **gateway slice** (the Bedrock cost billed to gateway principals or
    the gateway account) is shown separately as "billed via LiteLLM".
  - A **reconciliation** row compares it with the LiteLLM-reported spend for
    Bedrock models, so drift is visible and never hidden.
- **Non-Bedrock providers** behind LiteLLM appear only in the LiteLLM
  source, and are labelled by provider.
- **Every combined number** shows its parts on hover or expansion (direct
  Bedrock, via LiteLLM), never a single unexplained total.
- **Unconfigured gateway:** while no gateway principal is configured,
  combined views show a "gateway not configured — totals may double count"
  warning to Admins and Auditors, and hide combined totals from Viewers and
  Leads.
- *Note (2026-11-17, LiteLLM L6; proposed amendment, pending the user):* the LiteLLM spec LD38 warns all global readers (org-admin included), and the Organisation part covers LiteLLM teams only until user decision U1 (a proxy-wide read).

## 6. Governance

- **Access review export** (Admin and Auditor): a CSV of every identity with
  `lastSeenRoles`, global roles and their source, the affiliation and its source, aliases, `lastSignInAt` and the
  LiteLLM link. The export itself is audited. It supports quarterly reviews;
  Entra ID Governance reviews the groups.
- **Conditional Access.** Both Entra app registrations require the
  company's MFA or compliant-device policy. This is portal configuration
  only, documented in `docs/guides/auth-setup.md`. The user applies it.
- **Works council or data-protection gate.** Per-user cost views (user-level
  visibility `all`, and individual rows for Leads) are **off in `prod`**
  until the user records approval in Settings, as an Admin action.
  - Until then, Leads see team totals plus per-user counts only, and Viewers
    see only their own usage.
  - The approval record (who, when, reference) is audited.

## 7. Platform: AWS hosting and IaC layout

The requirement changed (2026-11-09). The dashboard runs on **AWS**, not
Netlify, for **private use only**, inside the company network and VPN. The
infrastructure is defined in **CDK**. R0 and `litellm_prompt.md` L0 record
these changes jointly as spec amendments.

**Region.** All stacks deploy to `ap-southeast-2`, from `COLLECTOR_REGION`
in `packages/shared/src/region.ts` (Rule 50.7). Cost Explorer is the one
call that stays on `us-east-1`. Netlify hosting is superseded.

**Design principle: minimum resources.**
- **Reuse what exists:** the VPC, the network routing (Transit Gateway), the
  ACM certificate, LiteLLM itself and, when provided, its load balancer.
- **Create only what the dashboard cannot run without.** Every created
  resource is listed in the table below. Anything else needs a spec
  amendment first.

**Assumed to exist, never created by these prompts**
- **The VPC and its private subnets.** They are imported by id.
- **Network routing through the existing Transit Gateway.** It already
  gives the subnets the egress that Entra ID sign-in needs (it works today
  for LiteLLM) and access to AWS service endpoints.
  - **No NAT gateway and no VPC endpoints are added.**
  - R0 only records the assumption. If a deploy-time check shows a required
    path missing, it is reported as a user action and nothing is added.
- **The ACM certificate.** It is imported by ARN. No certificate is
  requested.
- **LiteLLM.** It is already deployed and reachable internally. These
  prompts never deploy, configure or host it.

**Load balancer: reuse when given, create only when not**
- **If an ALB HTTPS listener ARN is provided** (CDK context or an SSM
  parameter name), the DashboardServiceStack **imports** that listener, its ALB and its
  security group. It adds only:
  - its own target group
  - one **host-based** listener rule, for example
    `llm-usage-lens.<company-domain>`, with a **unique priority** agreed
    with the ALB's owner, so it never shadows existing rules
  - the certificate as an additional (SNI) certificate, only if the
    listener's certificate does not already cover the host
  - one ingress rule on the task security group, from the ALB security
    group on the container port

  It never changes the ALB, the listener's default action or settings, or
  other rules and target groups. Undeploying removes only what it added.
- **If no ARN is provided,** the DashboardServiceStack creates one **internal** ALB
  (`internetFacing: false`) in the imported private subnets. It has:
  - one HTTPS listener using the imported certificate and a TLS 1.2+
    policy; there is no HTTP listener
  - a security group allowing 443 only from the company network CIDRs
    supplied as input
- **In both cases** the service is a plain `FargateService` attached to the
  listener. This is not the `ApplicationLoadBalancedFargateService` pattern
  or ECS Express Mode, because both always create their own ALB.

**Health check.** The target group checks `/api/health`, which needs no
session and returns only `{ data: { status: "ok" } }`.
- It is the one documented exception to Rule 10.3's session check. R0 adds
  it to the rule and the spec.
- A structural test allows exactly this one unauthenticated route.

**Created resources (complete list)**

| Stack | Creates | Notes |
|---|---|---|
| **FoundationStack** (shared, stateful) | The `bedrock-usage` DynamoDB table (with a TTL attribute only if R0 implements audit retention through TTL), the KMS CMK the specs already require, the ECS cluster, the ECR repository, and SSM parameters holding shared non-secret identifiers | Long-lived, with termination protection. `RemovalPolicy.RETAIN` on the table and the CMK. Table ownership moves here from the collector's SAM template |
| **CollectorStack** | Nothing yet | **Not built by these prompts.** Phase 6 stays last (Rule 30.5). Moving the collector from SAM to CDK is a Phase 6 spec amendment that R0 records |
| **DashboardServiceStack** (dashboard, stateless) | The ECS task definition and Fargate service, its log group, the audit log group (§4), the alarms in §8, the **task role**, the **task execution role**, the task security group, the target group and listener rule. The internal ALB and its HTTPS listener are created **only when no listener ARN is given**. Also the CI deploy role (GitHub OIDC) | Every permission these two prompts add goes here |

**Not created (decided 2026-11-09):**
- a VPC, a NAT gateway or VPC endpoints
- ElastiCache or any cache cluster
- an AWS WAF
- a new certificate
- CloudFront
- any LiteLLM resource

**Runtime choices that keep the list this short**
- **Task-role policy ownership.** RP creates the task role with DynamoDB
  reads and writes limited to `ACCT#*` (Phase 4.9) and `IDENT#*` (Phase
  4R.1 identity and lockout writes; added 2026-11-11, security review). R2
  adds the remaining access-control leading keys and the `PutItem`-only
  audit statement. L2 adds `LITELLM#*`. The task role never gets SSM access.
- **Credentials.** The **ECS task role** supplies AWS credentials through
  the default chain, so there are no static keys (Rule 50.1).
  `docs/guides/dashboard-deployment.md` is rewritten for ECS, and the
  Netlify runbook is retired.
- **Secrets.** The task definition's `secrets` (`valueFrom` an SSM parameter
  ARN) inject them at task start. Application code never calls SSM.
- **No shared cache cluster.** Next.js's default cache is per task, so
  `revalidateTag` on one task does not reach the others (Next.js docs,
  *Self-hosting* → multi-instance). The design does not rely on
  cross-task invalidation:
  - Authorization data (roles, scopes, memberships, visibility, identity
    links, toggles), Settings data and LiteLLM reads are **never cached**.
    They are read per request.
  - Only the rollups are cached (per UTC day, hourly revalidation, as
    today). The collector writes them hourly, so staleness of up to an hour
    on a task is already the accepted behaviour.
  - Revisit this, with a spec amendment, only if a measured need appears.
- **Availability.** Run 2 tasks in 2 AZs in production. Nothing in the
  design depends on a single task.
- **Cost posture.** Document the standing cost: Fargate tasks, ECR storage,
  CloudWatch Logs, and the internal ALB only when it is created. There is
  no NAT, endpoint, cache, WAF or certificate cost.

**IaC layout.** One CDK app in `infra/`, with the three stacks above. Each
is deployable on its own and has a deploy and undeploy runbook.
- **Stacks share values through SSM parameters,** never through secrets.
  The FoundationStack writes non-secret identifiers (table name, cluster ARN,
  repository URI) to parameters under `/llm-usage-lens/<env>/infra/*`.
  Imported ids (VPC, subnets, certificate, optional listener) are supplied
  as CDK context or SSM parameter names.
- **Not CloudFormation exports.** An export locks the producer: it cannot
  change or delete an exported value while another stack uses it.
- **Deploy order is explicit:** FoundationStack → DashboardServiceStack (and CollectorStack,
  later). It is stated in the runbooks and CI.
- **CI deploy role.** GitHub Actions assumes it through OIDC. It can push the
  ECR image, update the ECS service and run CloudFormation for the
  DashboardServiceStack. It cannot read secrets.
- **Spec changes R0 records:**
  - the stack tool (Rule 40: CDK is added, and SAM is kept only until the
    Phase 6 amendment)
  - the IaC layout and the created-resources list above
  - System Architecture (hosting)
  - `aws-infrastructure.md` (table ownership)
  - `dashboard-deployment.md` (rewritten for ECS)
  - CI/CD in implementation-phases
- **What runs may and may not do.**
  - Runs may write CDK code, `cdk synth`, and assert it with CDK
    `assertions`.
  - **Both ALB modes** are asserted: import mode creates no ALB or listener,
    and create mode creates exactly one internal ALB with HTTPS only.
  - Runs **never** run `cdk deploy`, never call AWS, and never create
    resources.
  - `infra/` is created by unit **RP** (`rbac_prompt.md` §2), with only
    what the dashboard needs to run (Rule 30.2).

## 8. Operations

- **Alarms in the DashboardServiceStack:**
  - the ECS service running task count below desired
  - task restarts or failures
  - the target group's unhealthy hosts and 5xx, **only when the DashboardServiceStack
    created the ALB**
  - application 5xx through a log metric filter
- **Imported ALB:** the existing ALB's own alarms already cover it, so no ALB
  or target-group alarms are added.
- **Alarm actions** go to an **existing** SNS topic, supplied as input. No
  topic is created.
- **`/api/health`** returns `ok`, plus a `dependencies` object (DynamoDB
  reachable, and LiteLLM reachable when configured) with no data. It stays
  unauthenticated (§7).
- **Runbook:** `docs/guides/operations.md`, covering alarms, a first look at
  each, the redeploy, and service-key rotation (`litellm_prompt.md`).

## 9. Finance: monthly statement

- **Content:** a per-department and per-team monthly statement, as CSV, with
  these columns:
  - Bedrock exact cost (finalised days only, `costFinalized: true`)
  - LiteLLM-reported usage
  - the combined figure under the §5 rules
  - the gateway reconciliation
- **Who can download it:** Admin, Auditor, and Leads for their own scopes.
- **Month boundaries** are UTC calendar months. A month with any
  non-finalised day is marked "provisional".
