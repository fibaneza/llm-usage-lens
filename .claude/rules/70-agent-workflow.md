# Rule 70 — Developer → Tester → Reviewer workflow

Non-trivial feature work runs through a three-agent loop. Run it with the
`/feature` command; this rule is the contract behind it.

## The agents

| Agent | Role | Edits | Defined in |
|---|---|---|---|
| `developer` | Implements the feature per specs + rules | code + first tests | `.claude/agents/developer.md` |
| `tester` | Hardens and runs the test suite, runs the gates | tests only | `.claude/agents/tester.md` |
| `reviewer` | Gatekeeper — APPROVE / REQUEST CHANGES | nothing (read-only) | `.claude/agents/reviewer.md` |

The review stage also fans out to existing agents — `spec-guardian`
(project, spec audit) and the ecc plugin reviewers `ecc:typescript-reviewer`
and `ecc:security-reviewer`. They do not replace `reviewer`; they add
language and security depth.

## The loop

```
        ┌──────────────────────────────────────────┐
        ▼                                          │ REQUEST CHANGES
   developer ──▶ tester ──▶ review (reviewer +      │ (consolidated
                            spec-guardian +         │  blockers)
                            ecc reviewers)          │
                                  │ APPROVE         │
                                  ▼                 │
                              done ─────────────────┘
```

## Rules

1. **The main session orchestrates.** Claude Code subagents cannot invoke
   each other — the `/feature` command dispatches each agent and carries
   results between stages.
2. **No stage is skipped.** Every change goes developer → tester → review,
   even on a one-line fix.
3. **REQUEST CHANGES if** the tester reports `FAIL` **or** any reviewer
   raises a BLOCKER. WARN and NIT findings do not block.
4. **Rework loops back to `developer`** with one consolidated, deduplicated
   blocker checklist — never to the tester or reviewer directly.
5. **Cap at 3 iterations.** If the loop has not converged after three rounds,
   stop and hand the open blockers to the user. Never weaken a test or lower
   the review bar to force an APPROVE.
6. **Role boundaries hold:** only `developer` edits production code; `tester`
   edits tests only; `reviewer` and `spec-guardian` are strictly read-only.
7. **The loop never commits.** On APPROVE the orchestrator summarises and
   suggests `/commit` — the user commits.
8. **One Phase 4 sub-phase per run** (Rule 30.4). Larger requests are split
   before the loop starts.

## When to use

- **Use the loop** for any feature, page, Route Handler, or non-trivial fix —
  anything from Phase 4 onward, and any multi-file change earlier.
- **Skip the loop** for pure scaffolding (`/new-route`, `/new-data-access`,
  `/seed`), docs, and config — still run `/lint` and `spec-guardian` as
  appropriate.
