---
description: Build a feature through the tdd-test-engineer → typescript-developer → quality-reviewer TDD agent loop
argument-hint: <feature or task description, e.g. "Phase 4.1 Overview KPI cards">
---

# /build-feature

Implement `$ARGUMENTS` by orchestrating the project agent team. You (the main
session) are the **orchestrator** — Claude Code subagents cannot call each
other, so you dispatch each agent and pass results between them.

See `.claude/rules/70-agent-workflow.md` for the contract. Each dispatch sets
the agent's model per its "Model routing" section.

## Step 0 — Plan

1. Read the spec section the feature touches and confirm it belongs to the
   **current phase** (`/phase-status`). If blocked, stop and report.
2. Restate the feature as a short, concrete task. If it spans multiple Phase 4
   sub-phases, ask the user to narrow it — one sub-phase per run (Rule 30.4).

## Step 1 — tdd-test-engineer (red)

Dispatch the `tdd-test-engineer` agent with the task description. It derives a
failing test suite from the spec — before any production code exists — and
reports the expected red state. On a rework pass, also pass the consolidated
REQUEST-CHANGES checklist so each behavioural blocker is encoded as a failing
test first (non-behavioural blockers skip this stage — Rule 70.6).

## Step 2 — typescript-developer (green)

Dispatch the `typescript-developer` agent with the task description and the
tdd-test-engineer's red report. It implements until the suite passes and the
gates (`tsc`, `eslint`, `vitest`, plus the headless Playwright suite when the
task touches UI) are green — without editing any test. If it
disputes a test, re-dispatch the `tdd-test-engineer` for a ruling (UPHOLD /
AMEND), then resume. Both agents run only new and impacted tests (the files
they work on, then `vitest run --changed <merge-base>`) and read results, not
logs; the full suite runs once, on the `main` candidate (Rule 70.12).

## Step 3 — Review (once per phase)

Run this step **once per phase**, when the phase is green (Rule 70.12). First run the
branch gate yourself (typecheck, lint, format and the impacted tests) and put
its evidence (exit codes and counts) in each brief. The full `pnpm check`
runs later, once, on the `main` candidate. A rework pass after REQUEST CHANGES re-reviews only the blocker fixes,
the diff since the last reviewed commit.

In a **single message**, dispatch in parallel:

- `quality-reviewer` — holistic spec + rules + standards + security
  gatekeeper (always). It re-runs only the gates the evidence does not
  cover, and reads results, not logs.
- `spec-guardian` — independent spec audit, only when the phase changed
  `docs/specs/**` or `.claude/rules/**`.
- `playwright-ui-reviewer` — when UI components or pages changed
  (`apps/dashboard/components/**`, `apps/dashboard/app/**`,
  `apps/dashboard/e2e/**`): runs the headless Playwright suite (the
  devcontainer has no display — never `--headed`) and audits that every
  changed component is exercised by a spec.
- `ecc:typescript-reviewer` — when `.ts`/`.tsx` changed (almost always).
- `ecc:security-reviewer` — when auth, Route Handlers, env, or AWS code
  changed.

If the `ecc:*` agents are unavailable (external plugin, not installed
everywhere), record "not available" in the review summary and continue —
`quality-reviewer` then also covers TypeScript idiom and security explicitly.

## Step 4 — Aggregate

- If any gate is not green at review time, or **any** reviewer returns
  REQUEST CHANGES / lists a BLOCKER → the verdict is **REQUEST CHANGES**.
- Consolidate every blocker into one deduplicated checklist, marking which
  blockers are behavioural (those re-enter at the tdd-test-engineer).
- Otherwise the verdict is **APPROVE**.

## Step 5 — Loop or finish

- **REQUEST CHANGES** → go back to Step 1 (rework pass) with the consolidated
  checklist. **Cap at 3 iterations.** If still not approved after 3, stop and
  hand the open blockers to the user — do not loop further.
- **APPROVE** → summarize what was built, the files changed, and the test
  results. Suggest `/commit`. Do **not** commit automatically.

## Report each round

Print a one-line status per round so the loop is visible:

```
Round n: tdd-test-engineer (red) → typescript-developer <GREEN|BLOCKED> → review <APPROVE|REQUEST CHANGES (k blockers)>
```

## Guardrails

- Never skip the tdd-test-engineer or quality-reviewer stage — tests come first,
  even on a one-line fix.
- Never commit, push, or use `--no-verify`.
- The typescript-developer is the **only** agent that edits production code
  and never edits tests; the tdd-test-engineer edits tests only; quality-reviewer
  and spec-guardian are read-only.
- If the loop cannot converge, the user decides — never lower the bar to
  force an APPROVE.
