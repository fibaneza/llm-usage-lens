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
   typescript-developer, even on a one-line fix, and every phase passes the
   review before it reaches `main`. The review runs **once per phase**
   (rule 12), not after every iteration, run or slice.
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
   reviewer raises a BLOCKER. WARN and NIT findings do not block. Gates are
   never taken on trust: the orchestrator runs them itself on the commit
   under review and hands the reviewer the evidence (exit codes and counts).
   The reviewer re-runs only what that evidence does not cover, or a check
   it doubts (rule 12).
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
12. **Token economy (decided 2026-11-14, user).** Spend tokens where they
    catch defects, never by lowering the bar:
    - **One review per phase.** A phase or unit (for example 4R.3 or L1)
      gets one review fan-out when its suite is green, before it merges into
      `main`. Slices and iterations inside a phase get no review of their
      own, and **nothing reaches `main` before that review approves.** The
      review is `quality-reviewer` on opus, which also covers security and
      TypeScript idiom when the `ecc:*` agents are unavailable. Add
      `spec-guardian` only when the phase changed `docs/specs/**` or
      `.claude/rules/**`. Add `playwright-ui-reviewer` only when UI changed.
      A dedicated security review that a spec or prompt requires (4R.3,
      4R.4, L1, L2, L4) is part of this one review, not a separate round.
    - **Re-reviews are delta-scoped.** After REQUEST CHANGES, the next pass
      reviews only the blocker fixes (the diff since the last reviewed
      commit) against the blocker list, not the whole phase again. The
      3-round cap (rule 7) still applies.
    - **Targeted tests while iterating.** Red and green iterations run only
      the affected test files (`pnpm exec vitest run <paths>`, or
      `--project unit` when no DynamoDB code changed) and the targeted e2e
      spec (`pnpm test:e2e -- <spec>`).
    - **Full gates at fixed points only:** `pnpm check` once when the phase
      is green (the evidence for the review), and again before the merge
      only if commits landed after it. `pnpm test:e2e` (full) runs once per
      phase, and only when UI or auth changed.
    - **Results, not logs.** Every test, gate or build run is redirected to
      a file; agents and the orchestrator read only the exit code, the count
      lines (`Test Files`, `Tests`, Playwright passed/failed) and the names
      of failing tests. They open more of the log only to diagnose a
      specific failure. Every dispatch says so.
    - **Cheapest adequate model** for gate re-runs and git summaries
      (`haiku`); reviews stay on opus (Model routing above).

## When to use

- **Use the loop** for any feature, page, Route Handler, or non-trivial fix —
  anything from Phase 4 onward, and any multi-file change earlier.
- **Skip the loop** for pure scaffolding (`/new-route`, `/new-data-access`,
  `/seed`), docs, and config — still run `/lint` and `spec-guardian` as
  appropriate.
