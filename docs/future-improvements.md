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
