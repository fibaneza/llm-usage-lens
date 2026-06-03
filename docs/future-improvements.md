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

## Collector & infrastructure

### Multi-region collection

- **Status:** Deferred (documented future enhancement).
- **What:** Collect Bedrock cost/usage from regions beyond `us-east-1`.
- **Why deferred:** The collector targets `us-east-1` only by design
  ([Rule 50.7](../.claude/rules/50-security-and-secrets.md)); broadening scope
  silently is forbidden. v1 keeps the cross-account surface minimal.
- **Adopt when:** Bedrock usage in other regions becomes material to the cost
  picture.
- **References:** [Rule 50.7](../.claude/rules/50-security-and-secrets.md),
  [`system-architecture.md`](specs/2026-05-15-system-architecture.md).

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

## Security & CI

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
  [`.github/README.md`](../.github/README.md), [Rule 31](../.claude/rules/31-github-flow.md).

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
