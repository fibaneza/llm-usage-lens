# Rule 70 — tdd-test-engineer → typescript-developer → quality-reviewer workflow (TDD)

Non-trivial feature work runs through a three-agent, test-first loop. Run it
with the `/build-feature` command; this rule is the contract behind it.

## The agents

| Agent | Role | Edits | Defined in |
|---|---|---|---|
| `tdd-test-engineer` | Writes the failing test suite first (TDD red) from specs + rules | tests only | `.claude/agents/tdd-test-engineer.md` |
| `typescript-developer` | Implements the feature until the tests pass (TDD green) | production code only | `.claude/agents/typescript-developer.md` |
| `quality-reviewer` | Gatekeeper — APPROVE / REQUEST CHANGES | nothing (read-only) | `.claude/agents/quality-reviewer.md` |
| `playwright-ui-reviewer` | Headless browser verification of UI additions/modifications (review fan-out, UI changes only) | nothing (read-only) | `.claude/agents/playwright-ui-reviewer.md` |

The review stage also fans out to existing agents — `spec-guardian`
(project, spec audit), `playwright-ui-reviewer` (headless Playwright run +
e2e coverage audit, dispatched when UI components or pages changed) and the
ecc plugin reviewers `ecc:typescript-reviewer` and `ecc:security-reviewer`.
They do not replace `quality-reviewer`; they add browser, language, and
security depth. The `ecc:*` agents come from an external plugin that is not
installed in every environment: if unavailable, record "not available" in the
review summary and continue — `quality-reviewer` then covers TypeScript idiom
and security itself.

## Model routing

Set the model explicitly on every dispatch; the agent's frontmatter is the fallback:

| Model | Use for |
|---|---|
| opus (`claude-opus-5-5`) | Reasoning, design, review verdicts, hard debugging |
| sonnet (`claude-sonnet-5-5`) | Writing code and tests, medium tasks |
| haiku (`claude-haiku-5-5`) | Small mechanical tasks — lookups, running a gate and summarising, formatting |

Escalate haiku → sonnet on a wrong or uncertain result, and sonnet → opus after
failing the acceptance criteria twice; escalations count as retries. Review
gates never run below opus, except that `ecc:typescript-reviewer` runs on
sonnet and `ecc:security-reviewer` runs on opus.

## The loop

```
   ┌────────────────────────────────────────────────────┐
   │                                                    │ REQUEST CHANGES
   ▼                                                    │ (consolidated blockers)
tdd-test-engineer ─▶ typescript-developer ─▶ review ────────┤
    (red)             (green)               │ APPROVE   │
                                            ▼           │
                                          done ─────────┘

review = quality-reviewer + spec-guardian + ecc reviewers
         (+ playwright-ui-reviewer when UI components/pages changed)
```

## Rules

1. **The main session orchestrates.** Claude Code subagents cannot invoke
   each other — the `/build-feature` command dispatches each agent and carries
   results between stages.
2. **No stage is skipped.** Every change goes tdd-test-engineer →
   typescript-developer → review, even on a one-line fix.
3. **Tests lead, code follows.** The tdd-test-engineer derives a failing suite
   from the spec and task description *before* any production code exists.
   Failing gates at this stage are the expected **red** state, not a defect —
   the tdd-test-engineer reports which failures the implementation must clear.
4. **The typescript-developer's job is green.** It implements until the
   suite passes and runs the gates (`tsc`, `eslint`, `vitest`, plus the
   headless Playwright suite — `pnpm test:e2e` — when the change touches UI
   components or pages). It never
   edits, weakens, or deletes a test — a test it believes is wrong goes back
   to the orchestrator, who re-dispatches the tdd-test-engineer to rule on it.
5. **REQUEST CHANGES if** the gates are not green at review time **or** any
   reviewer raises a BLOCKER. WARN and NIT findings do not block. The
   quality-reviewer independently re-runs the gates (read-only) rather than
   trusting reports.
6. **Rework loops back to the top of the loop** with one consolidated,
   deduplicated blocker checklist: the tdd-test-engineer first encodes each
   behavioural blocker as a failing test, then the typescript-developer makes
   the suite green again. Blockers that change no behaviour (naming, dead
   code, comments) skip straight to the typescript-developer.
7. **Cap at 3 iterations.** If the loop has not converged after three rounds,
   stop and hand the open blockers to the user. Never weaken a test or lower
   the review bar to force an APPROVE.
8. **Role boundaries hold:** only `typescript-developer` edits production
   code; `tdd-test-engineer` edits tests only (Vitest **and** Playwright —
   e2e specs are tests); `quality-reviewer`, `spec-guardian`, and
   `playwright-ui-reviewer` are strictly read-only.
9. **The loop never commits.** No agent commits. On APPROVE the orchestrator
   summarises and suggests `/commit`; once the user has authorised the merge,
   the orchestrator may squash-merge into local `main` per
   [Rule 31](31-github-flow.md) *Integration workflow*.
10. **One Phase 4 sub-phase per run** (Rule 30.4). Larger requests are split
    before the loop starts.
11. **E2E runs headless, always.** The devcontainer has no display server —
    `apps/dashboard/playwright.config.ts` forces headless Chromium on a
    dedicated port (3211) with a forged-session sign-in helper
    (`e2e/support/session.ts`); no agent passes `--headed`/`--ui` or adds a
    production auth bypass for testability.

## When to use

- **Use the loop** for any feature, page, Route Handler, or non-trivial fix —
  anything from Phase 4 onward, and any multi-file change earlier.
- **Skip the loop** for pure scaffolding (`/new-route`, `/new-data-access`,
  `/seed`), docs, and config — still run `/lint` and `spec-guardian` as
  appropriate.
