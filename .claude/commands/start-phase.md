---
description: Expand a phase's tasks into an actionable, ordered TODO list
argument-hint: <phase number, e.g. 1, 3, 4.2>
---

# /start-phase

Begin work on phase `$ARGUMENTS`.

Steps:

1. Read `docs/specs/2026-05-15-implementation-phases.md`
   and locate the phase (or sub-phase) section.
2. Run the same checks as `/phase-status` to confirm prior phases are
   complete. **If any prior phase is incomplete, refuse and report what's
   missing.**
3. Read the linked specs referenced from this phase (architecture / data-model
   / design-system as relevant).
4. Build a TODO list (use the todo tool) that mirrors the phase's task
   checklist, with each item expanded to:
   - target file path(s)
   - the spec section(s) it implements
   - any dependency on a previous item
5. Surface open questions before starting — do not invent answers for
   ambiguous requirements.
6. Do **not** start writing code in this command. The output is a plan only;
   the user confirms before implementation begins.
