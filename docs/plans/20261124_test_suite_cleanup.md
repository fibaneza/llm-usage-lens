# Test Suite Clean-up — second pass, the smaller pass (units TC0, TC1)

Run plan for the worker sessions. Written by the planner on 2026-11-24
from relay message P18. Package: `temp/planner/test-cleanup/` (`plan.md`,
`spec-changes.md`, `workflows.md`, `brief-tc1.md`, the measurements and
the measuring scripts). The speed changes are a separate plan:
`docs/plans/20261124_test_speed.md`.

Read first: Rule 60.20–60.24a (testing, the test budget), Rule 70.12
(token economy, the gates), `docs/guides/testing.md`, and
implementation-phases — *Maintenance — test consolidation* (the first
pass, 2026-11-16, commits `3916b281` and `2a071153`).

## 1. What the user asked for (2026-11-24)

> "There are more than 10000 tests. Do we need all of them? Run a clean up"

1. Say whether all the tests are needed.
2. Remove the ones that are not, without lowering the bar.

**Scope (the user, 2026-11-23, after the estimate below: "Recommend",
choosing the planner's recommendation).** The smaller pass: the rules
that stop the suite growing (TC0) and one unit on the route duplicates
(TC1, pools P-A, P-B, P-C). The other pools (P-D to P-I) are **not run**:
about 450 to 1,000 cases for about 4 million tokens and under half a
minute. They stay listed in §2 for a later decision.

The bar (Rule 60.24a, Rule 70.12; never weakened):

- B1. Security matrices stay complete: role × operation, the route
  contract, denylists, path and boundary matrices, the threat items
  (T and LT).
- B2. Every remaining test cites a spec line, a rule or a threat item.
- B3. No behaviour loses its only test.

## 2. What exists (measured 2026-11-23, `main` at `2912d686`)

| Measure | Value | Source |
|---|---|---|
| Test files | 491: 440 Vitest, 45 e2e specs, 6 in `tools/bedrock-simulator` (out of scope) | `temp/planner/test-cleanup/inventory.json` |
| Written cases (`it(` / `test(`) | 5,184: 4,706 Vitest, 396 e2e, 82 simulator | the same |
| Tables (`it.each`, `describe.each`) | 909 | the same |
| Test lines | 129,071 | the same |
| Cases that run in Vitest | 11,511 in 443 files (ST1 branch) | `.claude/worktrees/st1/temp/run-st1/gate6/vitest.log` |
| Full Vitest run | 1,386 s to 1,670 s (23 to 28 minutes) | ST1 gates 3 and 6 |
| Full e2e run | 668 cases, 4 to 5 minutes; `CI=1`: 658 and 12 skipped | ST1 and TM1 gates |
| Cases that run in CI, `main` at `6ba776d5` (2026-11-23, with ST1, RS2 and US2) | 11,945 in 453 files | CI run 45250078535, job `test`; per file in `temp/planner/test-cleanup/ci-per-file.json` |
| Vitest in CI | 638 s: infra 11 s, unit 184 s, integration 418 s (one file at a time) | the same log |
| Growth | 8,020 cases on 2026-11-17, 11,945 on 2026-11-23 | `docs/guides/testing.md` — *Coverage* |
| Coverage on 2026-11-17 | Statements 93.70 %, branches 86.54 %, functions 93.29 %, lines 94.85 % | the same |

**Answer to item 1.** About 4,700 cases are written; the other 6,800 are
rows of tables and the two route suites that run every registered route
(119 route methods in 92 route files). The cost is the full run of 23 to
28 minutes and 129,000 test lines to keep correct, and the suite grew by
3,500 cases in six days. Which cases are duplicates is not measured yet:
the pools below say where to look, and each unit's inventory decides.

Written cases and tables by area:

| Area | Files | Written cases | Tables | Lines | Unit |
|---|---|---|---|---|---|
| `apps/dashboard/app/api/**` | 85 | 995 | 350 | 30,762 | TC1 (route duplicates only) |
| `apps/dashboard/*.test.ts`, `hooks/`, `test/**` | 13 | 213 | 52 | 5,233 | not run |
| `apps/dashboard/lib/**` | 113 | 1,231 | 164 | 25,894 | not run |
| `packages/shared/**` | 31 | 382 | 134 | 6,627 | not run |
| `infra/test/**` | 12 | 150 | 29 | 2,787 | not run |
| `scripts/**` | 10 | 111 | 18 | 2,266 | not run |
| `apps/dashboard/components/**` | 136 | 1,459 | 90 | 33,310 | not run |
| `apps/dashboard/app/**` outside `api/` | 40 | 165 | 71 | 5,359 | not run |
| `apps/dashboard/e2e/**` | 45 | 396 | 0 | 15,291 | not run |

Candidate pools (`temp/planner/test-cleanup/candidates.txt`; a pool is
where to look, not a removal list):

| Pool | Size | Unit |
|---|---|---|
| P-A. Two suites run every write route: `app/api/__tests__/route-contract.integration.test.ts` (13 tables) and `write-routes.integration.test.ts` (24 tables) | 60 write methods in each | TC1 |
| P-B. Nine registry entries still marked `frozen: true` in `test/route-registry.ts`; their routes keep their own contract copies | 9 routes | TC1 |
| P-C. Contract-like titles outside the shared suite ("401 without a session, no-store") | 31 titles in 21 files | TC1 |
| P-D. Component and page tests that drive `fetch` and status codes | 58 files, 826 cases | not run |
| P-E. Component and page tests that name roles | 51 files, 483 cases, 84 tables | not run |
| P-F. Tables outside security | part of 909 tables; `packages/shared` 134, `lib` 164 | not run |
| P-G. Titles and comments that cite a review round ("r1", "r2", "Q-B1", "review round") | 172 places in 90 files | TC1, in the files it edits |
| P-H. Files with no citation at all | 14 files, 84 cases (6 simulator files out of scope) | not run |
| P-I. e2e cases that repeat a component or route test | not measured; 45 specs | not run |

No per-run test file is left (`*.r1`, `*.review`): the first pass merged
them. The five files with an extra name part (`role-grants.reauth`,
`route.prod-gate` twice, `security-events.persistence`, `pending.accept`)
are named aspects and stay (Rule 60.20).

### Where the cases and the time are (CI, per file; added 2026-11-23)

| Area | Files | Written | Run | Seconds |
|---|---|---|---|---|
| `app/api/**` | 91 | 1,074 | 4,671 | 317 |
| root tests, `probe/`, `test/` | 12 | 208 | 446 | 15 |
| `lib/**` | 115 | 1,266 | 2,447 | 69 |
| `packages/shared` | 31 | 391 | 1,199 | 20 |
| `infra/test` | 12 | 150 | 450 | 8 |
| `scripts` | 11 | 121 | 197 | 18 |
| components | 140 | 1,527 | 1,844 | 179 |
| pages | 41 | 169 | 691 | 20 |

- **Most of the cases run are security matrices**, which B1 keeps whole:
  `route-contract` 730, the LiteLLM `role-operation-matrix` 507,
  `write-routes` 424, `lib/litellm/operations.integration` 360,
  `auth.test.ts` 218, the page gating in `manage-routes` 203. The ten
  largest files hold 24 % of all cases, the fifty largest 47 %.
- **A case is cheap:** 646 seconds of test time for 11,945 cases, 54 ms
  each. The time is in a few slow files and in the per-file overhead
  (set-up 44 s, import 129 s, environment 174 s, summed over workers),
  which removing cases does not change (D-TC1 keeps the files).
- **Slowest files:** `account-password.integration` 43 s for 55 cases
  and `lib/auth/password-credentials.integration` 17 s for 17 cases
  (password hashing at full cost), `role-operation-matrix` 34 s,
  `route-contract` 29 s, `TeamPageContent` 14 s, `litellm/users` route
  13 s, `scripts/lib/run-seed.integration` 12 s.

**What a full pass could remove (estimate, 2026-11-23, from the per-file
numbers; it replaces the first estimate):**

| Source | Cases run | Seconds |
|---|---|---|
| P-A: `write-routes` cases that `route-contract` also runs | 250 to 300 | 4 to 5 |
| P-B, P-C: contract copies in route files | 30 to 60 | 3 |
| P-F: table rows outside security (`packages/shared`, `lib`, some components) | 400 to 800 | 10 to 15 |
| P-D, P-E: component and page cases a lower layer already asserts | 50 to 150 | 5 to 10 |
| P-I: e2e | 0 to 20 | 0 to 10 of the e2e run |
| **Total** | **750 to 1,300 (6 to 11 %)** | **20 to 30 of 638 (3 to 5 %)** |

The first pass (2026-11-16) already audited the layers and found five
duplicate e2e cases, and Rule 60.24a has applied to every unit since, so
few layer duplicates are expected.

## 3. Decisions

Agent decisions (planner, 2026-11-24) unless marked. TC0 writes them into
implementation-phases (`temp/planner/test-cleanup/spec-changes.md`).

| Id | Decision | Reason |
|---|---|---|
| D-TC1 | The pass removes **cases and table rows, not files**. A file goes only when it is left empty | The queued units of round 2 name test files in their briefs |
| D-TC2 | A case is **security** when it asserts a `401`, a `403`, a hidden `404`, what a role sees or may do, a denylist or allowlist, a path or boundary check on a guarded route, a `denied` audit record, a secret kept out of an output, a `Cache-Control: private, no-store` header, a `400` on a guarded route, a lockout or rate limit, or cites a T or LT item | One definition for B1, by content and not by file name |
| D-TC3 | A security case or row is **never trimmed**. It is removed only as an exact duplicate: same route, same caller, same input class, same assertion. Each one is marked `SEC` in the removal list. **The user, 2026-11-23: "Yes"** | B1; every row of this pass is of this kind |
| D-TC4 | The structure suites (`lib/data/access/structure.test.ts`, `lib/litellm/structure.test.ts`), `lib/litellm/bundle-output.test.ts`, and the structural checks of `write-routes.integration.test.ts` (route discovery, "catch a route that is not gated") are not touched | They are the gates of other rules (Rule 10.3, Rule 70.12) |
| D-TC5 | The survivor of every removed case is a case of the shared route-contract suite (Rule 60.23 names it) | One place for the contract |
| D-TC6 | In the files it edits, TC1 replaces a review round, a plan or a brief as a test's source with the spec line, rule or threat item. With no spec line to cite, the case stays and goes on the gap list (Rule 00.2) | B2; Rule 70.12 — *Decisions live in the spec* |
| D-TC7 | A case is cited when its title, an enclosing `describe` title, or a comment directly above either names a spec section, a rule number or a threat item | Rule 60.24a |
| D-TC8 | The removal list is **approved before anything is deleted** (one `quality-reviewer` on opus with security scope, run by the coordinator). A row the reviewer doubts is kept | The user's "Yes" was to removal with approval; a table is cheaper to review than deleted lines |
| D-TC9 | Proof is mechanical: the survivor check (§6.3) and the coverage check (§6.4). A covered statement, branch or function that is no longer covered restores the case | B3 |
| D-TC10 | No target is a quota. Expected for this pass: 280 to 360 fewer cases run and 7 to 8 seconds. The first estimate for the full pass (20 to 30 % and 15 to 25 %) was made before the per-file numbers and is withdrawn | §2 |
| D-TC12 | Three rule additions keep the suite from growing back (K1–K3 in `spec-changes.md`): the citation definition (D-TC7), "one table row per class, named by its class" outside security, and a line in every handover with the cases a unit added and removed | The suite grew by 3,900 cases in six days |
| D-TC13 | TC1 does not edit `app/api/__tests__/account-password.integration.test.ts`: unit TS1 of the speed plan owns it, with its two P-C rows | One file, one unit |

## 4. Units and ownership

| Unit | What | Owner | Worktree | Branch | Needs |
|---|---|---|---|---|---|
| **TC0** | Spec and rules only: `spec-changes.md` applied | the coordinator | `tc0` | `docs/test-cleanup-rules` | nothing |
| **TC1** | Route duplicates (P-A, P-B, P-C) | a free worker session; `litellm_worker` proposed | `tc1` | `chore/test-cleanup-routes` | TC0 on `main`; the baseline |

Owned paths:

| Unit | Owns | Never edits |
|---|---|---|
| TC0 | `docs/specs/2026-05-15-implementation-phases.md` (the new block), `.claude/rules/60-coding-standards.md` (60.23, 60.24a), `.claude/rules/70-agent-workflow.md` (ready self-check), `docs/guides/testing.md` (*Coverage*) | any test |
| TC1 | `apps/dashboard/app/api/__tests__/write-routes.integration.test.ts` (P-A, behavioural cases only); the route test files of the nine `frozen` entries and the 20 other files with contract-like titles (P-B, P-C; the list is `temp/planner/test-cleanup/candidates.txt` section A, refreshed in phase 1); in `apps/dashboard/test/route-registry.ts` only the `frozen` flags | the D-TC4 files; `route-contract.integration.test.ts` (it is the survivor); `account-password.integration.test.ts` (D-TC13); anything else under `apps/dashboard/test/`; any production file |

**Frozen for this pass:** every test file a unit in flight has changed
(`git diff --name-only main...<branch>` for each active branch). The
coordinator writes the list into the brief. A frozen file is inventoried
and not edited; its rows go on the "later" list. With that list TC1 can
run beside the units of round 2: a new route appends to
`test/route-registry.ts` (append-only), and TC1 changes only flags.

## 5. What TC1 does

1. **Candidates** (the worker, a script, no agent). Run
   `temp/planner/test-cleanup/tools/inv.py` and `cand.py`, and write
   `temp/run-tc1/candidates.md`: `write-routes`, the nine frozen routes'
   test files, and the files with contract-like titles.
2. **Inventory** (agents, read-only on tests):
   - **The map**, `temp/run-tc1/route-suites-map.md`: for each of the 60
     write methods and each caller, the case in `write-routes` and the
     case in `route-contract`, with the assertion of each. Only pairs
     with the same assertion are removal rows. A check that exists in
     one suite only stays where it is.
   - **The copies**, `temp/run-tc1/inventory-copies.md`: for each frozen
     entry and each contract-like title, the shared-suite case that
     asserts the same thing for that route, or `KEEP` when the route's
     case asserts more (for example a `REAUTH_REQUIRED` body, or "the
     new password signs in").
3. **The removal list**, `temp/run-tc1/removals.md`, one row per case:

   `| # | File | Case (describe › title, or table and row) | Class | Survivor (full generated test name) | SEC |`

   Classes: `DUP` (a `write-routes` case the contract suite also runs),
   `CONTRACT` (a route file's copy; for a frozen entry the flag is
   cleared too). Beside it: `cite.md` (D-TC6), `gaps.md`, `later.md`.
   The worker sends `tc-list tc1: ready, <n> rows (<n> SEC), <path>` and
   **stops**. The coordinator's reviewer marks each row `approve` or
   `keep`. The worker goes on at `tc-list tc1: approved`.
4. **Execute** (agents, tests only), approved rows only. For a frozen
   entry: clear the flag, run `route-contract.integration.test.ts` green
   for that route, then remove the copies. After each file group: the
   edited files pass and `eslint` is clean on them. A removal that turns
   anything red is reverted and marked `keep`. Never empty a `describe`
   block of `write-routes` that Rule 10.3 relies on: stop and ask.
5. **Gate and proof** (the worker, a script): §6.

## 6. Proof

### 6.1 Baseline (once, before TC1 starts)

The coordinator runs it on `main` at the start commit, with DynamoDB
Local on `:8000`, no agent. Output in `$REPO/temp/coordinator/tc/`:

```bash
pnpm exec vitest run --reporter=default --reporter=json --outputFile.json=temp/coordinator/tc/before-vitest.json --coverage --coverage.reporter=json --coverage.reportsDirectory=temp/coordinator/tc/before-coverage > temp/coordinator/tc/before-vitest.log 2>&1
```

It then sends `tc-baseline: ready <sha>`. The same run is the baseline
of the speed plan.

### 6.2 Gate on the branch

`main` merged in, then: `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, the two structure suites, and **the full Vitest run
with coverage** (the command of §6.1 with `after-` names in
`temp/run-tc1/`), in the test slot. The full run is the gate because a
deleted test is not seen by `--changed`. No e2e (Rule 70.12 — *E2E
budget*: test-only changes outside `e2e/`).

### 6.3 Survivor check

Every survivor named in `removals.md` is named by its **full generated
test name** (the route label included), and that exact name appears with
status `passed` in `after-vitest.json`; for a table row the registry entry
is still there and not `frozen`. A survivor that is missing or not
`passed` restores the removed case. The coordinator runs the same check
on the merge candidate (coordinator, TC0 review, 2026-11-24: a title alone
does not prove the parametrised row runs for that route, and the shared
`withRoute` paths stay covered by other routes).

### 6.4 Coverage check

A small script in the run folder (`temp/run-tc1/coverage-diff.mjs`, not
committed) compares `before-coverage/coverage-final.json` with
`after-coverage/coverage-final.json`: for every production file, each
statement, branch and function with a hit before has a hit after. The
output lists every loss as `file:line`. **The gate needs zero losses.**
A loss restores a case and the check runs again. Files that changed on
`main` since the baseline are compared by their totals and listed.

### 6.5 Numbers

The handover has: files, written cases, cases run and seconds, before
and after; the list as approved and as executed; the gap list; the
"later" list.

## 7. Order

| Step | Who | When |
|---|---|---|
| TC0 lands | the coordinator, `spec-guardian` review | any time; it changes no test |
| Baseline | the coordinator | before TC1 starts |
| TC1 inventory and list | the worker | after the baseline |
| List approval | the coordinator's reviewer | when the list is ready |
| TC1 execute and gate | the worker | after approval |
| Merge | the coordinator: the survivor and coverage checks again on the candidate, one review | at `ready` |

Start condition: TC0 on `main` (`git log --oneline main` shows it), the
baseline line sent, and the frozen list in the brief. TC1 can share a
wave with units of round 2 and with TS1 and TS2 of the speed plan: no
file is shared.

Usage freeze: the map and the lists are on disk; the worker resumes at a
phase boundary, and after approval stops after a file group.

## 8. Orchestration

`temp/planner/test-cleanup/workflows.md`. TC1: 2 inventory agents (the
map, the copies), 2 to execute (`write-routes`; the route files), 1 in
reserve, all `tdd-test-engineer` on sonnet. No `typescript-developer`.
The gate is a script. Reviews by the coordinator: the list approval and
the merge review, each one `quality-reviewer` on opus with security
scope; `spec-guardian` for TC0. Total 8 agents, at most 2 at once.
About 0.8 to 1 million tokens.

Opt-in: the worker session needs the user's own workflow opt-in and the
`/goal` line of §11.

## 9. Guards and out of scope

- No production file, no fixture, fake or set-up file, no
  `vitest.config.ts`, no CI workflow.
- No test is weakened: an assertion is never loosened to make a removal
  pass, and no security table loses a row except as an approved `SEC`
  duplicate.
- No new test, except citation text.
- No file renamed or moved (D-TC1).
- Never commit `temp/`, never merge into `main`, never push, never
  bypass a hook.
- Out of scope: pools P-D to P-I (§1, scope), `tools/bedrock-simulator/`,
  a coverage threshold in CI, and every speed change
  (`docs/plans/20261124_test_speed.md`).

## 10. Questions: all answered

| # | Question | Answer |
|---|---|---|
| Q1 | May exact duplicates inside security suites be removed? | **Yes** (the user, 2026-11-23), each marked `SEC` and approved by the security-scope reviewer before deletion |
| Q2 | The three units as written, or a smaller pass? | **The smaller pass plus a separate speed plan** (the user, 2026-11-23: "Recommend") |

## 11. Completion criteria

For TC1:

1. `removals.md` approved by the coordinator's reviewer, and executed
   for the approved rows only.
2. The gate of §6.2 green at the final commit, after the last merge of
   `main`.
3. The survivor check clean; the coverage check with zero losses; no
   edited file cites a review round, a plan or a brief as a source.
4. `git diff --name-only main...HEAD` holds only owned test files and
   `test/route-registry.ts`.
5. The handover with the numbers of §6.5, and the `ready` line sent.

For TC0: `spec-changes.md` applied, `spec-guardian` approved.

For the pass: CI green on the user's push; the coordinator writes the
before and after numbers into `docs/guides/testing.md` — *Coverage* and
ticks the Verify line.

`/goal` condition for the worker:

```
docs/plans/20261124_test_suite_cleanup.md §11 completion criteria met for unit TC1, reported ready to merge, and the report written — or the run stopped at "tc-list ready" waiting for the approval, or ended by a usage freeze or a missing dependency, with the report written.
```
