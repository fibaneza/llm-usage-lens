# Sessions — how to run the planner, the coordinator and the workers

The build can run in several Claude sessions at once. Each session has one
role, and one prompt in this folder defines it:

| Role | Session name | Prompt |
|---|---|---|
| Planner | `planner` | [`planner_prompt.md`](planner_prompt.md) |
| Coordinator | `Coordinator` | [`coordinator_prompt.md`](coordinator_prompt.md) |
| Worker | `improvements_worker`, `bedrock_worker`, `litellm_worker` | [`worker_prompt.md`](worker_prompt.md), plus the unit's plan |

This file says **how to run them** and, briefly, **how they work**. The
reference (what each role may and may not do, where every state file is,
the message formats, the limits) is
[`docs/guides/session-roles.md`](../../docs/guides/session-roles.md). Its
*Status* section says which parts are on `main`. One run in one session,
with no coordinator, is in [`docs/plans/README.md`](../../docs/plans/README.md) — *How to start a run*.

Worker sessions are being renamed from `<x>_prompt` to `<x>_worker`. Until
you rename a session, its old name (`rbac_prompt`, `litellm_prompt`) is the
same session.

## How they work, in short

- The **planner** turns a request into a plan: units of work, the files
  each unit owns, which worker runs which unit and in what order, and a
  workflow design per worker. It never builds anything.
- The **coordinator** takes the plan, creates one worktree and one brief
  per unit, watches usage, reviews each finished unit once and lands it on
  local `main`. It does no feature work.
- A **worker** builds one unit at a time in its worktree by directing
  agents (tests first, then code), runs the branch gate, and stops at
  "ready to merge".
- **You** start the sessions, type the `/goal` lines and the workflow
  opt-ins, say "go" and authorise merges, and push.

Every session keeps its state in a file, so a session can be cleared or
replaced at any time and continue from that file and from git.

## Set up, once

1. DynamoDB Local runs on `:8000` (`/seed`); the workers' tests need it.
2. Open each session in the repository, so that `CLAUDE.md` and the rules
   load. The coordinator and the planner open in the primary checkout.
3. Give each session its name from the table above. Sessions find each
   other by name.
4. In each worker: raise *Dynamic workflow size* in `/config` (plan units
   run as workflows).
5. Sessions in different permission modes cannot message each other live;
   they use the file relay (below). The planner always uses it.

## Start the sessions

Start the coordinator first. Type one line in each session:

```text
You are the coordinator of the worker sessions. Follow .claude/prompts/coordinator_prompt.md and resume from temp/coordinator/state.md
```

```text
You are the worker session <name>. Follow .claude/prompts/worker_prompt.md; your unit is in your row of temp/coordinator/state.md and the brief file it names.
```

```text
You are the planner. Follow .claude/prompts/planner_prompt.md and resume from temp/planner/state.md
```

Each session answers with what it is doing and what it waits for. A worker
with no unit says it is idle; that is correct.

## Run a piece of work

| Step | Where | What you do | What happens |
|---|---|---|---|
| 1 | `planner` | Describe what you want. Answer its questions | It writes the plan package and says "plan ready" |
| 2 | `Coordinator` | Say `check the relay` (or "take in plan `<slug>`") | It checks the plan and tells you the units, who runs them, each session's agent peak (at most 80 running at once in all), the usage estimate and your actions |
| 3 | `Coordinator` | Say "go" | It lands the spec unit, creates the worktrees and writes the briefs, wave by wave |
| 4 | each worker it names | Type the instruction and the `/goal` line the coordinator gives you, then the workflow opt-in, for example `Run unit <id> with the workflow in temp/planner/<slug>/workflow-<session>.md` | The worker builds the unit and sends "ready to merge" |
| 5 | `Coordinator` | Read its review summary and the decisions it relays; authorise the merge | It lands one commit per unit on local `main` and cleans up |
| 6 | your terminal | `git push` | CI runs the full suite |

Steps 4 and 5 repeat for each wave. A slash command and an opt-in cannot
be sent by another session, so they are always yours to type.

**A single goal without a plan** (a leftover unit, a fix after a red CI
run): tell the coordinator which goal and which worker. It briefs the
worker; you type the `/goal` line. The worker uses the Rule 70 loop with
at most 2 agents.

## The file relay

When a session's messages are held, the two sessions write to files in
`temp/coordinator/` of the primary checkout instead:

1. The coordinator tells you it wrote a message for a session.
2. In that session, say `check the relay`.
3. The session answers in its `from-<session>.md` file. In the coordinator,
   say `check the relay` if it does not pick the answer up by itself.

## Clear or replace a session

1. In the session, say `update your state file`, and wait for it.
2. Clear it, or open a new session and give it the same name.
3. Type its start line. For a worker in the middle of a unit, type the
   `/goal` line and the workflow opt-in again.

Uncommitted work stays in the unit's worktree and is kept. The session
checks its state file against git before it does anything.

## Stop

- **Usage freeze** (5-hour window at 75 %, weekly at 95 %): every worker
  commits what passed, writes its report and stops by itself. After the
  reset, start with the coordinator.
- **Stop one unit:** tell the worker to stop and hand over. It leaves the
  work in place, writes a handover file and tells the coordinator, which
  reassigns the unit.

## When something is off

| You see | Cause | Do |
|---|---|---|
| A worker says it is idle, but the coordinator assigned it a unit | The brief did not arrive, or the session has another name | Check the session name; in the worker say `check the relay`; ask the coordinator to confirm the brief |
| "held" or "not approved before expiry" on a message | The two sessions run in different permission modes | Use the file relay for that pair |
| A worker works in the wrong folder | It started in another directory | Tell it to re-read its brief; the brief names the absolute worktree |
| A worker refuses to run the workflow | No opt-in in your own words, or the rule on `main` does not allow it yet | Type the opt-in; otherwise it builds with the Rule 70 loop |
| The planner is asked to build a unit | A unit went to the wrong session | It answers "that belongs to a worker"; tell the coordinator which worker takes it |
| A session repeats finished work after a clear | Its state file was not current | Stop it; say `update your state file` before the next clear |
