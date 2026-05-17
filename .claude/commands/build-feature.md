---
description: Build a feature through the typescript-developer → test-engineer → quality-reviewer agent loop
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

## Step 1 — typescript-developer

Dispatch the `typescript-developer` agent with the task description. On a
rework pass, also pass the consolidated REQUEST-CHANGES report from the
previous round.

## Step 2 — test-engineer

Dispatch the `test-engineer` agent with the typescript-developer's report and
changed files.

## Step 3 — Review (parallel fan-out)

In a **single message**, dispatch in parallel:

- `quality-reviewer` — holistic spec + rules + standards gatekeeper (always).
- `spec-guardian` — independent spec audit (always).
- `ecc:typescript-reviewer` — when `.ts`/`.tsx` changed (almost always).
- `ecc:security-reviewer` — when auth, Route Handlers, env, or AWS code
  changed.

## Step 4 — Aggregate

- If the **test-engineer** FAILED, or **any** reviewer returns REQUEST CHANGES /
  lists a BLOCKER → the verdict is **REQUEST CHANGES**.
- Consolidate every blocker into one deduplicated checklist.
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
Round n: typescript-developer → test-engineer <PASS|FAIL> → review <APPROVE|REQUEST CHANGES (k blockers)>
```

## Guardrails

- Never skip the test-engineer or quality-reviewer stage.
- Never commit, push, or use `--no-verify`.
- The typescript-developer is the **only** agent that edits code; test-engineer
  edits tests only; quality-reviewer and spec-guardian are read-only.
- If the loop cannot converge, the user decides — never lower the bar to
  force an APPROVE.
