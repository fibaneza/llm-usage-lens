---
description: Run the full lint + format + type-check gate
---

# /lint

Run the local quality gate that mirrors the GitHub Actions CI job.

Steps (run sequentially, stop on first failure):

1. `pnpm exec prettier --check .`
2. `pnpm exec eslint .`
3. `pnpm exec tsc --noEmit` (runs per-workspace via `pnpm -r` if configured)
4. `pnpm exec vitest run` (only if tests exist)

Report each step as **pass / fail** with the first 20 lines of output on
failure. Do not auto-fix without explicit user approval — show the diff
first.
