# Future Improvements & Suggestions

A backlog of enhancements that were considered but are **intentionally out of
scope for v1**. This is the parking lot — distinct from
[`docs/specs/`](specs/), which defines committed scope.

**Nothing here is scheduled.** Each entry records *why* it is deferred and the
*trigger* to revisit it. An item leaves this list only by being promoted into a
spec and the phase plan — per [Rule 00](../.claude/rules/00-spec-source-of-truth.md),
the spec leads and code follows, so adopting any of these starts with a spec
change, not a PR.

## How to add an entry

Add a `###` heading under the most fitting section, with these fields:

- **Status** — `Deferred` (revisit on a trigger), `Blocked` (external
  dependency), or `Rejected` (kept for the rationale, do not reopen).
- **What** — one or two sentences.
- **Why deferred** — the cost/benefit at the project's current scale.
- **Adopt when** — the concrete trigger that flips the decision.
- **References** — spec sections and rules that the change would touch.

Keep entries short. Detailed design belongs in a spec once the item is promoted.

---

## Build & tooling

### Turborepo task runner / caching

- **Status:** Deferred.
- **What:** Add [Turborepo](https://turborepo.com) on top of the existing pnpm
  workspace for task-graph orchestration and build/test caching (the common
  "pnpm + Turborepo + Next.js" stack). Note: this is Turbo**repo** (task
  runner), not Turbo**pack** (Next.js's dev bundler), which the design system
  already uses.
- **Why deferred:** The monorepo is three packages (`apps/dashboard`,
  `apps/collector`, `packages/shared`) maintained by a single contributor.
  `pnpm --filter` / `pnpm -r` already runs cross-package scripts, and
  path-filtered CI (the `paths-ignore` pattern in `claude-pr-review.yml`)
  already avoids rebuilding everything. Turborepo's caching/orchestration wins
  scale with package count, team size, and a shared remote cache — all near the
  floor here. Adding it now is speculative tooling ahead of need
  ([Rule 30.2](../.claude/rules/30-phase-discipline.md)).
- **Adopt when:** `packages/` grows beyond a handful, **or** CI feedback drifts
  past the ~10-minute target (see
  [github-best-practices §27](guides/github-best-practices.md)). Turborepo
  layers onto an existing pnpm workspace with no restructuring, so deferring
  costs nothing.
- **References:** [`design-system.md`](specs/2026-05-15-design-system.md)
  (Package Manager = pnpm; no task runner), the stack list in
  [Rule 40](../.claude/rules/40-style-and-stack.md) (substitutions require a
  spec update), Phase 1 in
  [`implementation-phases.md`](specs/2026-05-15-implementation-phases.md).

---

## Dashboard & UI

### Global filter-chip top bar (and YTD date preset)

- **Status:** Deferred.
- **What:** Adopt the Strata design's *global* top-bar filter cluster — a
  removable filter-chip row (`period · team · region · + Add filter`) plus an
  Export CSV action — applied across pages from the top bar, and add a **YTD**
  preset to the date range control.
- **Why deferred:** The committed scope filters at the **page** level, not
  globally. Only the global date filter lives in the top bar (`DateRangePicker`,
  Phase 2); per-dimension filtering is per-page Phase 4 work (`ModelFilter`,
  department filter, `SearchInput`), and CSV export is the page-level
  `ExportButton` introduced in Phase 4.2 (Ranking) and reused on later table
  pages. A cross-page chip model is a different information architecture —
  shared filter state spanning routes — that the spec does not define, and
  building it now would be speculative ahead of need
  ([Rule 30.2](../.claude/rules/30-phase-discipline.md)). The date presets are
  fixed at 7d / 30d / 90d / Custom range; **YTD** is not among them.
- **Adopt when:** Product wants filters to persist and apply across pages (not
  just within a page), **or** the YTD preset is explicitly requested. Either is a
  spec change first — update the design-system §Layout (top bar contents) and the
  Phase 2 / Phase 4 task lists — then a PR.
- **References:** top-bar / navigation in
  [`design-system.md`](specs/2026-05-15-design-system.md) (§Layout, §Navigation),
  `DateRangePicker` presets in Phase 2 and `ExportButton` / `ModelFilter` in
  Phase 4.2 of [`implementation-phases.md`](specs/2026-05-15-implementation-phases.md),
  and the source design at
  [`docs/design-system/`](design-system/README.md).

---

## Collector & infrastructure

### Aurora Serverless v2 for access-control data

- **Status:** Deferred (decided 2026-11-14, user; Access Control — D21).
- **What:** Move the access-control data — identities, password users and
  their SSO reservations and references, member affiliations, admin scopes,
  role grants, pending items, group mappings, visibility, governance
  switches, identity links, usage-key claims, the audit log and the LiteLLM
  admin data (team links, toggles, connection, key requests) — from the
  DynamoDB table to Aurora Serverless v2 (PostgreSQL). Cost data (rollups,
  `AccountMeta`, `SyncStatus`) stays in DynamoDB.
- **Why deferred:** DynamoDB needs no cluster, credentials, migrations or
  connection handling, costs close to nothing at this scale, and keeps
  sign-in instant. The user accepts Aurora's resume delay; the D26 storage
  boundary keeps the move to one layer, so it is cheap to take later.
- **Adopt when:** SQL reporting or ad-hoc queries over people, memberships or
  the audit log are needed; more data is to move to Aurora; relational
  integrity is required by policy; or D10's thresholds are reached
  (per-request relational reporting, more than about 100,000 identities, SQL
  access for finance).
- **Required actions** (in order; each spec change first, per Rule 00):
  1. *Specs.* Amend Access Control D10, D21 and *Data model additions*
     (entities become tables with unique constraints and foreign keys
     instead of claim and reservation items; the audit TTL becomes an
     `expires_at` column and a scheduled delete); Platform *Created
     resources*, *Task role policy* and *Data isolation* (below); Data Model
     (access-control entities leave the table); Rule 40 stack list (SQL
     library such as Kysely or Drizzle, migration tool); Rule 10 (where the
     SQL client lives: `lib/data/access/**` only); a cost note where the
     cluster is introduced (CLAUDE.md *Cost posture*).
  2. *Platform (FoundationStack, retained, deletion protection on).* Aurora
     PostgreSQL Serverless v2 cluster, minimum 0 ACU with auto-pause and a
     small maximum; DB subnet group in the imported private subnets; not
     publicly accessible; storage, snapshots and the Performance Insights
     key on the project CMK; automated backups and point-in-time recovery;
     **RDS Data API** enabled; master credentials in a Secrets Manager
     secret on the CMK.
  3. *Isolation.* Cluster security group with **no inbound rules** (the Data
     API needs none; if direct connections are ever used, inbound only from
     the dashboard task security group, never from subnet CIDRs); the
     secret's resource policy and the task role's `rds-data:*` and
     `secretsmanager:GetSecretValue` grants limited to that cluster and
     secret; the collector role gets no Aurora access; database roles: an
     app role with `SELECT`/`INSERT`/`UPDATE`/`DELETE` on the access tables
     and **`INSERT`/`SELECT` only on the audit table** (append-only, as
     T19), and a separate migration role the app never holds.
  4. *Schema and migrations.* DDL for every entity with the uniqueness and
     foreign-key rules; migrations run as a deploy step (a one-off ECS task
     with the migration role), never at app start.
  5. *Code.* An Aurora implementation of every `lib/data/access/**` domain
     function behind the same signatures; transactions via the Data API
     (`BeginTransaction`/`CommitTransaction`); opaque cursors keep their
     shape; `/api/health` must not query Aurora, so readiness checks never
     keep the cluster awake.
  6. *Tests.* Postgres in the devcontainer compose next to DynamoDB Local;
     the behaviour suite (D26) runs against both implementations; CDK
     assertions for the cluster, the empty security group and the grants.
  7. *Data move.* A one-time script exports each record type from DynamoDB,
     loads it into the tables, and verifies counts and checksums; cut over
     in a maintenance window behind a server-only `ACCESS_STORE` env
     variable; keep the DynamoDB items read-only (writes denied in the task
     role) for a rollback window, then remove their leading keys from the
     task role and delete the items (user action).
  8. *Operations.* Runbook: pause and resume behaviour (about 15 s on the
     first request after a pause), snapshot restore, secret rotation
     (Secrets Manager; the Data API reads it per call), alarms on capacity
     and Data API errors, and the monthly cost line.
- **References:** [`2026-11-10-access-control.md`](specs/2026-11-10-access-control.md)
  — *Data model additions*, *Storage boundary*, D10, D21, D26;
  [`2026-11-10-platform.md`](specs/2026-11-10-platform.md) — *Created
  resources*, *Task role policy*, *Data isolation*;
  [Rule 10](../.claude/rules/10-server-only-boundary.md),
  [Rule 40](../.claude/rules/40-style-and-stack.md).

### Multi-region collection

- **Status:** Deferred (documented future enhancement).
- **What:** Collect Bedrock cost/usage from regions beyond `ap-southeast-2`.
- **Why deferred:** The collector targets `ap-southeast-2` only by design
  ([Rule 50.7](../.claude/rules/50-security-and-secrets.md)); broadening scope
  silently is forbidden. v1 keeps the cross-account surface minimal.
- **Adopt when:** Bedrock usage in other regions becomes material to the cost
  picture.
- **References:** [Rule 50.7](../.claude/rules/50-security-and-secrets.md),
  [`system-architecture.md`](specs/2026-05-15-system-architecture.md).

### Adjacent-service cost collection

- **Status:** Deferred.
- **What:** Optionally query Cost Explorer services other than Bedrock that
  Bedrock features run on, behind an `ADJACENT_SERVICES` collector setting.
  Examples: OpenSearch Serverless OCUs behind a Knowledge Base, S3 data
  sources, and Lambda action groups.
- **Why deferred:** Without resource-level tags, an account's OpenSearch or S3
  spend cannot be attributed to Bedrock. It would need its own rollup field
  (not `nonModel`) and an opt-in. v1 labels totals "Bedrock service charges
  only" instead.
- **Adopt when:** Knowledge Base or Agent workloads make adjacent spend
  material, and the organization tags those resources consistently.
- **References:** [`system-architecture.md`](specs/2026-05-15-system-architecture.md)
  (*Adjacent services*, Known Limitations 8),
  [`data-model.md`](specs/2026-05-15-data-model.md) (*Non-Model Charges*).

### Per-pricing-mode model cost breakdown

- **Status:** Deferred.
- **What:** Split each model's cost by pricing mode: on-demand, batch,
  cache read, cache write, cross-Region, and service tier. Batch cost would
  then no longer be proportionally attributed to real-time callers.
- **Why deferred:** These charges are correctly model cost in v1. A split adds
  schema surface before Phase 6 has confirmed the real usage-type strings, and
  before we know whether batch usage appears in CloudTrail or CloudWatch.
- **Adopt when:** Phase 6 shows material batch or prompt-cache spend, or
  per-user cost drift from batch attribution is reported.
- **References:** [`data-model.md`](specs/2026-05-15-data-model.md)
  (*Token-based charges that stay model cost*).

### Build-time S3 artifact upload for the bedrock-simulator deploy

- **Status:** Rejected (kept for the rationale; do not reopen).
- **What:** Have `bedrock-simulator-build.yml` run `sam package` to upload the
  Lambda zip to S3 at build time, so deploy runs a CloudFormation-only
  `sam deploy --template-file packaged.yaml` and skips downloading
  `sam-build.tgz` from GitHub.
- **Why rejected:** Deploy's `sam deploy --resolve-s3` already uploads the zip to
  SAM's managed bucket, so S3 is unavoidable regardless — moving the upload
  earlier relocates it, saving only seconds on a few-MB bundle. The cost is
  steep: `sam package` needs S3-write credentials in `build`, which by design
  holds **none** (the `DeployerRole` OIDC trust excludes it) — coupling build to
  the sandbox account and killing its portability. It also adds an artifact
  bucket + lifecycle to manage, whereas durable rollback already comes free from
  never-expiring GitHub Release assets.
- **Adopt when:** The approval-gated deploy window becomes a real bottleneck
  **and** build can take a narrowly-scoped S3-write-only role without losing its
  no-AWS-credentials boundary.
- **References:** [`bedrock-simulator.md`](specs/2026-05-24-bedrock-simulator.md)
  (build/deploy split), [`guides/bedrock-simulator.md`](guides/bedrock-simulator.md),
  [`CLAUDE.md`](../CLAUDE.md).

---

## Access control

### Pending and stale access lists

- **Status:** Deferred (decided 2026-11-15, orchestrator, user delegated;
  Access Control D34).
- **What:** A Settings list of pending member affiliations and admin scopes
  not bound after 30 days, and affiliations, admin scopes and in-app grants
  whose user has not signed in for 90 days (D2), with a scoped read route
  (for example `GET /api/access/stale`, filtered by the management-read rule
  and paginated with the opaque cursor) and bulk removal.
- **Why deferred:** Not in the 4R.4 brief. The quarterly access review
  already flags stale items, and a removal goes through the existing member
  and admin-scope routes.
- **Adopt when:** the quarterly access review finds stale items that an
  admin has to clean up one by one, **or** pending invitations pile up
  unbound, **or** a scoped admin asks to see their own stale items (the
  access review is `internal-admin`/`internal-auditor` only).
- **References:** [Access Control spec](specs/2026-11-10-access-control.md) —
  *Membership, admin scopes and lifecycle* (*Leaver*), *Access review*, D2,
  D34; [Design System](specs/2026-05-15-design-system.md) — *Settings Page*.

---

## LiteLLM

### Shared LiteLLM team mode (LiteLLM writes for unlinked app teams)

- **Status:** Deferred (decided 2026-11-17, agent under the user's delegation;
  LiteLLM spec LD32, App Teams spec AT4).
- **What:** Let a Lead manage budgets, limits and keys in LiteLLM for an app
  team that has no LiteLLM team of its own, where its members sit in a
  LiteLLM team shared with other app teams.
- **Why deferred:** The members' keys and budgets live in a LiteLLM team that
  includes people outside the Lead's scope, and the key ownership check
  (`/key/info` `team_id` equals the linked team) has no equivalent there. An
  unlinked team gets read-only member-sum spend in L4b.
- **Adopt when:** Leads of unlinked teams need to set member budgets or manage
  keys themselves, **and** a scoping rule (for example per-member ownership
  checks or a LiteLLM-side team split) keeps every write inside the Lead's
  scope.
- **References:** [App Teams spec](specs/2026-11-17-app-teams.md) — *Decisions*
  (AT4); [LiteLLM spec](specs/2026-11-10-litellm.md) — *Writes*, LD32, LT5.

### Member daily spend on unlinked app teams

- **Status:** Deferred (decided 2026-11-17, Slice B2b; Design System —
  *Management pages* → *Team page views and links*, G1).
- **What:** The Team page's "Daily spend" action on the member-sum rows of an
  unlinked app team, so a Lead can open each member's daily spend there too.
- **Why deferred:** `GET /api/litellm/users/[litellmUserId]` scopes a Lead by
  membership of a *linked* LiteLLM team in scope; an unlinked team's members
  sit in any LiteLLM team. Widening it means scoping by app-team affiliation
  (LiteLLM spec LD23, LT23), a route and threat-model change outside B2b.
- **Adopt when:** Leads of unlinked teams ask to see per-member daily spend,
  **or** the follow-up unit C (cleanups after B2b) takes the route scope change
  with its own security review.
- **References:** [Design System](specs/2026-05-15-design-system.md) —
  *Management pages*; [LiteLLM spec](specs/2026-11-10-litellm.md) — *API
  routes*, LD23, LT23; [App Teams spec](specs/2026-11-17-app-teams.md).

### Membership history (daily membership snapshot)

- **Status:** Deferred (decided 2026-11-17, App Teams spec — *Residual
  risks*).
- **What:** A daily snapshot of app-team membership, so the member sum for a
  past date range uses the members at the time and a mover's earlier spend
  stays with the old team.
- **Why deferred:** Needs a scheduler and a new stored entity; membership is
  read as it is now, and the difference shows only when people change team.
- **Adopt when:** moves between teams are frequent enough that historical team
  spend is visibly wrong, **or** a finance review needs spend attributed to
  the team a person belonged to at the time, **or** the Phase 6 scheduler can
  host the snapshot at no extra cost.
- **References:** [App Teams spec](specs/2026-11-17-app-teams.md) — *Residual
  risks*; [LiteLLM spec](specs/2026-11-10-litellm.md) — *Residual risks*;
  [Access Control spec](specs/2026-11-10-access-control.md) — *Membership,
  admin scopes and lifecycle*.

---

## Security & CI

### Script and style Content Security Policy

- **Status:** Deferred.
- **What:** A full `Content-Security-Policy` (`script-src`, `style-src`,
  `connect-src`) on dashboard responses, beyond the `frame-ancestors 'none'`
  directive v1 sets.
- **Why deferred:** A strict policy needs per-request nonces through the
  proxy, which makes every page dynamic, and Recharts and Tailwind's inline
  styles need `style-src` exceptions. The dashboard is internal, VPN-only and
  renders no user-authored HTML.
- **Adopt when:** The dashboard renders user-authored rich content, embeds
  third-party scripts, or a security review requires it.
- **References:** [Platform spec — *Runtime*](specs/2026-11-10-platform.md),
  [Rule 50](../.claude/rules/50-security-and-secrets.md).

### Exact templated `allowed_routes` for the LiteLLM service key

- **Status:** Deferred (temporary wildcards in place since 2026-11-15).
- **What:** Replace the service key's temporary `/team/*` and `/key/*` with
  the three exact templated routes
  (`/team/{team_id}/member/{user_id}/reset_spend`, `/reset_budget`,
  `/key/{key}/regenerate`), so LiteLLM itself refuses hard-limit routes again.
- **Why deferred:** LiteLLM 1.109.1 matches `allowed_routes` only exactly,
  by prefix, by group or with a trailing `*`; templates never match. The
  operations are needed, so the dashboard's gateway guardrails stand in.
- **Adopt when:** LiteLLM (upstream or a company patch to its route checks)
  matches templated or mid-path wildcard routes; then remove the wildcards,
  the panel warning and the runbook note.
- **References:** [LiteLLM spec — *Service key `allowed_routes`*, LD4, LT3](specs/2026-11-10-litellm.md).

### GitHub Advanced Security / CodeQL

- **Status:** Deferred.
- **What:** Wire up CodeQL code scanning and dependency review.
- **Why deferred:** No application code exists until Phase 1, and GitHub
  Advanced Security on a private repo requires a paid plan. Secret defence is
  already covered by gitleaks (pre-commit, [Rule 50.5](../.claude/rules/50-security-and-secrets.md))
  plus GitHub push-protection secret scanning.
- **Adopt when:** Application code lands (Phase 1+) and the repo is on a plan
  that includes GHAS, or is made public.
- **References:** [github-best-practices §20](guides/github-best-practices.md).

### Enforced branch protection on `main`

- **Status:** Blocked (external dependency).
- **What:** Make the documented branch-protection rules (required checks,
  squash-only, restricted force-push) actually enforced rather than advisory.
- **Why blocked:** Classic branch protection and rulesets both require GitHub
  Pro or a public repo; this is a free private repo. The rules are documented
  and followed manually ([Rule 30.5](../.claude/rules/30-phase-discipline.md),
  [Rule 50.5](../.claude/rules/50-security-and-secrets.md)) in the meantime.
- **Adopt when:** The repo moves to GitHub Pro/Team or becomes public.
- **References:** branch-protection table in
  [`.github/ACTIONS.md`](../.github/ACTIONS.md), [Rule 31](../.claude/rules/31-github-flow.md).

### Self-hosted GitHub Actions runners on AWS (instance/task role instead of OIDC)

- **Status:** Deferred.
- **What:** Run deploy/run/destroy on **self-hosted runners on AWS compute** that
  carry an IAM role/instance profile directly, sourcing AWS credentials from
  instance/container metadata instead of the GitHub OIDC → `DeployerRole`
  exchange. Options (each gets credentials from an attached identity, never
  static keys):
  - **CodeBuild as a runner** — managed, ephemeral per-job; CodeBuild **service
    role**. AWS-native, nothing to patch — the recommended start.
  - **EC2 + instance profile** — ephemeral (`machulav/ec2-github-runner`) or an
    autoscaling pool (`philips-labs/terraform-aws-github-runner`); creds via the
    **instance profile** over IMDSv2.
  - **ECS / Fargate + task role** — runners as containers; creds via the **task
    role**. Fargate has no EC2 hosts to manage.
  - **EKS + Actions Runner Controller** — pod-per-job, pod-level IAM via IRSA /
    EKS Pod Identity; only worthwhile if EKS already exists.

  (Lambda is unsuitable — no persistent host, 15-minute cap.)
- **Why deferred:** GitHub-hosted runners + short-lived OIDC already meet the
  no-static-keys bar ([Rule 50.1](../.claude/rules/50-security-and-secrets.md)),
  scoped per-job and per-environment. Self-hosted compute adds standing cost
  (against the [Cost posture](../CLAUDE.md) for `workflow_dispatch`-only,
  infrequent jobs), ops burden (lifecycle, patching, autoscaling), and broader
  standing access than OIDC's per-run credentials.
- **Adopt when:** CI must reach **private VPC resources**, **or** volume makes
  self-hosted compute beat GitHub-hosted minutes, **or** builds need
  larger/cached compute. Start with CodeBuild-as-runner; reserve EKS/ARC for when
  EKS already exists.
- **References:** [Rule 50.1](../.claude/rules/50-security-and-secrets.md),
  `DeployerRole` OIDC trust in
  [`bedrock-simulator.md`](specs/2026-05-24-bedrock-simulator.md),
  [Cost posture](../CLAUDE.md),
  [github-best-practices](guides/github-best-practices.md).

---

## Development process

### Shared cache (Valkey)

- **Status:** Deferred (decided 2026-11-17, user; Phase 5 *Performance and
  caching*, unit PERF-5).
- **What:** A Redis-protocol driver behind the LiteLLM read cache
  (`lib/litellm/read-cache.ts`), enabled by a `CACHE_URL` variable in
  `env.ts`, with the in-process cache as the default. A `valkey` service in
  `.devcontainer/docker-compose.yml` (started on demand) and in
  `poc/docker-compose.yml`; in AWS, ElastiCache for Valkey in the dashboard's
  subnets, reachable from the task security group only, with TLS and auth.
  Never stored there: authorization data, sessions, key values. Rollups stay
  in the per-task Next.js cache.
- **Why deferred:** Data changes hourly and production runs two tasks. A
  shared cache only removes the short window in which the two tasks disagree
  after a LiteLLM write, and the `no-cache` refetch already covers the writer.
  It adds a paid resource (CLAUDE.md — *Cost posture*) and a network hop.
  As specified it does not cover the account list, which lives in the
  per-task Next.js cache and can be up to 1 hour old on the task that did
  not serve an account write (accepted; Data Model spec — *Access
  Patterns*). If this is adopted, decide in the same spec change whether
  the account list moves to the shared cache or gets shared invalidation.
- **Adopt when:** users report stale LiteLLM data that the refresh button
  does not clear, **or** an account change that shows late on one task
  causes a wrong result, **or** cold-cache latency after a deploy is a
  measured problem in PERF-0's baseline, **or** the service runs more than
  two tasks.
- **References:** [Design System spec](specs/2026-05-15-design-system.md) —
  *Technology decisions*, *Caching Strategy*;
  [Platform spec](specs/2026-11-10-platform.md) — *Not created*, *Runtime*;
  [LiteLLM spec](specs/2026-11-10-litellm.md) — *Caching*.

### Collector pre-aggregates

- **Status:** Deferred to the Phase 6 design (decided 2026-11-17, user).
- **What:** The hourly collector writes organisation, department and team
  daily summary items, so the Overview and the list pages read tens of small
  items instead of every account's rollup for the range.
- **Why deferred:** It changes Rule 20.7 (rankings computed in memory from
  all rollups) and the Data Model spec, and the collector does not exist yet.
  The per-day rollup cache is enough at the v1 size (≤100 accounts × 30 days).
- **Adopt when:** PERF-0's baseline shows the aggregate routes over their
  budget at the v1 size, **or** the account count passes 100, **or** Phase 6
  design starts (decide it there, not after).
- **References:** [Data Model spec](specs/2026-05-15-data-model.md) —
  *Entity: DailyRollup*; Rule 20.7.

### LiteLLM spend snapshot in DynamoDB

- **Status:** Deferred (decided 2026-11-17, user).
- **What:** The collector copies LiteLLM's daily spend per team and user into
  the table each hour, so LiteLLM spend pages read DynamoDB like the Bedrock
  pages. This is the supported alternative to reading LiteLLM's database,
  which the dashboard never does (LiteLLM spec — *Network*).
- **Why deferred:** The allowlisted daily-spend reads with the 60-second
  read cache cover the current pages.
- **Adopt when:** a LiteLLM spend view needs a range, a join or a ranking the
  API cannot serve within its budget, **or** LiteLLM outages make the spend
  pages unusable.
- **References:** [LiteLLM spec](specs/2026-11-10-litellm.md) — *Caching*,
  *Network*.

### Opus 4.8 dynamic workflows

- **Status:** Deferred (analysis complete; not adopted in v1).
- **What:** Large-scale parallel subagent orchestration for parallelizable
  build slices.
- **Why deferred:** The project's mandatory one-PR-per-phase discipline
  ([Rule 30.4](../.claude/rules/30-phase-discipline.md)) and the project's small
  scope sit below the feature's useful threshold. Full fit analysis already
  exists.
- **Adopt when:** See the conditions in the guide.
- **References:** [`guides/dynamic-workflows.md`](guides/dynamic-workflows.md).
