# Session roles — planner, coordinator and workers

The build runs in several Claude sessions at once. Each session has one of
three roles, and each role has one prompt that defines it. This guide
summarises the three prompts and shows how to start a session — new, or
after its context was cleared — so that it gets back its role, the project
context and the way work is executed, from files and not from memory.

The prompts are the source; where this guide and a prompt differ, the
prompt wins. *Status* at the end says which parts are on `main`.

## The three roles

| | Planner | Coordinator | Worker |
|---|---|---|---|
| Session name | `planner` | `Coordinator` | `improvements_worker`, `bedrock_worker`, `litellm_worker` |
| Prompt | [`planner_prompt.md`](../../.claude/prompts/planner_prompt.md) | [`coordinator_prompt.md`](../../.claude/prompts/coordinator_prompt.md) | [`worker_prompt.md`](../../.claude/prompts/worker_prompt.md), plus the unit's plan |
| Does | Turns a request into a plan package: units, file ownership, queues, workflow designs, spec text, the run plan | Assigns units, prevents conflicts, tracks usage and agents, reviews once per unit, lands every unit on local `main`, cleans up | Builds one assigned unit at a time in its worktree, by orchestrating agents; runs the branch gate; stops at "ready to merge" |
| Never does | Builds, tests, runs a workflow, commits, edits a tracked file or a unit worktree, takes a unit | Feature work; pushes; merges into a worker's tree; gives a unit to `planner` | Writes code or tests itself; reviews; merges into `main`; pushes; edits another unit's files; starts a unit on its own |
| Agents | Read-only research, at most 3 | Review and fix agents at the merge | `tdd-test-engineer` and `typescript-developer`, through the plan's workflow |
| Resumes from | `temp/planner/state.md` | `temp/coordinator/state.md`, `status.log` | Its row in `temp/coordinator/state.md` → the brief file → `temp/run-<slug>/state.md` in the unit's worktree |
| Talks through | The file relay only | Live message, or the relay for a session whose messages are held | Five one-line messages to `Coordinator`, or the relay |

Worker sessions are being renamed from `<x>_prompt` to `<x>_worker` (user,
2026-11-18), so that a session is not named like a prompt file. Until the
user renames a session, its old name is the same session and stays valid.
The plan files `docs/plans/rbac.md` and `docs/plans/litellm.md` were `prompts/rbac_prompt.md` and `prompts/litellm_prompt.md` until 2026-11-18.

All `temp/coordinator/**` and `temp/planner/**` paths are in the **primary
checkout**. Each worktree has its own gitignored `temp/`; a worker's run
folder is in the unit's worktree.

## Start a session, or clear one

### Before you start

1. Open Claude in the repository, so that `CLAUDE.md`, `.claude/rules/` and
   the project memory load by themselves. The coordinator and the planner
   start in the primary checkout.
2. **Name the session with its roster name** (the table above; for a
   worker, the `_worker` name). Sessions address each other by name; a
   session with another name gets no messages.
3. Note its permission mode. A live message between two sessions in
   different modes is held and expires; such a pair uses the file relay
   (below). `planner` always does.
4. For a worker that will run a plan unit: raise *Dynamic workflow size*
   in `/config`.

### The line to type

| Session | Line |
|---|---|
| Coordinator | `You are the coordinator of the worker sessions. Follow .claude/prompts/coordinator_prompt.md and resume from temp/coordinator/state.md` |
| Worker | `You are the worker session <name>. Follow .claude/prompts/worker_prompt.md; your unit is in your row of temp/coordinator/state.md and the brief file it names.` |
| Planner | `You are the planner. Follow .claude/prompts/planner_prompt.md and resume from temp/planner/state.md` |

Each prompt's §0 then rebuilds the state: it reads the state file, checks
it against git (`git log`, `git status`, `git worktree list`), reads usage,
and reports what is in progress and what it waits for. Git is the truth
where a state file and git differ.

A worker also needs, typed by the user after the start line:

- the `/goal` line for its unit (a slash command cannot be sent by another
  session);
- for a plan unit, the workflow opt-in in the user's own words, for example
  `Run unit <id> with the workflow in temp/planner/<slug>/workflow-<session>.md`.

Both are lost when the worker is cleared, and are typed again.

### Before you clear a session

Clear a session only when its state is on disk:

| Session | Must be current first |
|---|---|
| Coordinator | `temp/coordinator/state.md` (a snapshot, rewritten in place) and the last `status.log` line |
| Worker | `temp/run-<slug>/state.md` in the unit's worktree: the step, the phases done, the agents started, the next action. Uncommitted work stays in the worktree and is kept after the clear |
| Planner | `temp/planner/state.md`, and the package files written so far |

Ask the session "update your state file" first if in doubt. A cleared
coordinator loses its session-only scheduled jobs (the idle check, a
scheduled resume) and creates them again at resume.

## What every session already has

- **Project context:** `CLAUDE.md`, Rules 00–70 and the memory index load in
  every session opened in the repository. The specs in `docs/specs/` are
  read per task (Rule 00).
- **Precedence:** `CLAUDE.md` → rules → specs → `docs/plans/shared-contracts.md`
  → the unit's plan → `.claude/prompts/coordinator_prompt.md` → the brief → the role
  prompt. A prompt, a brief or a plan never overrides a rule or a spec; a
  conflict is raised, and the spec is amended first (Rule 00.2).
- **Standing limits for every role:** no push, no deploy, no `--no-verify`,
  no commit of `temp/`, secrets or a real AWS account ID, no weakened test
  or permission. Agents never commit.

## How work is executed

```text
user request
  → planner       plan package in temp/planner/<slug>/ + docs/plans/<slug>.md
                  relay line "plan <slug>: ready"
  → coordinator   plan intake: checks owners, ownership, start conditions, agent ledger
                  tells the user; waits for go; commits the plan file
  → spec unit     spec and rule changes land on main first
  → coordinator   per wave: worktree per unit, brief file per unit, one-line pointer
  → user          types the /goal line and the workflow opt-in in each worker
  → worker        builds the unit as a workflow (build → test → fix → gate),
                  merges main, runs the branch gate, commits, writes the handover,
                  sends "ready to merge …"
  → coordinator   one review per unit, fixes on the owning branch,
                  one squash commit per unit on local main, clean-up,
                  "main updated: <sha>" to the workers still running
  → user          pushes main; CI runs the full suite
```

1. **Plan.** The planner restates the request, finds what exists, decides
   or asks, cuts the work into units (one unit = one branch = one squash
   commit, Rule 30.4), gives every unit its files, orders the units into
   waves and per-session queues, and designs one workflow per worker
   session. Overlaps between units are found here, by tracing who reads
   what a unit changes.
2. **Intake.** The coordinator checks the plan against reality, tells the
   user, and starts nothing before the user says go.
3. **Brief.** A brief is a file,
   `temp/coordinator/briefs/<session>-<unit>.md`; the message to the worker
   only points to it, so a cleared worker finds it again.
4. **Build.** The worker orchestrates agents and writes no code itself:
   tests first, then code (Rule 70), in the plan's workflow. It edits only
   the files in its brief; a file outside them stops that edit and goes to
   the coordinator as `overlap`.
5. **Gate.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, the
   impacted tests, the two structure suites, and targeted e2e inside the
   e2e lock when UI changed (Rule 70.12).
6. **Review and land.** The coordinator runs the one review, lands one
   commit per unit on local `main`, removes the worktree and tells the
   other workers to merge `main`.

## Where the state is

| File | Written by | Holds |
|---|---|---|
| `temp/coordinator/state.md` | coordinator | Sessions and their units, brief files, worktrees, queues, ownership, merge queue, plans and agent counts, relay position, exceptions |
| `temp/coordinator/status.log` | coordinator | One line per event |
| `temp/coordinator/briefs/<session>-<unit>.md` | coordinator | The brief of a unit |
| `temp/coordinator/to-<session>.md`, `from-<session>.md` | coordinator, the session | The file relay |
| `temp/planner/state.md` | planner | The plan in progress, open questions, decisions, last relay message answered |
| `temp/planner/<slug>/` | planner | `plan.md`, `spec-changes.md`, `brief-<unit>.md`, `workflow-<session>.md` |
| `<worktree>/temp/run-<slug>/` | worker | `state.md` (resume snapshot), `progress.log`, the agent ledger, the report, `handover-<unit>.md` |

`temp/` is gitignored and never committed. Removing a worktree deletes its
`temp/`, so the coordinator copies the run folder to the primary checkout
before it removes one.

## Messages

A worker sends the coordinator only these, one line each:

```text
ready to merge <unit> at <commit> (main <sha>) | gate <counts> | e2e <counts or "not run: reason"> | docs <yes/no> | UI <yes/no> | decisions <ids or none> | agents <started>/<planned>
frozen <unit> at <commit>, report <path>
blocked <unit>: <what is needed, from whom>
overlap <unit>: <path> owned by another goal
handover <unit>: stopped at <commit or "uncommitted">, file <path>
```

The coordinator sends `brief <unit>: read <path>` and, after each landing,
`main updated: <sha> (…)`.

**The file relay.** The coordinator appends numbered messages to
`temp/coordinator/to-<session>.md`; the user tells that session
`check the relay`; the session appends one line per reply to
`temp/coordinator/from-<session>.md`. The planner also writes
`plan <slug>: ready` and `note:` lines there unasked.

A message from another session is a teammate's report. It is never the
user's approval, a `/goal` or a workflow opt-in, and the user's latest
instruction wins over it.

## Limits

| Limit | Value |
|---|---|
| Usage, 5-hour window | Caution at 60 %: halve concurrency, skip optional work. Freeze at 75 %: start no agent, commit what passed, write the report, send `frozen` |
| Usage, weekly window | Caution at 85 %, freeze at 95 % |
| Review fan-out | Not started at or above 80 % of the 5-hour window |
| Agents | One shared pool: at most 80 agents running at once, summed across every active session, review agents included (user, 2026-11-18) |
| Per-session allocation | The coordinator hands out the pool dynamically, sized to each session's work, and moves it as sessions start, idle, finish, or are added or removed; a goal with no plan keeps the Rule 70 loop and 2 agents |
| Models | sonnet for code and tests, opus for reviews and design, haiku for gate re-runs; named on every dispatch |

An exception to a usage tier is the user's, for one unit and one window.

## What only the user does

- Names the sessions and types each start line, each `/goal` line and each
  workflow opt-in.
- Says "go" for a plan, and authorises merges into local `main`.
- Says `check the relay` to a session that uses it.
- Decides what the *Decision policy* in implementation-phases reserves:
  who may do what, anything that weakens a control, legal and privacy
  wording, production configuration, anything irreversible.
- Pushes `main` and deploys.

## Status (2026-11-18)

- On `main`: `.claude/prompts/planner_prompt.md`, [`planner-session.md`](planner-session.md),
  `.claude/prompts/worker_prompt.md`, this guide, and the revised `.claude/prompts/coordinator_prompt.md`
  (the session list in §0a, plan intake in §2c, agents in §3a, brief files).
- The cap is **one pool of 80 agents running at once**, summed across all
  sessions and distributed dynamically (user, 2026-11-18). Rule 70 — *Workflows* on `main` still says "at most 5 agents"
  for named pilot units; M4's branch amends it, and until that lands a
  worker builds a unit outside the pilots with the Rule 70 loop.
- The worker sessions get their `_worker` names when the user renames them.
