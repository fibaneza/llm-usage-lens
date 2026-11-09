---
description: Report current phase progress against the implementation plan
---

# /phase-status

Determine which implementation phase the repo is in and what's blocking the
next one.

Steps:

1. Read `docs/specs/2026-05-15-implementation-phases.md`.
2. Inspect repo state with `ls`/Glob:
   - `package.json`, `pnpm-workspace.yaml` → Phase 1 started?
   - `apps/dashboard/` exists? `apps/collector/`? `packages/shared/`?
   - `.devcontainer/docker-compose.yml`, `scripts/create-table.ts`,
     `apps/dashboard/lib/dynamodb.ts`, `apps/dashboard/lib/data/` →
     Phase 3.2 started?
   - `apps/dashboard/app/dashboard/**/page.tsx` → which Phase 4 sub-phases?
   - The CI `test` job in `.github/workflows/llm-usage-lens-build.yml` and
     recent `git log` for merged sub-phase PRs — check both before declaring
     status.
3. For each phase, list status: **not started / in progress / complete**.
   - A phase is "complete" only if every task box in the spec is plausibly
     done **and** its "Verify" bullets would pass.
4. Identify the **next actionable phase** and the first 1–3 tasks to start.
5. Output as a compact table followed by the "next up" bullet list. No
   speculation about phases beyond the next blocker.
