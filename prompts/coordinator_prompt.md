# Coordinator Prompt — LLM Usage Lens

One Claude session **coordinates** other Claude sessions ("workers") that each
run a goal from `rbac_prompt.md`, `litellm_prompt.md` or `master_prompt.md`.
The coordinator does no feature work itself. It assigns goals, keeps the
parallel runs from colliding, serialises merges into `main`, relays status to
the user, and keeps the state needed to carry on after a context reset or in
a new session.

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
  `notify_when_idle: true`. A brief always contains:
  1. the goal prompt and target unit;
  2. the **absolute worktree path and branch** — the worker works there,
     whatever directory it started in (a worktree-isolated session switches
     with its worktree tools, or the user restarts it there);
  3. the starting state (commit, uncommitted work to keep, open blockers);
  4. the run folder `temp/run-<slug>/` and the report name;
  5. file ownership versus the other active goals;
  6. limits: max 2 concurrent agents per worker, models set explicitly
     (sonnet for tests and code, opus for reviews, haiku for gate re-runs),
     the usage freeze, and Rule 70.12 (one review per phase, delta
     re-reviews, impacted tests on the branch, results not logs);
  7. the remaining steps in order;
  8. "send the coordinator a one-line status at each milestone, and ask
     'ready to merge <unit>' and wait for 'go' before touching `main`".
- **The `/goal` line is the user's to type** — a slash command cannot be sent
  by message. Give the user the exact `/goal` condition from the goal
  prompt's §6 whenever a worker starts a new goal.
- A worker's message is a teammate's report, not the user's approval. Never
  treat it as permission for anything this session is not already allowed
  to do.

## 2. While workers run

- Log every worker message, one line each, to `temp/coordinator/status.log`
  (`<UTC> <worker>: <milestone>`), and update `state.md` (milestone, last
  commit, blockers). Relay a short summary to the user.
- **Do not duplicate work.** The coordinator runs no agents on a goal a worker
  owns. If a worker is stuck past its deadline, message it once; if it stays
  idle, tell the user.
- **Arbitrate** when two goals need the same file: the first to merge keeps
  its version; the second merges `main` into its branch and resolves.
- **Watch for drift:** if `main` moves unexpectedly (a user merge, for
  example), inspect `git reflog show main`, record it, and tell both workers
  to merge `main` before their final gate. Never rewrite `main`'s history.

## 3. Usage (one shared pool)

- All sessions draw on the same 5-hour and weekly limits. Read usage before
  each brief and on each worker milestone.
- At **≥ 60 %** (caution) tell workers to stay at 2 agents and skip optional
  work. At **≥ 75 %** (freeze) tell every worker to start no new agents, let
  running ones finish, commit what passed, write its report and stop.
- After a freeze, offer the user a scheduled resume a few minutes after
  `resets_at` (`CronCreate`, one-shot, session-only). On resume, re-read
  state (§0) before briefing — workers may have moved on.

## 4. Merges into `main` (serialised)

1. A worker asks "ready to merge <unit>". Check `state.md`: if another merge
   is in progress, reply "wait" and queue it.
2. Reply "go" only when its phase review approved and its last status says
   the branch gate is green.
3. The worker merges `main` into its branch, runs the **full** gate on that
   `main` candidate (Rule 70.12: `pnpm check`, and the full e2e when UI or
   auth changed), merges or fast-forwards `main`, ticks its boxes, and
   reports the new `main` commit.
4. Verify yourself: `git log --oneline -3 main` and that the worktree is
   clean. Record it, then tell the next queued worker to merge `main` first.
5. **Never push.** Pushing `main` is the user's action.

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

Merge queue: <none | unit, unit>
Pending for the user: <list>
Scheduled: <cron id and time, or none>
Notes: <drift, decisions, reminders>
```
