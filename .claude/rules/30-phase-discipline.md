# Rule 30 — Phase discipline

Source: `docs/specs/2026-05-15-implementation-phases.md`.

## Build order (strict)

```
1 Foundation → 2 Layout Shell (2.1 → 2.3, in order) → 3 Data Layer
  → 4 Pages (4.1 → 4.9, in order)
    → 5 Polish & Accessibility
      → 6 AWS Lambda Collector
```

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
6. **Repo state today:** pre-implementation. Only `docs/`, `LICENSE`,
   `.gitignore`, `.github/`, `.claude/`, and `CLAUDE.md` exist. There is no
   `package.json` yet. Phase 1 establishes the toolchain.

## Branching & pull requests

> See [Rule 31](31-github-flow.md) for the overall GitHub Flow convention; the naming below is a specialisation of it.

Each phase ships on its own branch and merges via pull request — `main` never
receives direct commits.

1. **One `feature/` branch per phase.** Branch from an up-to-date `main` at the
   start of a phase, named `feature/phase-<n>-<slug>` (e.g.
   `feature/phase-1-foundation`). Phases that are split into sub-phases each get
   their own branch per sub-phase — `feature/phase-2.1-shell-nav`,
   `feature/phase-4.1-overview`, etc. (Rule 30.4 — one sub-phase per PR).
2. **A phase's tasks are commits on that branch**, each following Conventional
   Commits (commitlint).
3. **Open a PR to `main` as a draft by default** (`gh pr create --draft`; see
   [Rule 31](31-github-flow.md)). Mark it ready (`gh pr ready`) once the phase's
   "Verify" checklist passes — run `/verify-phase <n>` first; do not mark it
   ready on a failing checklist.
4. **One phase (or one sub-phase) per PR.** Phase 2 (2.1–2.3) and Phase 4
   (4.1–4.9) are split into independently deliverable sub-phases — never bundle
   multiple phases or sub-phases into a single branch or PR.
5. **Never commit or merge directly to `main`.**
