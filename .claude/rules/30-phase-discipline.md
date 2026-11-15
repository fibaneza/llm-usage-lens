# Rule 30 — Phase discipline

Source: `docs/specs/2026-05-15-implementation-phases.md`.

## Build order (strict)

```
1 Foundation → 2 Layout Shell (2.1 → 2.3, in order)
  → 3 Data Layer (3.1 → 3.3, in order)
    → 4 Pages (4.1 → 4.9, in order)
      → 4R Access & Platform (RP → R1 → R5, in order)
        → LiteLLM units (L0–L8; L3b and L3c between L3 and L4)
          → 5 Polish & Accessibility
            → 6 AWS Lambda Collector
```

Phase 4.9b (tag coverage) is deferred and does not block Phase 5; it starts
once its data path is specced (implementation-phases — *Phase 4.9b*).

The Phase 5 *UI refresh — fluid workspace* task may run before Phases 4R.2–4R.5
and the LiteLLM units at the user's direction (decided 2026-11-11;
implementation-phases — *Phase 5*). The rest of Phase 5 keeps its place.

LiteLLM units L1 and L2 may run in parallel with Phases 4R.3–4R.5 at the
user's direction (decided 2026-11-14): they need only 4R.1–4R.2 and the
Phase 4.9 Settings shell. L3 and later keep their dependencies (L3 needs
4R.3; L4 needs 4R.3 and 4R.4). Parallel runs use separate worktrees with
disjoint file ownership (implementation-phases — *LiteLLM units*).

## Rules

1. **Do not start a phase whose dependencies are unmet.** Run `/phase-status`
   first; if blocked, surface it and stop.
2. **Components are built where first needed** and reused later. Do not
   speculatively build components for a future page.
3. **Each phase has a "Verify" checklist in the spec.** Complete it before
   moving on. Use `/verify-phase <n>`.
4. **Phase 4 sub-phases are independently deliverable** — one page at a time.
   Do not combine 4.x sub-phases in a single PR unless explicitly asked.
5. **Phase 6 (the Lambda collector) is last.** The dashboard is developed
   against DynamoDB Local + seed scripts until then.
6. **Repo state is not recorded here.** Run `/phase-status` before starting
   work — it checks the task and Verify checkboxes in
   `docs/specs/2026-05-15-implementation-phases.md` against the repo and
   `git log`.

## Branching & pull requests

> See [Rule 31](31-github-flow.md) for the overall GitHub Flow convention; the naming below is a specialisation of it.

Each phase ships on its own branch (in a worktree) and lands on `main` as one
local squash-merge (Rule 31, *Integration workflow*) — `main` never receives
direct work commits.

1. **One `feature/` branch per phase.** Branch from an up-to-date `main` at the
   start of a phase, named `feature/phase-<n>-<slug>` (e.g.
   `feature/phase-1-foundation`). Phases that are split into sub-phases each get
   their own branch per sub-phase — `feature/phase-2.1-shell-nav`,
   `feature/phase-4.1-overview`, etc. (Rule 30.4 — one sub-phase per PR).
2. **A phase's tasks are commits on that branch**, each following Conventional
   Commits (commitlint).
3. **Merge only on a passing checklist.** Run `/verify-phase <n>` first; squash-merge
   into local `main` (or mark an optional PR ready) only when the phase's
   "Verify" checklist passes. CI-dependent bullets stay unticked until the user
   has pushed and CI is green.
4. **One phase (or one sub-phase) per branch and squash commit.** Phase 2 (2.1–2.3), Phase 3
   (3.1–3.3), and Phase 4 (4.1–4.9) are split into independently deliverable
   sub-phases — never bundle multiple phases or sub-phases into a single branch
   or squash commit.
5. **Never commit work directly on `main`, and never push.** `main` changes
   only through local squash-merges (Rule 31); pushing is the user's action.
