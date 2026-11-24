# Test Speed — faster password tests and parallel integration files (units TS1, TS2)

Run plan for the worker sessions. Written by the planner on 2026-11-24.
Package: `temp/planner/test-cleanup/` (`plan.md`, `spec-changes.md`,
`workflows.md`, `brief-ts1.md`, `brief-ts2.md`, `ci-per-file.json`).
Companion plan: `docs/plans/20261124_test_suite_cleanup.md` (units TC0,
TC1), which removes duplicate cases and saves seconds, not minutes.

Read first: Rule 60.20–60.24a, Rule 70.12 (the gates, the e2e budget),
`docs/guides/testing.md` — *Projects*, *Running*.

## 1. What the user asked for

1. 2026-11-24: "There are more than 10000 tests. Do we need all of them?
   Run a clean up".
2. 2026-11-23, after the estimate: "tellme how many tests will delete
   and time saving", then "Recommend": the smaller clean-up and a
   separate plan for the speed changes. This is that plan.

## 2. What exists (CI run 45250078535, `main` at `6ba776d5`, 2026-11-23)

| Measure | Value |
|---|---|
| Vitest in the CI `test` job | 638 s for 11,945 cases in 453 files |
| The three projects, one after another | infra 11 s, unit 184 s, **integration 418 s** |
| Integration project | 148 files, 6,207 cases, **one file at a time** (`fileParallelism: false` in `vitest.config.ts`) |
| CI jobs | `quality` 1.2 min, then `test` 11.5 min, `e2e` about 10 min, `build` 1.2 min, `e2e-dev` 2.2 min, side by side |
| Local full Vitest run | 23 to 28 minutes, measured while three sessions were working (ST1 gates) |

Per file: `temp/planner/test-cleanup/ci-per-file.json`.

**Why the integration files run one at a time.** One table per run:
`vitest.config.ts` sets `DYNAMODB_TABLE_NAME` to
`bedrock-usage-test-<pid>`, and the files call `clearTable()` from
`apps/dashboard/test/support/test-support.ts` before each case. Two
files at once would clear each other's rows. No test opens a port, and
no code reads a worker id today.

**The two slow password files.**
`app/api/__tests__/account-password.integration.test.ts` (43 s, 55
cases) and `lib/auth/password-credentials.integration.test.ts` (17 s, 17
cases). Each case seeds a user with a real Argon2id hash
(`hashPassword(GOOD_PASSWORD)`, 64 MB and 3 iterations in
`lib/auth/password-hash.ts`), and the code under test then verifies and
hashes again. The seed hash is the same work repeated for every case.

## 3. Decisions

Agent decisions (planner, 2026-11-24). TC0 of the companion plan writes
them into implementation-phases (`spec-changes.md` §6).

| Id | Decision | Reason |
|---|---|---|
| D-TS1 | TS1 computes the seeded user's hash **once per file**, with the real `hashPassword` and the real parameters, and reuses it. Nothing is mocked; the verify and the hash inside the code under test still run for real | The file's own comment: "Only the clock is faked, so Argon2 and the SDK still run for real" |
| D-TS2 | No production change and no lower hash cost for tests. A switch that makes hashing cheaper would be a way to weaken a control, and is the user's decision; it is not proposed | Rule 50; implementation-phases — *Decision policy* |
| D-TS3 | TS2 runs integration files in parallel with **one table per test file**: `bedrock-usage-test-<pid>-<pool slot>-<random>`, set before any test module loads and created before the file's tests; the run's tables (prefix `bedrock-usage-test-<pid>-`) are deleted at the end. *Amended 2026-11-24, coordinator: previously one table per Vitest worker (`bedrock-usage-test-<pid>-<worker id>`). Vitest 4 frees a worker's pool slot before the old worker exits, so under load the next file shared a table with a worker still writing (a full run failed 1,286 tests with seed conflicts).* | It removes the reason for the serial run and changes no test; per file, no two files can share a table |
| D-TS4 | TS2 is chosen over splitting the CI job into shards: it also shortens every local run, and it adds no runner minutes | Cost posture (CLAUDE.md); the local gates are where the minutes are spent |
| D-TS5 | A file that fails only beside others is **not edited** by TS2 when another unit owns it: it goes into a second project, `integration-serial`, with the reason in a comment. The second project exists only if such a file is found | Round 2 units own most test files |
| D-TS6 | The integration project is capped at 4 workers until a measurement says more is safe | One DynamoDB Local serves all of them |
| D-TS7 | `tdd-test-engineer` edits `vitest.config.ts` and `apps/dashboard/test/**` in TS2: it is test infrastructure, not production code (Rule 70.8) | No `typescript-developer` work exists in this plan |
| D-TS8 | Splitting the CI `e2e` job (about 10 minutes) is **not** in this plan. After TS2 it is the longest job, so CI end to end stays near 11 minutes. It needs the user's yes, because it adds runner minutes (§9, Q-TS1) | Cost posture |

## 4. Units and ownership

| Unit | What | Owner | Worktree | Branch | Needs |
|---|---|---|---|---|---|
| **TS1** | The password seed hash, once per file | a free worker session; `improvements_worker` proposed | `ts1` | `chore/test-speed-password-seeds` | the baseline |
| **TS2** | Integration files in parallel, a table per test file (D-TS3, amended 2026-11-24) | a free worker session; `bedrock_worker` proposed | `ts2` | `chore/test-parallel-integration` | the baseline |

| Unit | Owns | Never edits |
|---|---|---|
| TS1 | `apps/dashboard/app/api/__tests__/account-password.integration.test.ts` (amended 2026-11-24: not `password-credentials.integration.test.ts`) | `apps/dashboard/test/**`, `lib/auth/password-hash.ts`, any other file |
| TS2 | `vitest.config.ts`; `apps/dashboard/test/setup/**` (a new per-file table set-up file, D-TS3 amended; `integration-global-setup.ts`); `apps/dashboard/test/support/test-support.ts` (only the table name); `docs/guides/testing.md` (*Projects*, *Running*); and only if D-TS5 applies: `package.json` (`test:integration`), the pre-push hook's Vitest line, and the sentences that say "three projects" (`CLAUDE.md`, Rule 60, Rule 70, `.github/ACTIONS.md`) | any test file; any production file; `.github/workflows/**` (the CI command `pnpm exec vitest run` stays) |

No file is shared between TS1, TS2 and TC1 (TC1 leaves
`account-password.integration.test.ts` to TS1: D-TC13). `docs/guides/testing.md`
is edited by TC0 (*Coverage*) and by TS2 (*Projects*, *Running*): TC0
lands first.

Both units can run beside the units of round 2. TS2 changes files on
Rule 70.12's "impacted everywhere" list (`vitest.config.ts`, `test/**`):
every branch that merges `main` after TS2 lands runs its integration
files in parallel from then on.

## 5. What each unit delivers

### TS1 — the password seed hash, once per file

*Amended 2026-11-24 (coordinator, TC0 review):* TS1 changes
`account-password.integration.test.ts` only.
`lib/auth/password-credentials.integration.test.ts` seeds through
`completePasswordSetup`, the code under test, and already spies on
`hash-wasm` to assert call counts (T7, T23), so it is left as is. Any
case that compares two users' hashes, or the seed hash itself, keeps a
fresh hash.

- In that file: one `beforeAll` computes
  `hashPassword(GOOD_PASSWORD)`; the seed helper reuses it. Where a case
  needs a second password's hash, the same applies.
- Nothing else changes: no assertion, no case added or removed, no mock.
- Proof: the same number of cases as before in both files; both files
  green three times in a row; seconds before and after from the JSON
  reporter.
- Expected: 15 to 20 seconds less (of 60). Estimate: about a third of
  each case's time is the seed hash.

### TS2 — integration files in parallel

- A set-up file for the integration project gives each test file its own
  table (`DYNAMODB_TABLE_NAME` = the run base, the pool slot and a random
  suffix) before any test module loads, so `lib/dynamodb.ts` and
  `test-support.ts` read the file's table (D-TS3, amended 2026-11-24).
- `fileParallelism` on for the integration project, at most 4 workers
  (D-TS6).
- The global set-up deletes every table whose name starts with the
  run's prefix `bedrock-usage-test-<pid>-` (the trailing dash, so pid 123
  never matches 1234 of another session), and refuses a non-local endpoint
  explicitly (`isLocalEndpoint`); it still refuses any other name.
- A file that cannot run beside others: D-TS5.
- `docs/guides/testing.md` says how the integration project runs.
- Proof:
  1. The full Vitest run three times in a row: zero failures, and the
     same files, cases and skips as the baseline (plus or minus what
     `main` added).
  2. Once more with the file order shuffled
     (`--sequence.shuffle.files`).
  3. After each run no table with the run's prefix is left in DynamoDB
     Local (a list-tables check in the run folder).
  4. The integration project's wall time before and after.
- Expected (estimate): the integration project from 418 s to about 210
  to 250 s in CI (2 cores); more on a developer machine. Vitest in CI
  from 638 s to about 410 to 450 s.

### What the two units give together (estimate)

| | Today | After TS1 and TS2 |
|---|---|---|
| Vitest in CI | 638 s | 400 to 440 s |
| CI `test` job | 11.5 min | about 7.5 min |
| CI end to end | about 12.7 min | about 11.3 min: the `e2e` job is then the longest (D-TS8) |
| Local full run | 23 to 28 min under load | not estimated; TS2 measures it |

## 6. Gates

Baseline: the one of the companion plan §6.1 (`tc-baseline: ready <sha>`,
`$REPO/temp/coordinator/tc/before-vitest.json`).

| Unit | Gate at the final commit, `main` merged in |
|---|---|
| TS1 | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, the two structure suites, the two files three times (`pnpm exec vitest run <the two files>`). No full run: nothing outside the two files changes. No e2e |
| TS2 | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, the two structure suites, and the proof of §5 (four full Vitest runs, in the test slot). No e2e: no file on the e2e shared list changes |

Results, not logs: every run goes to a file; read the exit code and the
count lines.

## 7. Order and orchestration

| Step | Who | When |
|---|---|---|
| Baseline | the coordinator | shared with TC1 |
| TS1 | its worker | any time after the baseline |
| TS2 | its worker | any time after the baseline; it needs the test slot four times |
| Merge | the coordinator, one review each (`quality-reviewer`, opus) | at `ready`; TS2 merges `main` before its gate, so its proof covers whatever landed first |

`workflows.md` has the agents. TS1: 1 `tdd-test-engineer` on sonnet and
1 in reserve. TS2: 1 `tdd-test-engineer` on sonnet for the change, up to
2 in reserve for a failing file, serial. No `typescript-developer`, no
gate agent. With the two reviews: 7 agents, at most 2 at once. About 0.6
to 0.9 million tokens; TS2's four full runs cost time, not tokens.

After TS2 lands, a unit whose new test fails only in parallel reports
`parallel-fail <unit>: <file>` to the coordinator and adds the file to
`integration-serial` (D-TS5) as a shared line.

Opt-in: each worker session needs the user's own workflow opt-in and the
`/goal` line of §10.

## 8. Guards and out of scope

- No production file. No hash parameter, no mock of hashing (D-TS2).
- No test weakened, added or removed.
- No CI workflow change.
- The table guard stays: scripts and tests refuse a non-local endpoint,
  and only tables named `bedrock-usage-test-…` are created or deleted.
- Never commit `temp/`, never merge into `main`, never push, never
  bypass a hook.
- Out of scope: e2e speed (D-TS8), the other slow files
  (`role-operation-matrix` 34 s, `route-contract` 29 s,
  `scripts/lib/run-seed.integration` 12 s), the per-file overhead of the
  unit project (set-up, import, environment).

## 9. Questions

| # | Question | Default (in force until the user says otherwise) |
|---|---|---|
| Q-TS1 | Split the CI `e2e` job into two parallel jobs? It would bring CI end to end to about 9 minutes and add about 4 runner minutes per push | **No**, not now. Decide with TS2's measured numbers |

## 10. Completion criteria

TS1:

1. The two files only (`git diff --name-only main...HEAD`), no assertion
   changed, the same number of cases.
2. The gate of §6 green; seconds before and after in the handover.

TS2:

1. Only owned files changed; no test file edited.
2. The proof of §5 complete: three full runs and one shuffled run with
   zero failures and the baseline's counts; no table left; the
   integration project's time before and after in the handover.
3. Every file in `integration-serial`, if any, has its reason, and the
   `integration-serial` project is part of the default `vitest run` (CI and
   pre-push). If TS2 edits `CLAUDE.md` or a rule (D-TS5), its review adds
   `spec-guardian` (Rule 70.12).
4. `docs/guides/testing.md` updated; if a second project exists, every
   "three projects" sentence is updated or the handover lists it.

Both: the handover written and the `ready` line sent. For the plan: CI
green on the user's push, and the coordinator ticks the Verify lines.

`/goal` condition for a worker:

```
docs/plans/20261124_test_speed.md §10 completion criteria met for unit <TS1|TS2>, reported ready to merge, and the report written — or the run ended by a usage freeze or a missing dependency, with the report written.
```
