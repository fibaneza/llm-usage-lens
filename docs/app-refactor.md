# Test structure refactor — plan

A plan to make the Vitest layout of the dashboard workspace consistent and
documented, without changing application behaviour. Written 2026-11-16 from a
review of `main` at `2a07115`.

**Status: done on `chore/test-structure` (2026-11-17).** The resulting layout,
commands and coverage baseline are in [the testing guide](guides/testing.md).
The paths below describe the state before the moves.

This is a chore, not a phase: it does not belong to the Rule 30 build order. It
runs as one goal on one branch (`chore/test-structure`) and lands as one squash
commit (Rule 31).

## Decisions (user, 2026-11-16)

- **Tests stay next to the code.** A central `tests/unit` and
  `tests/integration` tree is rejected: it would contradict Rule 60.20 and
  Rule 60.24a ("the canonical test file next to the code"), touch about 280
  files, and gain nothing, because the `.integration.test.ts` suffix already
  separates the two kinds.
- **Coverage is added.** One new devDependency, `@vitest/coverage-v8`, pinned
  to the installed Vitest version.
- **Wait for the open branches.** The goal starts only when no other branch
  has unmerged work (see _Precondition_).

## Current state

- Next.js 16 App Router, React 19, TypeScript strict, pnpm monorepo.
- Vitest 4.1.8, one root `vitest.config.ts` with two projects: `unit` (jsdom,
  setup file `apps/dashboard/vitest.setup.ts`) and `integration` (node,
  DynamoDB Local, `*.integration.test.ts`, serial files, per-run table).
- React Testing Library, jest-dom and user-event. No MSW. Playwright for e2e
  (`apps/dashboard/e2e/`, 28 specs).
- About 280 Vitest files in scope, 94 of them integration. Dashboard,
  `packages/shared` and `scripts` colocate tests; `infra/test/` holds the CDK
  stack tests.
- 22 shared helper files in `apps/dashboard/test/`, imported through
  `@/test/...` (286 imports). No duplicated render wrappers or fixtures were
  found, so no helper consolidation is needed beyond the moves below.

Out of scope: `tools/bedrock-simulator/` (standalone, own test setup) and the
Playwright specs and `e2e/support/`.

## Issues

| #   | Issue                                                                                                                                 | Evidence                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Per-run test file, banned by Rule 60.24a                                                                                              | `apps/dashboard/auth.r1.test.ts`                                                                                 |
| 2   | Test support living in production folders                                                                                             | `lib/auth/password-test-support.ts`, `lib/data/access/access-test-support.ts` (54 importers), `lib/data/access/keys-test-support.ts` |
| 3   | 31 cross-cutting integration tests loose at the `app/api/` root, mixed with route folders                                             | `scoping`, `write-routes`, `route-contract`, `governance`, …                                                     |
| 4   | Two names for a route's own test                                                                                                      | `route.integration.test.ts` (accounts, health, sync-status) against `<folder>.integration.test.ts` (`litellm/**`) |
| 5   | `test/` is flat and mixes setup, fakes, fixtures and route support; the setup file sits at the dashboard root                         | `apps/dashboard/vitest.setup.ts`, `apps/dashboard/test/*`                                                        |
| 6   | Integration globs match `.ts` only, so a `*.integration.test.tsx` would silently run in the jsdom project                             | none exist today                                                                                                 |
| 7   | No central mock cleanup: 41 files call `restoreAllMocks` by hand, 62 `unstubAllGlobals`, 19 `unstubAllEnvs`; 3 files stub and never unstub | `vitest.config.ts` sets none of `restoreMocks`, `unstubEnvs`, `unstubGlobals`                                    |
| 8   | No coverage provider, config or script                                                                                                | `@vitest/coverage-v8` is not installed                                                                           |
| 9   | CDK tests run in the jsdom project behind a `// @vitest-environment node` pragma; the setup file guards every shim with `hasDom`      | 15 pragmas                                                                                                       |
| 10  | No testing guide; the convention is split across Rule 60, CONTRIBUTING and CLAUDE.md                                                  | —                                                                                                                |

## Target conventions

- A test sits next to its source: `foo.ts` → `foo.test.ts`,
  `foo.integration.test.ts`.
- `<source>.<aspect>.test.ts` is allowed only for a named aspect of the source
  (`AppSidebar.mobile.test.tsx`). Never for a run or review round.
- A Route Handler's own test is `route.integration.test.ts` in the route's
  folder.
- A test that covers several routes or modules lives in a `__tests__/` folder
  at the lowest common directory (`app/api/__tests__/`).
- Shared test code lives only in `apps/dashboard/test/`, never under `lib/` or
  `components/`.
- `infra/test/` stays as it is: its tests assert on synthesised stacks and have
  no one-to-one source file. This is the one documented exception.

## Steps

1. **Baseline.** On the fresh branch, record per project the file count and
   test count (`pnpm exec vitest list --project <name> --filesOnly`, then the
   `Test Files` and `Tests` lines of a full run), and the `pnpm check` result
   with DynamoDB Local on `:8000`. Any later failure is compared against this
   to decide whether it is pre-existing.
2. **Rules first (Rule 00.2).** Amend Rule 60.20 and `.github/CONTRIBUTING.md`
   with _Target conventions_ before moving any file.
3. **Naming.**
   - Merge `auth.r1.test.ts` into `auth.test.ts`; keep every case.
   - Review the other aspect-suffixed files (16 unit, 2 integration). Keep
     those that name a real aspect; merge any that do not.
   - Rename each route's own test under `app/api/litellm/**` to
     `route.integration.test.ts`. A file that covers more than one route folder
     moves to `__tests__/` instead (step 4).
4. **Cross-cutting API tests.** Move the 31 files at the `app/api/` root into
   `app/api/__tests__/`. Apply the same rule to `app/dashboard/` if it has
   tests with no sibling source that span pages.
5. **Support files.** Move `password-test-support.ts`,
   `access-test-support.ts` and `keys-test-support.ts` into
   `apps/dashboard/test/` and update their importers. Check `eslint.config.ts`
   still exempts them (the `apps/dashboard/test/**` override already does).
6. **Group `apps/dashboard/test/`.** This step has the most churn and the least
   value; drop it if the diff becomes too large to review.

   | Folder      | Files                                                                                                                                                              |
   | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `setup/`    | `vitest.setup.ts` and `vitest.setup.test.tsx` (from the dashboard root), `integration-global-setup.ts`, `server-only-stub.ts`                                     |
   | `fakes/`    | `next-cache-fake`, `otel-fake`, `fake-litellm`, `fake-litellm-gateway`, `fake-litellm-views`, `api-stubs`, `access-ui-stubs`                                       |
   | `fixtures/` | `rollup-builder`, `scope-fixtures`, `access-viewers`, `route-sessions`, `e2e-identity-seed`, `role-probe-seed`                                                     |
   | `support/`  | `test-support`, `render-providers`, `chart-test-utils`, `csv-test-support`, `matrix-route-support`, `governance-route-support`, and the three files from step 5 |

   `test/route-registry.ts` keeps its path: Rule 60.23 and CLAUDE.md cite it.
   `e2e/support/identity.ts` and `e2e/role-landing.spec.ts` import from
   `test/`; update those two imports.

7. **Vitest config** (`vitest.config.ts`).
   - Integration include and unit exclude use `*.integration.test.{ts,tsx}`.
   - Unit include matches `.test.` only; `.spec.` is Playwright's.
   - One shared constant for the `@` alias and the `server-only` stub.
   - `restoreMocks`, `unstubEnvs` and `unstubGlobals` set to `true` in every
     project. Confirm with a full run. A test that breaks because it relied on
     a spy or stub surviving between cases gets its setup fixed; the option is
     not turned off and no assertion is weakened. Removing the now-redundant
     per-file calls is optional and only where it is mechanical.
   - A third project `infra` (node, `infra/**/*.test.ts`, no setup file). Remove
     the pragma from those files. Update `.husky/pre-push` to run
     `--project unit --project infra`, and `docs/guides/git-hooks.md` to match.
   - Setup file paths follow step 6.
8. **Coverage.**
   - Add `@vitest/coverage-v8` at the Vitest version to the root
     devDependencies.
   - `coverage` block: provider `v8`; include `apps/dashboard/{app,components,hooks,lib}/**`,
     the dashboard root modules (`auth.ts`, `env.ts`, `proxy.ts`,
     `instrumentation.ts`), `packages/shared/src/**`, `infra/{bin,lib}/**` and
     `scripts/**`; exclude tests, `test/`, `e2e/`, `.next/`, `cdk.out/` and
     type-only files; reporters `text`, `html`, `lcov`.
   - Script `test:coverage` (`vitest run --coverage`). No thresholds until a
     baseline exists; record the baseline in the guide. `coverage/` is already
     in `.gitignore` and `.prettierignore`.
   - CI is not changed in this goal.
9. **Docs.**
   - New `docs/guides/testing.md`: the layout, where unit, integration and
     cross-cutting tests go, naming, the `test/` folders, how to run the suite,
     one project, one file, and coverage.
   - Link it from CLAUDE.md (index and the commands table, with
     `pnpm test:coverage`), README, Rule 00's spec index, and the
     `tdd-test-engineer` agent.
   - Update any path this plan moved in CLAUDE.md, Rule 60, Rule 70 and
     `.github/ACTIONS.md`.
10. **Validate.**
    - `pnpm check` with DynamoDB Local on `:8000`, then `pnpm test:coverage`.
      Test infrastructure changed, so the gate is the full suite (Rule 70.12).
    - Targeted e2e for the two specs whose imports changed.
    - File and test counts per project equal the baseline, minus the one merged
      file and plus the new `infra` project's share of `unit`.
    - `git grep` finds no import of a moved path and no doc reference to one.
    - `lib/data/access/structure.test.ts` and `lib/litellm/structure.test.ts`
      pass (they read files, so they see the moves).

## Constraints

- Moves use `git mv`, with content changes limited to import paths.
- No production code changes, except deleting the three support files from
  `lib/` once they have moved.
- No assertion is edited, weakened or deleted. A test that cannot pass after a
  config change is reported, not altered.
- No new dependency other than `@vitest/coverage-v8`. No MSW.
- No empty folders or placeholder files.
- Role boundaries (Rule 70.8): test moves and edits are the
  `tdd-test-engineer`'s; config, hook and docs edits are the orchestrator's.
- Review once at the end: `quality-reviewer` plus `spec-guardian` (rules
  change). No UI changed, so no `playwright-ui-reviewer`.

## Precondition and ownership

Steps 4, 5 and 6 rewrite import lines in about 290 test files. Any branch that
adds or edits tests against the current paths will conflict. On 2026-11-16 the
branches with unmerged work were `feature/ui-compact-workspace`,
`feature/phase-l4-litellm-writes`, `feature/settings-admin-area` and
`docs/e2e-budget`.

- **Start only when no other goal has unmerged work**, from the latest `main`.
- **While it runs, no other goal runs.** It owns `vitest.config.ts`,
  `apps/dashboard/test/**`, every `*.test.ts(x)` file, `.husky/pre-push`, the
  root `package.json` scripts and lockfile, Rule 60, CONTRIBUTING and the new
  guide.
- If the user wants it sooner, steps 1, 2, 7, 8, 9 and the `auth.r1` merge can
  run alongside other goals as a first commit, with the moves as a second
  goal later. The mock-cleanup options in step 7 can still surface a failing
  test on another branch after it merges `main`.

## Goal condition

For the `/goal` line when a worker starts this:

> On branch `chore/test-structure`: steps 1–10 of `docs/app-refactor.md` are
> done; `pnpm check` and `pnpm test:coverage` exit 0; per-project test counts
> match the recorded baseline; no import or doc references a moved path;
> `docs/guides/testing.md` exists and is linked; everything is committed and
> the worktree is clean. Stop at "ready to merge"; do not merge into `main`.

## Deliverables in the run report

1. The original structure and the issues found.
2. The final folder structure.
3. Files moved, created, modified and removed.
4. The Vitest configuration changes and why.
5. Test results against the baseline, with typecheck and lint results.
6. The coverage baseline.
7. Outstanding issues and recommendations.
