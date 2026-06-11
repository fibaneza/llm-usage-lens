---
description: Build a feature through the test-engineer → typescript-developer → quality-reviewer TDD agent loop
argument-hint: <feature or task description, e.g. "Phase 4.1 Overview KPI cards">
---

# /build-feature

Implement `$ARGUMENTS` by orchestrating the project agent team. You (the main
session) are the **orchestrator** — Claude Code subagents cannot call each
other, so you dispatch each agent and pass results between them.

See `.claude/rules/70-agent-workflow.md` for the contract.

## Step 0 — Plan

1. Read the spec section the feature touches and confirm it belongs to the
   **current phase** (`/phase-status`). If blocked, stop and report.
2. Restate the feature as a short, concrete task. If it spans multiple Phase 4
   sub-phases, ask the user to narrow it — one sub-phase per run (Rule 30.4).

## Step 1 — test-engineer (red)

Dispatch the `test-engineer` agent with the task description. It derives a
failing test suite from the spec — before any production code exists — and
reports the expected red state. On a rework pass, also pass the consolidated
REQUEST-CHANGES checklist so each behavioural blocker is encoded as a failing
test first (non-behavioural blockers skip this stage — Rule 70.6).

## Step 2 — typescript-developer (green)

Dispatch the `typescript-developer` agent with the task description and the
test-engineer's red report. It implements until the suite passes and the
gates (`tsc`, `eslint`, `vitest`) are green — without editing any test. If it
disputes a test, re-dispatch the `test-engineer` for a ruling (UPHOLD /
AMEND), then resume.

## Step 3 — Review (parallel fan-out)

In a **single message**, dispatch in parallel:

- `quality-reviewer` — holistic spec + rules + standards gatekeeper (always);
  independently re-runs the gates read-only.
- `spec-guardian` — independent spec audit (always).
- `ecc:typescript-reviewer` — when `.ts`/`.tsx` changed (almost always).
- `ecc:security-reviewer` — when auth, Route Handlers, env, or AWS code
  changed.

## Step 4 — Aggregate

- If any gate is not green at review time, or **any** reviewer returns
  REQUEST CHANGES / lists a BLOCKER → the verdict is **REQUEST CHANGES**.
- Consolidate every blocker into one deduplicated checklist, marking which
  blockers are behavioural (those re-enter at the test-engineer).
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
Round n: test-engineer (red) → typescript-developer <GREEN|BLOCKED> → review <APPROVE|REQUEST CHANGES (k blockers)>
```

## Guardrails

- Never skip the test-engineer or quality-reviewer stage — tests come first,
  even on a one-line fix.
- Never commit, push, or use `--no-verify`.
- The typescript-developer is the **only** agent that edits production code
  and never edits tests; the test-engineer edits tests only; quality-reviewer
  and spec-guardian are read-only.
- If the loop cannot converge, the user decides — never lower the bar to
  force an APPROVE.
