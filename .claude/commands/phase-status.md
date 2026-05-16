---
description: Report current phase progress against the implementation plan
---

# /phase-status

Determine which implementation phase the repo is in and what's blocking the
next one.

Steps:

1. Read [docs/specs/2026-05-15-implementation-phases.md](../../docs/specs/2026-05-15-implementation-phases.md).
2. Inspect repo state with `ls`/Glob:
   - `package.json`, `pnpm-workspace.yaml` → Phase 1 started?
   - `apps/dashboard/` exists? `apps/collector/`? `packages/shared/`?
   - `docker-compose.yml`, `scripts/create-table.ts`, `scripts/seed.ts` →
     Phase 3 started?
   - `apps/dashboard/app/(routes)/**/page.tsx` → which Phase 4 sub-phases?
3. For each phase, list status: **not started / in progress / complete**.
   - A phase is "complete" only if every task box in the spec is plausibly
     done **and** its "Verify" bullets would pass.
4. Identify the **next actionable phase** and the first 1–3 tasks to start.
5. Output as a compact table followed by the "next up" bullet list. No
   speculation about phases beyond the next blocker.
