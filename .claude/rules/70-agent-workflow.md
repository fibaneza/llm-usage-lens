# Rule 70 — test-engineer → typescript-developer → quality-reviewer workflow (TDD)

Non-trivial feature work runs through a three-agent, test-first loop. Run it
with the `/build-feature` command; this rule is the contract behind it.

## The agents

| Agent | Role | Edits | Defined in |
|---|---|---|---|
| `test-engineer` | Writes the failing test suite first (TDD red) from specs + rules | tests only | `.claude/agents/test-engineer.md` |
| `typescript-developer` | Implements the feature until the tests pass (TDD green) | production code only | `.claude/agents/typescript-developer.md` |
| `quality-reviewer` | Gatekeeper — APPROVE / REQUEST CHANGES | nothing (read-only) | `.claude/agents/quality-reviewer.md` |

The review stage also fans out to existing agents — `spec-guardian`
(project, spec audit) and the ecc plugin reviewers `ecc:typescript-reviewer`
and `ecc:security-reviewer`. They do not replace `quality-reviewer`; they add
language and security depth.

## The loop

```
   ┌────────────────────────────────────────────────────┐
   │                                                    │ REQUEST CHANGES
   ▼                                                    │ (consolidated blockers)
test-engineer ─▶ typescript-developer ─▶ review ────────┤
    (red)             (green)               │ APPROVE   │
                                            ▼           │
                                          done ─────────┘

review = quality-reviewer + spec-guardian + ecc reviewers
```

## Rules

1. **The main session orchestrates.** Claude Code subagents cannot invoke
   each other — the `/build-feature` command dispatches each agent and carries
   results between stages.
2. **No stage is skipped.** Every change goes test-engineer →
   typescript-developer → review, even on a one-line fix.
3. **Tests lead, code follows.** The test-engineer derives a failing suite
   from the spec and task description *before* any production code exists.
   Failing gates at this stage are the expected **red** state, not a defect —
   the test-engineer reports which failures the implementation must clear.
4. **The typescript-developer's job is green.** It implements until the
   suite passes and runs the gates (`tsc`, `eslint`, `vitest`). It never
   edits, weakens, or deletes a test — a test it believes is wrong goes back
   to the orchestrator, who re-dispatches the test-engineer to rule on it.
5. **REQUEST CHANGES if** the gates are not green at review time **or** any
   reviewer raises a BLOCKER. WARN and NIT findings do not block. The
   quality-reviewer independently re-runs the gates (read-only) rather than
   trusting reports.
6. **Rework loops back to the top of the loop** with one consolidated,
   deduplicated blocker checklist: the test-engineer first encodes each
   behavioural blocker as a failing test, then the typescript-developer makes
   the suite green again. Blockers that change no behaviour (naming, dead
   code, comments) skip straight to the typescript-developer.
7. **Cap at 3 iterations.** If the loop has not converged after three rounds,
   stop and hand the open blockers to the user. Never weaken a test or lower
   the review bar to force an APPROVE.
8. **Role boundaries hold:** only `typescript-developer` edits production
   code; `test-engineer` edits tests only; `quality-reviewer` and
   `spec-guardian` are strictly read-only.
9. **The loop never commits.** On APPROVE the orchestrator summarises and
   suggests `/commit` — the user commits.
10. **One Phase 4 sub-phase per run** (Rule 30.4). Larger requests are split
    before the loop starts.

## When to use

- **Use the loop** for any feature, page, Route Handler, or non-trivial fix —
  anything from Phase 4 onward, and any multi-file change earlier.
- **Skip the loop** for pure scaffolding (`/new-route`, `/new-data-access`,
  `/seed`), docs, and config — still run `/lint` and `spec-guardian` as
  appropriate.
