# Testing guide

How the Vitest suite of the dashboard workspace is laid out and run. Rule 60
(*Testing*) holds the conventions; this guide is the map. Written 2026-11-17
by the test-structure chore ([plan](../app-refactor.md)).

Out of scope here: the Playwright e2e suite (`apps/dashboard/e2e/`, headless
only — Rule 70.11) and the standalone simulator (`tools/bedrock-simulator/`,
own test setup).

## Projects

One root [`vitest.config.ts`](../../vitest.config.ts) with three projects.

| Project | Environment | Matches | Needs |
|---|---|---|---|
| `unit` | jsdom (React Testing Library, jest-dom, user-event) | `apps/**`, `packages/**`, `scripts/**` — `*.test.ts(x)` | nothing |
| `integration` | node | `*.integration.test.{ts,tsx}` under `apps/`, `packages/`, `scripts/` | DynamoDB Local on `:8000` |
| `infra` | node | `infra/**/*.test.ts` (CDK stack tests) | nothing |

- `unit` loads [`test/setup/vitest.setup.ts`](../../apps/dashboard/test/setup/vitest.setup.ts)
  (jest-dom matchers and the jsdom shims).
- `integration` runs files serially against one table named per run
  (`bedrock-usage-test-<pid>`), created and deleted by
  [`test/setup/integration-global-setup.ts`](../../apps/dashboard/test/setup/integration-global-setup.ts),
  so several worktrees can share one DynamoDB Local.
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
| `pnpm test` | all three projects |
| `pnpm test:unit` | `unit` only (no DynamoDB) |
| `pnpm test:integration` | `integration` only |
| `pnpm test:infra` | `infra` only |
| `pnpm exec vitest run path/to/foo.test.ts` | one file |
| `pnpm exec vitest run --project unit lib/auth` | one project, filtered by path |
| `pnpm exec vitest run --changed $(git merge-base main HEAD)` | the tests impacted by a branch (Rule 70.12) |
| `pnpm test:coverage` | all three projects with coverage |
| `pnpm check` | the full local gate (typecheck, lint, format, all tests, build, bundle scan) |

The pre-push hook runs `unit` and `infra`; CI runs everything
([git hooks](git-hooks.md), [`.github/ACTIONS.md`](../../.github/ACTIONS.md)).
Read results, not logs: redirect a run to a file and read the exit code and
the `Test Files` / `Tests` lines (Rule 70.12).

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

No threshold is enforced yet, and CI does not run coverage. Baseline at
`chore/test-structure` (2026-11-17, all three projects, 8020 tests):

| Statements | Branches | Functions | Lines |
|---|---|---|---|
| 93.70% | 86.54% | 93.29% | 94.85% |

A threshold, if one is added, starts from this baseline.
