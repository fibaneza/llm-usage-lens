# GitHub Repository & GitHub Actions Best Practices

This guide states **general** GitHub and GitHub Actions practice **and how this
project applies it**. Where it differs from
[Rule 31 — GitHub Flow](../../.claude/rules/31-github-flow.md) or the
operational detail in [`.github/ACTIONS.md`](../../.github/ACTIONS.md), **those
win** (Rule 00 — specs and rules are the source of truth). Project-specific
behaviour is called out in **In this project** notes throughout.

---

## Repository Structure & Governance

### 1. Standardize Repository Layout

A predictable structure reduces onboarding time and automation complexity.

```txt
.
├── .github/
│   ├── workflows/
│   ├── actions/                # composite actions (this project's reuse unit)
│   ├── scripts/                # workflow helper scripts
│   ├── ISSUE_TEMPLATE/
│   ├── pull_request_template.md
│   ├── CODEOWNERS
│   ├── CONTRIBUTING.md
│   ├── SECURITY.md
│   └── dependabot.yml
├── docs/
├── apps/                       # dashboard + collector (pnpm workspace)
├── packages/                   # shared Zod schemas, model normalization
├── scripts/                    # table setup + seeds (pnpm tsx)
├── .editorconfig
├── .gitattributes
├── .gitignore
├── README.md
└── LICENSE
```

Important files:

- `README.md` → quick start + architecture
- `.github/CONTRIBUTING.md` → local development + PR rules
- `.github/SECURITY.md` → vulnerability disclosure process
- `.github/CODEOWNERS` → review ownership
- `.editorconfig` → consistent editor defaults
- `.gitattributes` → line endings and diff/merge rules

> **In this project.** Phases 1–2 are complete, so most of the layout above is
> in place: the pnpm monorepo (`apps/dashboard`, `packages/shared`), the root
> config files, and the dashboard layout shell. `scripts/` still arrives with
> Phase 3 (see [Rule 30](../../.claude/rules/30-phase-discipline.md)).
> `CONTRIBUTING.md` and `SECURITY.md` live under `.github/`, not the repo root.

---

### 2. Protect the Default Branch

Recommended settings:

- Require PRs before merge
- Require status checks
- Require up-to-date branches
- Require approvals (minimum 1–2)
- Dismiss stale approvals
- Restrict force pushes
- Restrict direct pushes to `main`
- Require signed commits (optional but recommended)
- Require conversation resolution

> **In this project.** The exact required-check names and the squash-merge-only
> policy live in the branch-protection table in
> [`.github/ACTIONS.md`](../../.github/ACTIONS.md#required-branch-protection-on-main).
> Branch protection is currently **advisory** — classic protection and rulesets
> both require GitHub Pro or a public repo, which this free private repo does not
> have. The manual counterparts are Rule 30.5 ("never commit or merge directly
> to `main`") and Rule 50.5 ("never `--no-verify`").

---

### 3. Use CODEOWNERS

Example:

```txt
# Global owners
* @platform-team

# Infrastructure
/infra/ @devops-team

# Security-sensitive
/.github/ @security-team
```

Benefits:

- Automatic reviewers
- Ownership clarity
- Faster reviews
- Reduced security risk

> **In this project.** [`.github/CODEOWNERS`](../../.github/CODEOWNERS) already
> exists. It is single-owner (`@fibaneza`) and *aspirational* — rules take
> effect once a collaborator is added or "Require review from Code Owners" is
> enabled. Its security-sensitive paths mirror the `SENSITIVE` regex in
> `.github/scripts/claude/lib/sensitive-paths.sh`; keep the two in sync.

---

## Git Workflow Best Practices

### 4. Use GitHub Flow (Short-Lived Branches off `main`)

This project follows
[GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow),
not trunk-based commits-to-`main` and not GitFlow.

Pattern:

- `main` is always deployable and is the **only** long-lived branch
- Short-lived branches off `main`, merged back via pull request
- Small PRs, frequent merges
- **Squash-merge** — the PR title becomes the sole commit on `main`

Avoid:

- Long-lived branches and giant weekly merges
- Direct commits to `main`
- Complex GitFlow (`develop`/`release` branches) — forbidden here

Branch naming (per [Rule 31](../../.claude/rules/31-github-flow.md)):

```txt
feature/phase-<n>-<slug>     # phase work, e.g. feature/phase-1-foundation
feature/<slug>               # general feature
fix/<slug>                   # bug fix
ci/<slug>                    # CI / GitHub Actions
docs/<slug>                  # documentation
chore/<slug>                 # maintenance
```

> **In this project.** Phase work uses `feature/phase-<n>-<slug>` and ships one
> phase (or one Phase 4 sub-phase) per PR — see
> [Rule 30](../../.claude/rules/30-phase-discipline.md). The GitHub-side
> lifecycle is documented in
> [`.github/ACTIONS.md`](../../.github/ACTIONS.md#github-flow).

---

### 5. Keep Commits Atomic

Good:

```txt
fix(auth): validate expired JWT tokens
```

Bad:

```txt
misc fixes
```

Use:

- [Conventional Commits](https://www.conventionalcommits.org/) — enforced by
  commitlint (commit-msg hook) locally and by `github-pr-title-lint.yml` on the PR title
- Small logical changes
- Squash before merge

Types used here: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

---

### 6. Squash Merge Most PRs

Advantages:

- Cleaner history
- Easier rollbacks
- Removes noisy intermediate commits

> **In this project.** Squash-merge is the **only** permitted merge strategy —
> merge commits and rebase-merge are disabled. Because the PR title becomes the
> sole commit message on `main`, PR titles **must** pass `github-pr-title-lint.yml`
> (Conventional Commits).

---

## Pull Request Best Practices

> **In this project.** Open PRs as **drafts by default** — `gh pr create --draft`.
> A draft keeps the automated Claude review and the "ready" signal off until the
> branch is actually complete; mark it ready with `gh pr ready` (or the GitHub
> UI) when the phase's Verify checklist passes. See
> [Rule 31 — PR lifecycle](../../.claude/rules/31-github-flow.md).

### 7. Keep PRs Small

Ideal PR:

- Single responsibility
- Reviewable quickly (target < ~300 changed lines)

Large PRs reduce review quality, security detection, and merge velocity. They
also cost more on the automated reviewer (see §9).

---

### 8. Use a PR Template

> **In this project.** The PR template already exists at
> [`.github/pull_request_template.md`](../../.github/pull_request_template.md)
> and GitHub pre-fills it on every new PR. Its required sections are **Summary**,
> **Linked issue** (`Closes #n`), **Test plan**, **Reviewer guidance**, and
> **Phase** (cite the phase + spec section per Rule 00; remove for CI/docs/chore
> PRs). The HTML comment at the top restates the Conventional-Commits title rule.

---

### 9. Require Checks Before Merge

General minimum: build, unit tests, lint, type check, security scan.

> **In this project.** The status checks tracked on `main` are:
>
> - **`PR Title Lint`** (`github-pr-title-lint.yml`) — Conventional-Commits PR title.
> - **`Claude PR Review`** (`claude-pr-review.yml`) — inline review + security;
>   HIGH security findings submit a `REQUEST_CHANGES` review and fail the check.
> - **Phase-1 CI** (added in Phase 1): `prettier --check`, `eslint`,
>   `tsc --noEmit`, `vitest run`, `next build`, gitleaks.
>
> These are *advisory* until branch protection can be enforced (see §2). The
> full split between PR-time review and the release audit is in
> [`.github/ACTIONS.md`](../../.github/ACTIONS.md#how-the-two-reviewers-split-work).

---

### 10. Enforce Review Quality

Good reviews focus on correctness, security, maintainability, operational
impact, and rollback strategy. Avoid bare `LGTM`; prefer actionable comments,
architectural discussion, and threat modeling for sensitive changes.

> **In this project.** Non-trivial features run the
> `tdd-test-engineer → typescript-developer → quality-reviewer` TDD loop
> ([Rule 70](../../.claude/rules/70-agent-workflow.md), via `/build-feature`),
> and the automated `Claude PR Review` posts inline findings with one-click
> suggestion blocks. Human review still owns the final approval.

---

## GitHub Actions Best Practices

### 11. Factor Out Reusable Logic

General options: reusable workflows (`workflow_call`) and composite actions.

> **In this project.** Shared logic lives in **composite actions** under
> [`.github/actions/`](../../.github/actions) (`github-review`,
> `github-post-pr-security-comment`, `github-create-audit-issues`) and helper
> scripts under `.github/scripts/claude/`. The `SENSITIVE` regex is sourced from
> one file (`.github/scripts/claude/lib/sensitive-paths.sh`) so both the PR-time
> and release workflows pick up a single edit.

---

### 12. Pin Action Versions

Never track a moving ref:

```yaml
uses: actions/checkout@main
```

Acceptable — a major-version tag:

```yaml
uses: actions/checkout@v5
```

Best — a full-length commit SHA (optionally with a version comment):

```yaml
uses: actions/checkout@<full-40-char-sha> # v5.0.0
```

Per GitHub's security hardening docs, "pinning an action to a full-length commit
SHA is currently the only way to use an action as an immutable release" — a tag
can be moved by whoever controls the action repo, a SHA cannot.

> **In this project.** [`.github/dependabot.yml`](../../.github/dependabot.yml)
> runs the `github-actions` ecosystem weekly, so pins are bumped automatically
> (labelled `chore`). Keep third-party actions at a pinned ref; let Dependabot
> raise the upgrade PRs.

---

### 13. Minimize Permissions

Set a restrictive default at the **workflow** level, then elevate **per job**
only where needed. Any scope not listed defaults to `none`.

```yaml
# workflow level — safe default
permissions:
  contents: read

jobs:
  deploy:
    permissions:
      contents: read
      id-token: write # only this job needs OIDC
```

GitHub's guidance: "set the default permission for the `GITHUB_TOKEN` to read
access only for repository contents … then increase permissions as required for
individual jobs." Avoid `permissions: read-all` / `write-all` as a default —
`read-all` grants read across *every* scope rather than the minimum. `id-token:
write` should appear **only** on jobs that exchange an OIDC token.

> **In this project.** Both review workflows declare per-job `permissions:`
> blocks. The repo also needs Settings → Actions → Workflow permissions set to
> "Read and write" because the workflows post PR comments and create issues —
> see [`.github/ACTIONS.md`](../../.github/ACTIONS.md#required-repository-configuration).

---

### 14. Never Store Secrets in Repositories

Use GitHub Secrets, OIDC federation, and cloud IAM roles. Avoid long-lived
cloud keys, committed `.env` files, and hardcoded tokens.

Best modern approach: **GitHub Actions OIDC → short-lived cloud credentials**.

> **In this project.** [Rule 50.1](../../.claude/rules/50-security-and-secrets.md)
> forbids static `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — real AWS access
> is `aws sso login` + `AWS_PROFILE` locally, and OIDC-assumed roles in CI.
> gitleaks runs in pre-commit so secrets never reach a commit (Rule 50.5). The
> Claude review workflows authenticate with `CLAUDE_CODE_OAUTH_TOKEN` (OAuth),
> not an API key; OIDC `id-token` is only flipped to `write` if a job routes
> through Bedrock/Vertex.

---

### 15. Separate CI and CD

- **CI** runs on pull requests and pushes: tests, lint, validation.
- **CD** runs after merge, with manual approvals, into protected environments.

> **In this project.** CI is the Phase-1 workflow (§9). "CD" for the collector
> is `sam build && sam deploy` via an OIDC-assumed role into the observability
> account — see the [aws-infrastructure runbook](aws-infrastructure.md); the
> dashboard deploys to Netlify (see [dashboard-deployment](dashboard-deployment.md)).

---

## Infrastructure as Code (IaC)

### 16. Treat Infrastructure Like Application Code

Use PR reviews, automated validation, policy checks, and testing for infra the
same as for application code.

> **In this project.** IaC is **AWS SAM** (for the collector) and **plain
> CloudFormation** (for the cross-account `CostExplorerReadRole`) — not
> Terraform/OpenTofu/Pulumi. See the
> [aws-infrastructure runbook](aws-infrastructure.md) and
> [system-architecture spec](../specs/2026-05-15-system-architecture.md).

---

### 17. Validate Infrastructure in CI

For this project's SAM/CloudFormation stack:

```bash
sam validate --lint          # template + best-practice lint
cfn-lint template.yaml       # CloudFormation linter
```

Add security/compliance scanning of templates. The `deploy-on-aws:awsiac` MCP
tooling available in this repo wraps `cfn-lint`, cfn-guard compliance checks, and
pre-deploy change-set validation.

> **In this project.** The collector targets `us-east-1` only (Rule 50.7);
> destructive infra commands (`sam delete`, `aws cloudformation delete-stack`,
> `aws … delete-*`) are hard-blocked by the `.claude/settings.json` deny-list.

---

### 18. Use Environment Protection Rules

Production deployments should require manual approval, restricted deployers, and
an audit trail. GitHub Environments support this natively.

> **In this project.** Sandbox/deploy work uses a GitHub Environment with a
> required reviewer and Environment-scoped variables for OIDC role access.

---

## Security Best Practices

### 19. Enable Dependency Automation

Use Dependabot for version and security updates with automated PRs.

> **In this project.** [`.github/dependabot.yml`](../../.github/dependabot.yml)
> currently covers the `github-actions` ecosystem (weekly). The `npm` ecosystem
> block is added in Phase 1 once `package.json` exists (noted in the file).

---

### 20. Enable Secret Scanning & Code Scanning

Enable secret scanning, dependency review, and CodeQL where available (GitHub
Advanced Security on private repos requires a paid plan).

> **In this project.** Defence-in-depth for secrets is **gitleaks in pre-commit**
> (Rule 50.5) plus GitHub's push-protection secret scanning. CodeQL is not wired
> yet (no application code until Phase 1).

---

### 21. Protect Actions from Untrusted PRs

Avoid `pull_request_target` (which runs with repo secrets in the base-branch
context) unless its risks are fully understood; prefer `pull_request` for
fork-originating PRs.

> **In this project.** The review workflows trigger on `pull_request` events and
> skip drafts + doc-only changes via `paths-ignore`. There is no
> `pull_request_target` usage.

---

### 22. Use Immutable Build Artifacts

1. Build the artifact once.
2. Sign it.
3. Promote the same artifact across environments — never rebuild per environment.

> **In this project.** SAM bundles the Lambda with `BuildMethod: esbuild`,
> inlining `@bedrock-usage/shared`; the built bundle is what deploys.

---

## CI/CD Architecture Patterns

### 23. Prefer Pipeline Stages

A typical staged pipeline:

```txt
Lint → Unit Tests → Security Scan → Build Artifact
  → Integration Tests → Deploy Staging → Smoke Tests
    → Manual Approval → Deploy Production
```

---

### 24. Cache Dependencies Carefully

Cache package managers (pnpm, npm, pip, Gradle, Maven) with correct keys and
no stale-dependency risk.

> **In this project.** Cache the **pnpm** store via `actions/setup-node` with
> `cache: pnpm` (after `pnpm/action-setup`), keyed on `pnpm-lock.yaml`.

---

### 25. Use Concurrency Controls

Prevent overlapping runs:

```yaml
concurrency:
  group: production
  cancel-in-progress: false
```

> **In this project.** `claude-pr-review.yml` uses
> `group: claude-pr-review-<pr-number>` with `cancel-in-progress: true` so a new
> push cancels the older in-flight review; the release audit groups per tag.

---

## Monorepo Best Practices

> **In this project.** The monorepo is a **pnpm workspace** (`apps/*` +
> `packages/shared`) — no Nx, Turborepo, or Bazel. Keep CI cheap with:
>
> - **Path filtering** — `paths-ignore` already skips doc-only PRs in
>   `claude-pr-review.yml`; use path filters to scope per-package jobs.
> - **Shared package** — `packages/shared` is imported by both `apps/dashboard`
>   and `apps/collector` so model normalization and schemas never drift
>   ([Rule 20.5](../../.claude/rules/20-data-model-conventions.md)).
>
> Avoid running the full suite for every small change.

---

## Operational Excellence

### 26. Make Workflows Observable

Add deployment notifications, test summaries, annotations, and metrics.

> **In this project.** The devcontainer ships an OpenTelemetry → Prometheus /
> Loki / Grafana stack; app and collector emit OTLP (`@vercel/otel`). Workflow
> scope decisions are written to the GitHub job summary for auditability.

---

### 27. Keep Workflows Fast

Target CI feedback under ~10 minutes via parallel jobs, incremental builds,
caching, matrix optimization, and selective testing.

> **In this project.** The Claude workflows cap cost/time with `--max-turns`,
> `timeout-minutes: 25`, draft/`paths-ignore` skips, always-incremental
> `synchronize` reviews, and release-tag-scoped audits — see
> [Cost characteristics](../../.github/ACTIONS.md#cost-characteristics).

---

## Recommended Baseline Stack

| Area | Baseline | This project |
| --- | --- | --- |
| Repository | Branch protection, CODEOWNERS, PR template, Conventional Commits | All present (protection advisory) |
| CI | Reusable logic, parallel jobs, strict required checks | Composite actions + Phase-1 CI |
| Security | OIDC, secret scanning, dependency scanning, pinned actions | OIDC + gitleaks + Dependabot |
| Infrastructure | Policy-as-code, automated plan reviews | SAM + CloudFormation, cfn-lint / cfn-guard |
| CD | Protected environments, artifact promotion, manual prod approval | SAM deploy via OIDC; GitHub Environment |

---

## Example CI Workflow (pnpm, illustrative)

The real workflows live in
[`.github/workflows/`](../../.github/workflows); this is a minimal pattern for
the Phase-1 CI.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prettier --check .
      - run: pnpm exec eslint .
      - run: pnpm exec tsc --noEmit
      - run: pnpm exec vitest run
      - run: pnpm build
```

---

## Common Anti-Patterns

Avoid:

- Giant PRs
- Direct pushes to `main`
- Long-lived feature branches
- Storing secrets in repositories
- Unpinned GitHub Actions
- Over-broad workflow permissions (`write-all` / `read-all` as a default)
- `pull_request_target` with untrusted code
- Admin bypasses and `--no-verify` (Rule 50.5)
- Manual production changes
- Shared / long-lived cloud credentials
- Skipping reviews for infrastructure changes

---

## Strong Enterprise Pattern

```txt
GitHub Repository
   ↓
Protected PR Workflow (GitHub Flow + squash-merge)
   ↓
Composite Actions / Reusable Logic
   ↓
OIDC Cloud Authentication (no static keys)
   ↓
Immutable Build Artifact
   ↓
Environment Promotion (manual prod approval)
   ↓
Observability + Audit Logs
```

---

## Related project rules and docs

- [Rule 31 — GitHub Flow](../../.claude/rules/31-github-flow.md)
- [Rule 30 — Phase discipline](../../.claude/rules/30-phase-discipline.md)
- [Rule 50 — Security & secrets](../../.claude/rules/50-security-and-secrets.md)
- [`.github/ACTIONS.md`](../../.github/ACTIONS.md) — workflow internals, branch
  protection, cost controls
- [aws-infrastructure runbook](aws-infrastructure.md) — SAM deploy/undeploy
- GitHub docs: [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions),
  [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)
