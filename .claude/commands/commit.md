---
description: Stage and commit using Conventional Commits + commitlint
argument-hint: <optional scope hint, e.g. dashboard, collector, shared>
---

# /commit

Create a Conventional Commits commit that satisfies commitlint, gitleaks, and
the pre-commit lint-staged hooks.

Steps:

1. Show `git status` and `git diff --stat`. Group changes by area.
2. Propose a commit message in the form
   `type(scope): subject` where:
   - `type` ∈ `feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`
   - `scope` is taken from `$ARGUMENTS` if provided, otherwise inferred from
     the changed paths (e.g. `dashboard`, `collector`, `shared`, `infra`,
     `docs`).
   - `subject` is imperative, lower-case, no period, ≤72 chars.
   - Add a body for non-trivial changes explaining **why**, not what.
3. Run `git add` for the intended files (ask before `git add .`).
4. Run `git commit -m "..."`. Let pre-commit hooks run — **never** use
   `--no-verify`.
5. If gitleaks or lint-staged fails, stop and report — do not bypass.
