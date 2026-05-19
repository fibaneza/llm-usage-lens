# Rule 70 — typescript-developer → test-engineer → quality-reviewer workflow

Non-trivial feature work runs through a three-agent loop. Run it with the
`/build-feature` command; this rule is the contract behind it.

## The agents

| Agent | Role | Edits | Defined in |
|---|---|---|---|
| `typescript-developer` | Implements the feature per specs + rules | code + first tests | `.claude/agents/typescript-developer.md` |
| `test-engineer` | Hardens and runs the test suite, runs the gates | tests only | `.claude/agents/test-engineer.md` |
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
typescript-developer ─▶ test-engineer ─▶ review ────────┤
                                            │ APPROVE   │
                                            ▼           │
                                          done ─────────┘

review = quality-reviewer + spec-guardian + ecc reviewers
```

## Rules

1. **The main session orchestrates.** Claude Code subagents cannot invoke
   each other — the `/build-feature` command dispatches each agent and carries
   results between stages.
2. **No stage is skipped.** Every change goes typescript-developer →
   test-engineer → review, even on a one-line fix.
3. **REQUEST CHANGES if** the test-engineer reports `FAIL` **or** any reviewer
   raises a BLOCKER. WARN and NIT findings do not block.
4. **Rework loops back to `typescript-developer`** with one consolidated,
   deduplicated blocker checklist — never to the test-engineer or
   quality-reviewer directly.
5. **Cap at 3 iterations.** If the loop has not converged after three rounds,
   stop and hand the open blockers to the user. Never weaken a test or lower
   the review bar to force an APPROVE.
6. **Role boundaries hold:** only `typescript-developer` edits production
   code; `test-engineer` edits tests only; `quality-reviewer` and
   `spec-guardian` are strictly read-only.
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
