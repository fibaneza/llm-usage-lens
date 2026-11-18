# Planner session — start sheet

For all three roles, see [`session-roles.md`](session-roles.md).

How to start and use the **planner** session, the Claude session that turns a
request into a plan the coordinator and its worker sessions run in parallel.
The planner's full instructions are in
[`.claude/prompts/planner_prompt.md`](../../.claude/prompts/planner_prompt.md); the
coordinator's side is
[`.claude/prompts/coordinator_prompt.md`](../../.claude/prompts/coordinator_prompt.md) §2b.

## Start or resume

Open Claude in the repository (the session is named `planner`) and say:

```text
You are the planner. Follow .claude/prompts/planner_prompt.md and resume from temp/planner/state.md
```

To pass the coordinator's messages to it, say `check the relay`.

## What the planner does

- **Role (user, 2026-11-18).** It writes plans, spec text and prompts, and
  never executes them: no build or test agents, no workflow runs, no git
  write commands, no unit worktrees. A "Take unit …" message is answered
  with "that belongs to a worker", not acted on.
- **Output.** A plan package in `temp/planner/<slug>/` — `plan.md`,
  `spec-changes.md`, one `brief-<unit>.md` per unit, one
  `workflow-<session>.md` per worker session — and a new worker prompt
  `docs/plans/<YYYYMMDD>_<slug>.md`. The coordinator commits the plan file and
  adds its row to `docs/plans/README.md`.
- **Parallel sessions.** Every unit gets a worker session, a worktree, a
  branch and a file list. Overlaps between units are found at plan time, by
  tracing who reads what a unit changes, and are written into the
  ownership table.
- **Spec text** is written into the package and applied by the plan's spec
  unit, on a branch, with the `spec-guardian` review. The planner does not
  commit it.

## Agent budget for workflows

At most **80 agents per plan**, summed across all sessions and phases,
review agents included (user, 2026-11-18). It is a total, not a number
running at once. Each plan carries an agent ledger with a model per agent,
a reserve for fix rounds and a usage estimate against the freeze tiers
(`.claude/prompts/coordinator_prompt.md` §3).

Every worker session runs its plan units as a workflow (user, 2026-11-18):
the plan has one workflow design per worker session that owns a unit. The
opt-in each run needs is the user's own start line in that worker session.

Rule 70 — *Workflows* and implementation-phases — *Workflow pilots* set
where a workflow may run and its cap. While they allow fewer agents than a
plan needs, the amendment is an item of that plan's spec unit, and no
workflow above the old cap starts before it is on `main` (Rule 00.2).

## Talking to the coordinator — the file relay

Live messages between the two sessions are held and expire undelivered,
because they run in different permission modes. They use two gitignored
files in the primary checkout instead:

| File | Written by | Contents |
|---|---|---|
| `temp/coordinator/to-planner.md` | coordinator | Numbered messages, `## P<n> · <UTC time>` |
| `temp/coordinator/from-planner.md` | planner | One line per reply, `<UTC time> re P<n>: <reply>`, and one `plan <slug>: ready` line per finished plan |

The planner reads the relay only when the user says `check the relay`. The
user's latest instruction wins over a relay message.

## State

`temp/planner/state.md` holds the plan in progress, the open questions with
their defaults, the decisions recorded and the last relay message answered.
It is local scratch and is never committed.
