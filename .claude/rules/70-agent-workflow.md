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

Set the model explicitly on every dispatch; the agent's frontmatter is the fallback.
**Name the model when you start** (user, 2026-11-15): every session — worker
or coordinator — says which Claude model it will use when it starts a task,
a gate run or an agent (for example "dispatching tdd-test-engineer on
sonnet"), in its own output and progress log; it is not a separate message
to the coordinator.

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
   targeted headless Playwright specs once, when the change touches UI
   components or pages — see *E2E budget* in rule 12). It never
   edits, weakens, or deletes a test — a test it believes is wrong goes back
   to the orchestrator, who re-dispatches the tdd-test-engineer to rule on it.
5. **REQUEST CHANGES if** the gates are not green at review time **or** any
   reviewer raises a BLOCKER. WARN and NIT findings do not block. Gates are
   never taken on trust: the orchestrator runs them itself on the commit
   under review and hands the reviewer the evidence (exit codes and counts)
   — except under a coordinator, where the worker's branch-gate evidence at
   the final commit is that evidence (rule 12, *Batched under a
   coordinator*; coordinator prompt §4 *No re-run*).
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
    - **Batched under a coordinator (amended 2026-11-15, user).** When a
      coordinator runs parallel goals (`prompts/coordinator_prompt.md` §4),
      workers stop at a green branch gate with no review of their own; the
      coordinator waits until every active goal is ready (or the workers
      stop on a usage freeze), merges them into
      one candidate, and runs the review fan-out (covering each unit and
      its required security review — the list in *One review per phase*)
      on that tree, one squash commit per unit; the full suite runs in CI.
      Nothing reaches `main` before both pass.
    - **Re-reviews are delta-scoped.** After REQUEST CHANGES, the next pass
      reviews only the blocker fixes (the diff since the last reviewed
      commit) against the blocker list, not the whole phase again. The
      3-round cap (rule 7) still applies. **One reviewer per delta**
      (economy amendment, 2026-11-16, user): a single `quality-reviewer` on
      opus checks the whole delta, including the spec-guardian duty for any
      docs in it, and a delta that fixes a security blocker is checked with
      security scope (`quality-reviewer` on opus, or `ecc:security-reviewer`
      when it raised the blocker); `playwright-ui-reviewer` joins only when
      the delta
      touched UI or `e2e/` files. The orchestrator writes the blockers once,
      to a file, and every dispatch points at that file instead of
      restating it.
    - **Ready self-check (economy amendment, 2026-11-16, user).** Most
      REQUEST CHANGES rounds today were spec drift and stale evidence, not
      code defects. Before `ready`, the worker checks:
      - **Evidence at the final commit:** every gate count is from the
        commit it sends, after the last merge of `main`; the two structure
        suites (`lib/data/access/structure.test.ts`,
        `lib/litellm/structure.test.ts`) ran, because `--changed` misses
        tests that read files; lint ran after any e2e build output existed.
      - **Spec consistency:** for every spec or rule statement the unit
        changed, grep `docs/specs/**` and `.claude/rules/**` for the old
        statement and either update it or mark it superseded, with the date
        and reason. A rule never contradicts its spec (Rule 00.2, 00.4).
      - **Decisions live in the spec:** each agent decision is recorded in
        the spec with its reason (Rule 00.3), not only in the run report;
        tests cite spec lines, not reports or plans.
      - **Checkboxes match the code:** tick only what was built; split a
        task into built and not-built parts instead of ticking it whole.
      - **Ownership and overlap:** `git diff --name-only main...HEAD` holds
        only owned files, plus shared append-only lines (coordinator §2a).
    - **Branches run only new and impacted tests** (amended 2026-11-14,
      user). Iterations run the files being worked on
      (`pnpm exec vitest run <paths>`); the phase's green gate — the
      review's evidence — is `pnpm typecheck`, `pnpm lint`,
      `pnpm format:check` and the impacted tests,
      `pnpm exec vitest run --changed $(git merge-base main HEAD)` (Vitest
      follows the import graph from every changed file), the two structure
      suites (`lib/data/access/structure.test.ts`,
      `lib/litellm/structure.test.ts` — they read files, so `--changed`
      misses them), plus the targeted e2e specs (`pnpm test:e2e -- <spec>`)
      when UI changed (*E2E budget*). A change to a
      shared module (`packages/shared`, `lib/data/access/store.ts`,
      `lib/api/respond.ts`, `auth.ts`, `env.ts`) or to test infrastructure
      (`vitest.config.ts`, `test/**`, `e2e/support/**`) is impacted
      everywhere, so `--changed` already widens to the full suite.
    - **E2E budget (decided 2026-11-16, user: "reduce the number of e2e
      runs").** E2E is the slowest gate and shares one database and port,
      so it runs only where it can catch a defect nothing else does:
      - **Shared files** (they affect every page or the e2e harness):
        `e2e/support/**`, `playwright.config.ts`, `scripts/e2e-lock.mjs`,
        `scripts/seed*.ts`, `test/fixtures/role-probe-seed.ts`,
        `test/fixtures/e2e-identity-seed.ts`, `lib/nav.ts`, `lib/auth/**`,
        `app/layout.tsx`, `app/dashboard/layout.tsx`, `app/globals.css`,
        `components/layout/**`, `components/ui/**`,
        `components/providers/**`, `auth.ts`, `proxy.ts`, `next.config.ts`.
      - **No e2e** for docs, config, server-only code, Route Handlers,
        data access, or test-only changes outside `e2e/` — integration
        and unit tests cover those — except files in the shared list.
      - **Red stage:** the tdd-test-engineer does not run e2e; it checks
        that new specs load (`pnpm --filter @llm-usage-lens/dashboard exec
        playwright test --list <spec>`). Red e2e is assumed.
      - **Green stage:** the typescript-developer runs the **targeted**
        specs — new specs plus the specs of the pages it changed — **once**,
        when the unit and integration gates are green, not per iteration.
      - **Full e2e on a branch** only when a shared file changed, once per
        unit at its green gate.
      - **Review:** `playwright-ui-reviewer` audits coverage first and runs
        e2e only for specs whose evidence is missing, failing, or older than
        the last commit that touched UI or `e2e/` files. Delta re-reviews
        run no e2e unless the delta touched UI or `e2e/` files.
      - **Merging `main` in** needs no e2e re-run unless `main` brought a
        change to a shared file; then the targeted specs only.
      - **Safety net: CI (amended 2026-11-17, coordinator under the user's delegation).** CI (`llm-usage-lens-build.yml`, job `e2e`) runs
        the full e2e on every push to `main` and every pull request. A red
        run goes back into the loop on a `fix/` branch. The coordinator's
        local full `pnpm test:e2e` is only the fallback, when CI is red for
        an unrelated reason or unavailable. The prefixed `base-path`
        project is not in CI yet (Platform — BP-D15, 2026-11-17); a unit
        that touches the prefix, auth or URL building runs it locally at
        its green gate.
      - Otherwise the coordinator does not run e2e, except to produce
        evidence a worker can no longer produce (an unreachable run).
    - **The full suite runs in CI (amended 2026-11-15, user).** Sessions
      run the branch gate (above) with `main` merged in; the coordinator
      does not re-run tests and relies on that evidence. The full
      `pnpm check` and the full `pnpm test:e2e` run in GitHub Actions on the
      user's push (or on a PR, Rule 31's optional path). A red CI run goes back
      into the loop on a `fix/` branch; `main` is never committed to
      directly (Rule 30.5). Previously the full suite ran once locally on
      the `main` candidate.
    - **Results, not logs.** Every test, gate or build run is redirected to
      a file; agents and the orchestrator read only the exit code, the count
      lines (`Test Files`, `Tests`, Playwright passed/failed) and the names
      of failing tests. They open more of the log only to diagnose a
      specific failure. Every dispatch says so.
    - **Cheapest adequate model** for gate re-runs and git summaries
      (`haiku`); reviews stay on opus (Model routing above).

## Workflows (pilot, decided 2026-11-15, user)

A Claude Code workflow may run a unit's work or the coordinator's merge
review where the implementation-phases spec allows it (*Workflow
pilots*: from 2026-11-18 every worker runs its plan units as a workflow,
`prompts/coordinator_prompt.md` §3a), with the user's opt-in per run. Its agents keep the roles in
rule 8, the unit keeps one branch and one squash commit (Rule 30.4), it
draws its agents from the one shared pool: at most 80 agents running at
once, summed across all sessions, distributed dynamically by the
coordinator (user, 2026-11-18; `prompts/coordinator_prompt.md` §3a,
`docs/guides/session-roles.md` — *Limits*; implementation-phases —
*Workflow pilots*; supersedes the 5-agent cap and its M0–M5-only raise,
2026-11-18, because the user gave the pool as the general rule), and it stops at the usage freeze (`prompts/coordinator_prompt.md` §3: 5-hour,
and weekly caution 85 % / freeze 95 %, user, 2026-11-18). It never merges
or skips the review.

## Tests near the end (exception, decided 2026-11-17, user)

For the management-improvements units **M1–M5 (M4 first)** only, the user
directed "avoid to add tests on each step, add test near to the end"
(implementation-phases — *Management improvements (units M0–M5)*, run
directions). Inside
such a unit the order is *Build → Test pass → Fix → Gate*: the
`typescript-developer` builds the slices from the spec first (`pnpm
typecheck` and `pnpm lint` after each, no test written or run per slice, no
test edited — rule 8); then the `tdd-test-engineer` writes the unit's tests
in one pass from the spec lines and the unit's test table, not from the
code, and updates the tests the change breaks on purpose; a failing new test
is a defect or a spec gap, fixed by the developer or disputed back to the
test engineer (rule 4). This changes the **order** of rules 2 and 3, never
the bar: every test-table row is proved, no test is weakened, roles (rule
8), the branch gate and the review (rule 12) are unchanged. Every other
unit keeps tests first.

## When to use

- **Use the loop** for any feature, page, Route Handler, or non-trivial fix —
  anything from Phase 4 onward, and any multi-file change earlier.
- **Skip the loop** for pure scaffolding (`/new-route`, `/new-data-access`,
  `/seed`), docs, and config — still run `/lint` and `spec-guardian` as
  appropriate.
