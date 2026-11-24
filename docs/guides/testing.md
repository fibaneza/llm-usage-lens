# Testing guide

How the Vitest suite of the dashboard workspace is laid out and run. Rule 60
(*Testing*) holds the conventions; this guide is the map. Written 2026-11-17
by the test-structure chore ([plan](../app-refactor.md)).

Out of scope here: the Playwright e2e suite (`apps/dashboard/e2e/`, headless
only — Rule 70.11) and the standalone simulator (`tools/bedrock-simulator/`,
own test setup).

## Projects

One root [`vitest.config.ts`](../../vitest.config.ts) with four projects.

| Project | Environment | Matches | Needs |
|---|---|---|---|
| `unit` | jsdom (React Testing Library, jest-dom, user-event) | `apps/**`, `packages/**`, `scripts/**` — `*.test.ts(x)` | nothing |
| `integration` | node | `*.integration.test.{ts,tsx}` under `apps/`, `packages/`, `scripts/` | DynamoDB Local on `:8000` |
| `integration-serial` | node | two `*.integration.test.ts` files that cannot run beside others (below) | DynamoDB Local on `:8000` |
| `infra` | node | `infra/**/*.test.ts` (CDK stack tests) | nothing |

- `unit` loads [`test/setup/vitest.setup.ts`](../../apps/dashboard/test/setup/vitest.setup.ts)
  (jest-dom matchers and the jsdom shims).
- `integration-serial` has the same settings as `integration` (one shared
  object in `vitest.config.ts`) but lists only the files in
  `SERIAL_INTEGRATION_FILES`, runs them one after the other (`fileParallelism:
  false`, `maxWorkers: 1`) and after the `integration` group
  (`sequence.groupOrder: 2`). Both are excluded from `integration`. Its global
  setup teardown runs once per project at the end of the whole run and only
  deletes this run's tables, so the repeat is harmless. Files (implementation-phases — *Maintenance — test clean-up, second pass, and test speed*, D-TS5):
  - `apps/dashboard/lib/data/identity.integration.test.ts`: temporary, serial
    only until `fix/master-lock-race` lands. A production race in
    `reserveMasterAttempt` (`repairMissingLock` writes `lockedUntil` first, so
    `lockedNow` is lost) shows under parallel load; after the fix the file
    returns to `integration`.
  - `scripts/lib/run-seed.integration.test.ts`: a heavy writer that reaches the
    60 s timeout beside parallel files.
  A unit whose new integration test fails only in parallel reports it and adds
  the file to `SERIAL_INTEGRATION_FILES` as a shared line (implementation-phases — *Maintenance — test clean-up, second pass, and test speed*, D-TS5).
- `integration` runs as its own group after `unit` and `infra` (`sequence.groupOrder: 1`;
  Vitest needs a separate group for a per-project worker cap), files in
  parallel, at most 4 workers (this project only).
  [`test/setup/integration-file-table.ts`](../../apps/dashboard/test/setup/integration-file-table.ts)
  gives each test file its own table, `bedrock-usage-test-<pid>-<slot>-<suffix>`
  (slot = `VITEST_POOL_ID`, suffix = random), and creates it before the file's
  tests. It is per file, not per worker, because Vitest frees a pool slot when a
  file ends without waiting for the old worker, so the next file can get the
  same slot while the old worker still writes. At the end of the run
  [`test/setup/integration-global-setup.ts`](../../apps/dashboard/test/setup/integration-global-setup.ts)
  deletes every table of this pid (and refuses a non-local endpoint), so
  several worktrees can share one DynamoDB Local. A run that is killed
  (SIGKILL, a closed terminal) skips that teardown and leaves its
  `bedrock-usage-test-*` tables; delete them by hand against DynamoDB Local
  only (for example with `dynamodb-admin`, or `aws dynamodb delete-table`
  with `--endpoint-url http://localhost:8000`), never against an AWS endpoint.
- Every project sets `restoreMocks`, `unstubEnvs` and `unstubGlobals`: spies,
  `vi.stubEnv` and `vi.stubGlobal` are undone after each test. A test does not
  need its own `afterEach` for them.
- `.spec.ts` is Playwright's suffix; Vitest never picks it up.

## Where a test goes

| Kind | Location and name |
|---|---|
| Unit test of `foo.ts` / `Foo.tsx` | next to it: `foo.test.ts`, `Foo.test.tsx` |
| Integration test of `foo.ts` (DynamoDB Local) | next to it: `foo.integration.test.ts` |
| A Route Handler's own test | `route.integration.test.ts` in the route's folder |
| A test that covers several routes or modules | `__tests__/` at their lowest common directory — `app/api/__tests__/` (cross-route contracts, scoping, write-route enforcement), `app/dashboard/__tests__/` (pages across routes), `app/api/litellm/connection/__tests__/`, `app/api/litellm/team-links/__tests__/` |
| A named aspect of one source | `<source>.<aspect>.test.ts` — `AppSidebar.mobile.test.tsx`, `master-user.persistence.test.ts`. Never a run or a review round (`*.r1`, `*.review`): extend the canonical file instead (Rule 60.24a) |
| CDK stack tests | `infra/test/` — the one exception: they assert on synthesised stacks and have no one-to-one source file |
| E2E | `apps/dashboard/e2e/*.spec.ts` (Playwright) |

Shared test code lives only in `apps/dashboard/test/`, never under `lib/` or
`components/`, imported as `@/test/<folder>/<file>`:

| Folder | Holds |
|---|---|
| `test/setup/` | Vitest setup: `vitest.setup.ts` (+ its own test), `integration-global-setup.ts`, `server-only-stub.ts` |
| `test/fakes/` | Stand-ins for dependencies: `next-cache-fake`, `otel-fake`, `fake-litellm`, `fake-litellm-gateway`, `fake-litellm-views`, `api-stubs`, `access-ui-stubs` |
| `test/fixtures/` | Data builders and seeds: `rollup-builder`, `scope-fixtures`, `access-viewers`, `route-sessions`, `e2e-identity-seed`, `role-probe-seed` |
| `test/support/` | Helpers: `test-support`, `render-providers`, `chart-test-utils`, `csv-test-support`, `matrix-route-support`, `governance-route-support`, `password-test-support`, `access-test-support`, `keys-test-support`, `litellm-member-writes-support`, `litellm-team-writes-support` |
| `test/route-registry.ts` | The registry the shared route-contract suite iterates; a new Route Handler registers here (Rule 60.23) |

`apps/dashboard/e2e/support/` is Playwright's own support folder and stays
separate.

## Running

DynamoDB Local first, for anything that runs `integration`:

```bash
docker compose -f .devcontainer/docker-compose.yml up -d dynamodb-local
```

| Command | Runs |
|---|---|
| `pnpm test` | all four projects |
| `pnpm test:unit` | `unit` only (no DynamoDB) |
| `pnpm test:integration` | `integration` and `integration-serial` |
| `pnpm test:infra` | `infra` only |
| `pnpm exec vitest run --project integration --no-file-parallelism` | integration files one at a time, for a debug (or `--maxWorkers=1`) |
| `pnpm exec vitest run path/to/foo.test.ts` | one file |
| `pnpm exec vitest run --project unit lib/auth` | one project, filtered by path |
| `pnpm exec vitest run --changed $(git merge-base main HEAD)` | the tests impacted by a branch (Rule 70.12) |
| `pnpm test:coverage` | all four projects with coverage |
| `pnpm check` | the full local gate (typecheck, lint, format, all tests, build, bundle scan) |

The pre-push hook runs `unit` and `infra`; CI runs everything
([git hooks](git-hooks.md), [`.github/ACTIONS.md`](../../.github/ACTIONS.md)).
Read results, not logs: redirect a run to a file and read the exit code and
the `Test Files` / `Tests` lines (Rule 70.12).

### Prefixed e2e project (unit BP)

Unit BP (Platform spec — _Base path_) adds **one small Playwright project**
for the app served under `/llm-lens`. It has its own production server on
port **3214** (3211 to 3213 are the main server, the fake LiteLLM server and
the role-probe server), its own `NEXT_DIST_DIR`, and is built with
`NEXT_PUBLIC_BASE_PATH=/llm-lens`. Specs are `e2e/base-path*.spec.ts`; the
main project ignores them and the prefixed project runs only them. Specs use
explicit prefixed URLs (a `baseURL` with a path does not prefix
`goto("/dashboard")`). The session forge adds its cookie with `domain` and
`path`, not `url` (`addCookies({ url })` drops the last path segment), and
takes the cookie name and path from the same module as the auth config
(Access Control — BP-D12). Readiness is `/llm-lens/api/health`; `AUTH_URL` is
origin-only. It starts only when requested (`E2E_BASE_PATH_PROJECT=1` or `--project=base-path`), because Playwright starts every `webServer`; CI does not run it yet (Platform — BP-D15). It runs once, at the green gate (Rule 70.12 — _E2E budget_):
`pnpm --filter @llm-usage-lens/dashboard exec node ../../scripts/e2e-lock.mjs playwright test --project=base-path`.

### E2E without LiteLLM

CI's e2e job starts from a freshly seeded table (`pnpm db:create-table`,
`pnpm db:seed`) with **no stored LiteLLM connection**, so LiteLLM is _not
configured_ there (the base URL lives in the connection item; the e2e service
key alone is not enough). Locally, a connection saved by an earlier run (the
`dev-login` spec stores one) persists in DynamoDB Local and hides that state.
Every page must render without a `5xx` or a console error when LiteLLM is not
configured: it shows "LiteLLM not configured" (Design System — _LiteLLM Page_, _States_; LiteLLM spec LD37). Before `ready`, when a change touches
a LiteLLM page or route, reset the local table first, as CI does:

```bash
pnpm db:seed:empty && pnpm db:seed && CI=1 pnpm --filter @llm-usage-lens/dashboard exec node ../../scripts/e2e-lock.mjs playwright test smoke responsive manage-pages
```

(Added 2026-11-17 after `main` e76e2e5 went red in CI: the Organisation route
called LiteLLM while no connection was stored.)

## Coverage

`pnpm test:coverage` uses `@vitest/coverage-v8` and writes `coverage/`
(gitignored): a `text` summary, an `html` report and `lcov.info`. It measures
the dashboard sources (`app`, `components`, `hooks`, `lib` and the root
`auth.ts`, `env.ts`, `proxy.ts`, `instrumentation.ts`), `packages/shared/src`,
`infra/{bin,lib}` and `scripts`; tests, `test/`, `e2e/`, `.next/` and
`cdk.out/` are excluded.

To compare coverage before and after a change to the tests, write the
JSON report to a folder of your own and keep the default reporters out
of the way:

    pnpm exec vitest run --coverage --coverage.reporter=json --coverage.reportsDirectory=temp/<run>/after-coverage

`coverage-final.json` lists the hits per statement, branch and function;
a removal of tests is safe for coverage when nothing with a hit before
has none after (implementation-phases — *Maintenance — test clean-up,
second pass*).

No threshold is enforced yet, and CI does not run coverage. Baseline at
`chore/test-structure` (2026-11-17, all three projects, 8020 tests):

| Statements | Branches | Functions | Lines |
|---|---|---|---|
| 93.70% | 86.54% | 93.29% | 94.85% |

A threshold, if one is added, starts from this baseline.
