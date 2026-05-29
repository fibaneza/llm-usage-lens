# Dynamic Workflows — where Opus 4.8's parallel orchestration fits this build

A fit analysis of Claude Code's **dynamic workflows** feature against this
project's phase plan. It records where the feature would help, where it would
not, and the guardrail any pilot must keep — so a future contributor can decide
whether to use it without re-deriving the trade-offs.

> Source of truth for the build plan: [docs/specs/2026-05-15-implementation-phases.md](docs/specs/2026-05-15-implementation-phases.md).
> Governance: [Rule 30](.claude/rules/30-phase-discipline.md) (phase discipline),
> [Rule 31](.claude/rules/31-github-flow.md) (GitHub Flow),
> [Rule 70](.claude/rules/70-agent-workflow.md) (agent workflow).
> This guide *navigates* those — it does not change them (Rule 00.3).

---

## 1. What dynamic workflows are

Dynamic workflows shipped with Claude Opus 4.8 (2026-05-28) and are in **research
preview**, available on **Enterprise, Team, and Max** plans.

You describe a large task; Claude writes a **JavaScript orchestration script**; a
runtime executes it **in the background** while your session stays responsive. The
script holds the loop, the branching, and the intermediate results, fanning out up
to **1,000 parallel subagents**, verifying their output against a bar — typically
**the existing test suite** — and surfacing only the final, verified result to the
conversation.

The defining traits are **massive parallel fan-out**, **an objective pass/fail
bar**, and **background autonomy with verified-only output**. The flagship example
is a ~750k-line Rust migration driven to 99.8% test-pass.

Sources:
[Anthropic — Introducing Claude Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8) ·
[The New Stack](https://thenewstack.io/claude-opus-48-release/) ·
[MarkTechPost (≤1,000-subagent cap)](https://www.marktechpost.com/2026/05/28/anthropic-ships-claude-opus-4-8-alongside-dynamic-workflows-and-cheaper-fast-mode-with-workflows-capped-at-1000-subagents/).

## 2. Why most of this build is below the threshold

The feature targets hundred-thousand-line, highly parallelizable work. This repo
is a small greenfield app — roughly **9 dashboard pages, 9 Route Handlers, and one
Lambda collector** (implementation-phases spec — Phase Summary). For most of the
plan, orchestrating hundreds of subagents is overkill: there simply are not
hundreds of independent units to fan out across.

## 3. The governance tension

The feature's instinct — one run, massive batch, merged at the end — is the
opposite of how this project is required to ship:

- **One Phase 4 sub-phase per PR** (Rule 30.4) and **one sub-phase per agent run**
  (Rule 70.8).
- **Strict phase order**; do not start a phase whose dependencies are unmet
  (Rule 30.1).
- **One PR per phase, squash-merged, with human review** (Rule 31).

A naive "fan out and merge once" dynamic-workflow run would violate all three. The
feature is therefore usable here only if it is constrained to emit **one PR per
unit** (see §6).

## 4. Where it fits, ranked

1. **Phase 5 — Polish & Accessibility (best fit).** Its tasks are inherently
   *cross-cutting and repetitive across all 9 pages*: an `ErrorBoundary` per
   section, the accessibility audit (contrast, aria-labels, focus rings,
   `prefers-reduced-motion`), responsive testing at the four breakpoints, and empty
   states. One subagent per page applying the same change, gated by Vitest +
   Playwright + an axe accessibility check, is exactly the "fan-out against a test
   bar" pattern (implementation-phases spec — Phase 5).
2. **Phase 4 reuse pages — *after* the shared components land.** Once 4.1 builds
   `MetricCard`/`CostTrendChart` and 4.2 builds `UsageTable`, the reuse-heavy pages
   (4.3 Departments, 4.5 Teams, 4.7 Services, 4.8 Users) are largely independent and
   could be built in parallel — **subject to the Rule 30.4 / 70.8 caveat in §3**:
   each must still ship as its own PR.
3. **Phase 3 — batch-scaffold the Route Handlers.** The Data Model spec's API
   Routes table defines ~9 handlers with one uniform contract (`{ data }` /
   `{ error }`, 401/400, Zod, 90-day cap). They can be scaffolded in parallel, each
   verified by its own handler test (Rule 60 §23). Bounded (~9), not "hundreds," but
   a clean parallel slice.

## 5. Where it does not fit

- **Phase 1 (Foundation)** — an irreducibly sequential bootstrap (toolchain, auth,
  theme); nothing to fan out.
- **Phase 6 (Collector)** — a single Lambda with sequential three-source merge
  logic; not parallelizable.
- **Anything before `packages/shared` exists** — the shared Zod schemas and
  `models.ts` are a serialization point every other unit depends on.

## 6. The guardrail, if piloted

The project already has the **objective bar** a dynamic workflow needs: every phase
has a *Verify* checklist, Rule 60 mandates Vitest, Route Handler tests assert the
response shape plus the 401/400 paths, and Phase 5 adds Playwright + axe. That
verification culture is what lets a fan-out run self-check.

The non-negotiable constraint is output shape: a pilot must emit **one branch and
one PR per unit** (per page, per handler), never a single bundled merge. That keeps
Rule 31 squash-merge, human review, and the per-phase Verify checklists fully in
force — the workflow accelerates the *building*, not the *gating*.

## 7. Status and next step

Not adopted in v1. The feature is research-preview maturity and most of the build is
below its scale threshold (§2). The natural point to evaluate a pilot is **Phase 5**,
on the cross-cutting accessibility/error-boundary pass (§4.1).

Any actual change to the one-PR-per-unit rules (30.4 / 70.8) is **out of scope of
this guide** and would require its own rule/spec PR — surface the conflict and
amend the rule explicitly rather than diverging silently (Rule 00.2).
