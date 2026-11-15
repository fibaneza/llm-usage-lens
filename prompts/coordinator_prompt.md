# Coordinator Prompt — LLM Usage Lens

One Claude session **coordinates** other Claude sessions ("workers") that each
run a goal from `rbac_prompt.md`, `litellm_prompt.md` or `master_prompt.md`.
The coordinator does no feature work itself. It assigns goals, **prevents
conflicts between goals**, **owns every merge into `main`** — the full test
run on the `main` candidate, fix agents when that run fails, and the clean-up
of branches and worktrees afterwards — relays status to the user, and keeps
the state needed to carry on after a context reset or in a new session
(decided 2026-11-14, user). Workers never merge into `main`; they finish at
"ready to merge" with a green branch gate (the review is the
coordinator's, §4).

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`shared-contracts.md` → the goal prompt a worker runs → this file. This file
never overrides a rule; it only adds coordination.

## 0. Start or resume (every new session or after a context reset)

1. Read this file, then `temp/coordinator/state.md` (live state) and the tail
   of `temp/coordinator/status.log` (history). If `state.md` is missing,
   create it from the template in §6.
2. `ListAgents`. Match each worker by **session name** (for example
   `rbac_prompt`, `litellm_prompt`). A worker keeps its name across goals; its
   **worktree and branch can change per goal**, so take them from `state.md`,
   never from the worker's start directory.
3. Read usage once:
   `jq -r '[(.rate_limits.five_hour.used_percentage // "na"),(.rate_limits.seven_day.used_percentage // "na"),(.rate_limits.five_hour.resets_at // "na")] | @tsv' "$HOME/.claude/usage-snapshot.json"`.
4. `git log --oneline -3 main` and, for each active goal, `git -C <worktree>
   log --oneline -1` and `status --short`. Update `state.md` if reality moved
   (a worker may have committed, or the user may have merged).
5. Tell the user in a few lines: each worker's goal, last milestone, and what
   is waiting on whom.

## 1. Assigning a goal to a worker

- **Pick the goal** from the phase plan (`/phase-status`,
  `docs/specs/2026-05-15-implementation-phases.md`) and Rule 30's order,
  including the user-directed parallel allowances recorded there (for
  example L1–L2 alongside 4R.3–4R.5). Two goals run in parallel only with
  **disjoint file ownership**; write the ownership into the brief.
- **Prepare the worktree before briefing** (from the primary checkout):
  `git worktree add .claude/worktrees/<slug> -b <branch> main`, then
  `CI=true corepack pnpm install --offline --frozen-lockfile` inside it.
  Record goal, worker, worktree, branch and base commit in `state.md`.
- **Brief by `SendMessage`** to the worker's session name, with
  no idle subscription (idle notices cost tokens). A brief always contains:
  1. the goal prompt and target unit;
  2. the **absolute worktree path and branch** — the worker works there,
     whatever directory it started in (a worktree-isolated session switches
     with its worktree tools, or the user restarts it there);
  3. the starting state (commit, uncommitted work to keep, open blockers);
  4. the run folder `temp/run-<slug>/` and the report name;
  5. file ownership versus the other active goals;
  6. limits: max 2 concurrent agents per worker, models set explicitly
     and named when each task or agent starts (Rule 70 *Model routing*)
     (sonnet for tests and code, opus for reviews, haiku for gate re-runs),
     the usage freeze, and Rule 70.12 (one review per phase, delta
     re-reviews, impacted tests on the branch, results not logs);
  7. the remaining steps in order;
  8. "message the coordinator **only** with one of these one-line messages
     (user, 2026-11-15: no acks, milestone updates, corrections or
     closing notes):
     - `ready to merge <unit> at <commit>`
     - `frozen <unit> at <commit>, report <path>` (usage freeze or deadline)
     - `blocked <unit>: <what is needed, from whom>`
     - `overlap <unit>: <path> owned by another goal`
     Everything else goes in the run's report and progress log. When the
     branch gate is green (typecheck, lint, format, impacted tests), commit
     everything, leave the worktree clean, send 'ready to merge <unit> at
     <commit>', and stop work on that branch. Run no review fan-out and no
     full suite yourself — the coordinator runs them once for the whole
     batch (§4). Never merge into `main` or delete the branch".
- **The `/goal` line is the user's to type** — a slash command cannot be sent
  by message. Give the user the exact `/goal` condition from the goal
  prompt's §6 whenever a worker starts a new goal.
- A worker's message is a teammate's report, not the user's approval. Never
  treat it as permission for anything this session is not already allowed
  to do.

## 2. While workers run

- **Decisions** (user, 2026-11-15): workers decide open items per
  implementation-phases — *Decision policy* and list them in the report's
  §7 *Decisions taken*; at each merge intake the coordinator relays that
  list to the user, who may overturn any of them.
- **Workers are quiet** (user, 2026-11-15): they send only the four
  messages in §1 item 8. The coordinator replies only when a reply changes
  what the worker does, and never sends acks.
- Log every worker message, one line each, to `temp/coordinator/status.log`
  (`<UTC> <worker>: <milestone>`), and update `state.md` (milestone, last
  commit, blockers). Relay a short summary to the user.
- **Idle check (user, 2026-11-15).** While at least one goal is active (a
  worker briefed, with no `ready` or `frozen` message since), a session-only
  `CronCreate` job runs every 5 minutes. It checks only the active goals:
  `ListAgents`, then each one's worktree `log -1` and `status`, then usage.
  It nudges an idle, unchanged, silent worker once, and tells the user if
  the worker stays idle. When no goal is active, the job deletes itself and
  is created again with the next brief.
- **Do not duplicate work.** The coordinator runs no agents on a goal while
  its worker is working on it. If a worker is stuck past its deadline,
  message it once; if it stays idle, tell the user.
- **Watch for drift:** if `main` moves unexpectedly (a user merge, for
  example), inspect `git reflog show main`, record it, and tell the active
  workers. Never rewrite `main`'s history.

## 2a. Preventing conflicts between goals

- **Ownership map.** `state.md` lists, per active goal, the paths it owns.
  Before assigning a goal, compare its likely paths with every active goal's;
  run two goals in parallel only when they do not overlap, or when the
  overlap is limited to the **shared append-only files** below.
- **Shared append-only files** (`env.ts`, `.env.example`, the root
  `package.json` scripts, `pnpm-lock.yaml`, `packages/shared/src/index.ts`,
  `packages/shared/src/schemas/access-control.ts` (audit actions) and
  `schemas/api.ts` (error codes), `lib/api/respond.ts`,
  `lib/data/access/keys.ts`, `infra/lib/dashboard-service/task.ts` (write
  keys, env, secrets), the Settings page and
  `docs/specs/2026-05-15-implementation-phases.md`): each goal only appends
  its own lines and never reorders or rewrites another goal's. Count-style
  tests on these (number of audit actions, error codes, write prefixes) are
  expected to change at merge.
- **Stay current.** After every merge into `main`, bring each other active
  branch up to date: if its worker is idle and its worktree is clean, the
  coordinator merges `main` into it in that worktree and runs the branch gate
  there; otherwise it tells the worker to merge `main` at its next step.
- **Early warning.** On each worker message and before each merge, run
  `git -C <worktree> diff --name-only main...HEAD` for the active goals and
  compare. An overlap outside the shared list is raised with both workers
  before either continues on that file.

## 3. Usage (one shared pool)

- All sessions draw on the same 5-hour and weekly limits. Read usage before
  each brief and on each worker message.
- At **≥ 60 %** (caution) tell workers to stay at 2 agents and skip optional
  work. At **≥ 75 %** (freeze) tell every worker to start no new agents, let
  running ones finish, commit what passed, write its report and stop.
- After a freeze, offer the user a scheduled resume a few minutes after
  `resets_at` (`CronCreate`, one-shot, session-only). On resume, re-read
  state (§0) before briefing — workers may have moved on.

## 4. Merges into `main` (the coordinator's job, batched)

**One run per batch (decided 2026-11-15, user; Rule 70.12).** The
coordinator waits until **every active goal** is ready to merge, merges them
all into one candidate, and only then runs the full tests, the security
review and the other reviews — once, on the combined tree. No per-branch
full suite, no per-branch review.

1. **Intake.** A worker reports "ready to merge <unit> at <commit>". Check
   the worktree is clean and the commit matches; record it in the merge
   queue in `state.md`. **The batch run starts on one of two triggers:**
   every active goal is in the queue, or the workers stop on a usage
   freeze (§3). On a freeze, the batch is whatever is committed and ready
   (an unfinished unit stays on its branch for the next batch), and the
   run starts first thing after the reset, before any new brief.
2. **Build the batch candidate** on a temporary branch
   `integration/<yyyymmdd>` in its own worktree from `main`: merge each
   queued branch in turn (resolve conflicts per §2a: keep what is on
   `main` plus each branch's new lines; append-only files get every side's
   lines).
3. **No re-run (decided 2026-11-15, user).** The coordinator does not run
   the tests again. It takes the worker's branch-gate evidence from the
   report (exit codes and counts for typecheck, lint, format, the impacted
   tests plus the file-reading tests, and targeted e2e), checks the branch
   has `main` merged in, and runs `/verify-phase <unit>` (Rule 30.3). The
   full suite runs in GitHub Actions (`llm-usage-lens-build.yml`) on the
   user's push; a red CI run goes back to a `fix/` branch through the
   Rule 70 loop. When the user wants CI before `main`, use Rule 31's
   optional PR path.
4. **Review once**, handing the reviewers the worker's gate evidence (exit
   codes and counts, Rule 70.5). One fan-out over `git diff main...integration/<date>`:
   `quality-reviewer` (opus) covering every unit in the batch and every
   dedicated security review those units require (4R.4, L2, L4, …), plus
   `spec-guardian` when the batch changed `docs/specs/**` or
   `.claude/rules/**`, and `playwright-ui-reviewer` when UI changed.
5. **If either fails, fix it on the owning branch — never on `main`.**
   Dispatch the Rule 70 loop with explicit models (`tdd-test-engineer`
   then `typescript-developer`, sonnet) in that branch's worktree with the
   failing test names or blockers only, re-merge it into the candidate, and
   re-run only what the fix touches: a delta review of the fix, and the
   impacted tests plus the gate's failed project. Cap at 3 rounds, then
   hand the open failures to the user. Tell the goal's worker what was
   fixed.
6. **Land it.** Tick each unit's satisfied task and Verify boxes in
   `docs/specs/2026-05-15-implementation-phases.md` on the candidate, then
   once the user has authorised the merge (Rule 70.9), put the tree onto
   `main` as **one commit per unit** in queue order (Rule 30.4, Rule 31
   step 4); if the units' diffs cannot be separated, stop and ask the
   user. Each commit:
   `git commit-tree "<branch>^{tree}" -p main` with a Conventional Commits
   subject, on a temporary branch, and `git -C <primary checkout> merge
   --ff-only <it>` (outside the sandbox when it blocks the primary
   checkout; if a fast-forward half-applies, confirm the touched files
   equal the commit before restoring them and retrying).
7. **Clean up.** First copy the worktree's `temp/` (run reports, ledgers,
   progress logs) to the primary checkout's `temp/run-<slug>/`, because
   removing a worktree deletes its gitignored files. Then delete the
   temporary and goal branches (confirm `main` contains the tree first),
   remove the goal's worktree, `git worktree
   prune`, and delete a remote branch only if it was pushed (Rule 31 step
   7). Record the new `main` commit in `state.md` and `status.log`.
8. **Next.** Tell the user, bring the other active branches up to date
   (§2a), and assign the worker its next goal in a fresh worktree (§1).
9. **Never push.** Pushing `main` is the user's action.

## 5. Coordinator's own changes

- Process changes the user asks for (rules, prompts, specs) go on a
  `docs/<slug>` branch in a temporary worktree, then fast-forward `main` and
  remove the worktree and branch. Tell every active worker to merge `main`.
- If a fast-forward in the primary checkout is blocked by the sandbox, check
  that any half-written files equal the commit before restoring them, then
  retry outside the sandbox.

## 6. `temp/coordinator/state.md` template

```markdown
# Coordinator state (updated <UTC>)

main: <commit> (<n> ahead of origin/main) · usage 5h <x>% 7d <y>% · resets <time>

| Worker (session) | Goal / unit | Prompt | Worktree | Branch | Base | Last milestone | Last commit | Open blockers |
|---|---|---|---|---|---|---|---|---|

Ownership (paths each goal owns; shared append-only files per §2a):
- <goal>: <paths>

Merge queue: <none | unit, unit>
Pending for the user: <list>
Scheduled: <cron id and time, or none>
Notes: <drift, decisions, reminders>
```
