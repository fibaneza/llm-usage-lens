---
description: Run the headless Playwright UI suite and audit e2e coverage of changed components
argument-hint: [optional spec file or grep filter, e.g. "smoke" or "settings"]
---

# /ui-review

Run the dashboard's headless Playwright suite and report — the standalone
entry point to the same verification the `playwright-ui-reviewer` agent
performs inside the `/build-feature` loop (Rule 70.11).

## Constraints

- **Headless only.** The devcontainer has no display server — never pass
  `--headed`, `--ui`, or `--debug`. The config
  (`apps/dashboard/playwright.config.ts`) already forces headless Chromium on
  port 3211 and boots its own dev server with a test `AUTH_SECRET`.
- Read-only on source: this command never edits specs or components. Gaps and
  failures are reported; fixes go through `/build-feature`.

## Steps

1. **Ensure the browser is present.** If chromium is missing
   (`pnpm --dir apps/dashboard exec playwright install --with-deps chromium`
   installs it once; normally done by `.devcontainer/post-create.sh`).
2. **Run the suite:** `pnpm test:e2e` — append `$ARGUMENTS` as a filter when
   given (e.g. `pnpm test:e2e -- smoke`).
3. **On failures**, read `apps/dashboard/test-results/` (screenshots, traces)
   and summarise per failing spec: which page, what rendered, which assertion
   failed.
4. **Audit coverage:** diff the working tree (`git diff --name-only main`)
   — every added/modified file under `apps/dashboard/components/**` or
   `apps/dashboard/app/**` should be exercised by at least one spec in
   `apps/dashboard/e2e/` (nav pages are covered automatically by
   `smoke.spec.ts` via `lib/nav.ts`). List uncovered components.
5. **Report:** pass/fail counts, failure summaries, coverage gaps, and a
   suggested next step (`/build-feature` for fixes or new specs).
