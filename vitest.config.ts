import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Root Vitest config scoping the suite to the dashboard workspace (apps +
// packages + scripts + infra) and keeping the standalone simulator out. Four
// projects (docs/guides/testing.md):
//  - `unit`: jsdom + React Testing Library; needs no external services.
//  - `integration`: node, `*.integration.test.{ts,tsx}` against DynamoDB Local
//    (localhost:8000; Rule 60.22). Runs as its own group (`groupOrder: 1`)
//    after unit and infra. Files run in parallel, at most 4 workers;
//    each test file gets its own table `bedrock-usage-test-<pid>-<slot>-<suffix>`
//    (created by test/setup/integration-file-table.ts), so files and concurrent
//    runs (e.g. several worktrees) never clear each other's data. Per file, not
//    per worker: Vitest reuses a pool slot before the old worker has exited.
//    The global setup deletes this run's tables afterwards.
//  - `integration-serial`: the integration settings for the files in
//    `SERIAL_INTEGRATION_FILES` only, one file at a time after the
//    `integration` group (`groupOrder: 2`; implementation-phases, test speed, D-TS5).
//  - `infra`: node, the CDK stack tests in `infra/` (no DOM, no setup file).
// The pre-push hook runs `unit` and `infra`; CI and `pnpm test` run all four.
// Both integration projects list the same global setup; its teardown runs once
// per project when the whole run ends (after the serial group) and only deletes
// this run's tables, so the second run is a harmless no-op.
const resolve = {
  alias: {
    // Mirror the dashboard tsconfig "@/*" path alias.
    "@": fileURLToPath(new URL("./apps/dashboard", import.meta.url)),
    // `server-only` throws outside a React Server Components build; unit and
    // integration tests load server modules for real.
    "server-only": fileURLToPath(
      new URL(
        "./apps/dashboard/test/setup/server-only-stub.ts",
        import.meta.url,
      ),
    ),
  },
};

// Every project restores spies and unstubs env vars and globals after each
// test, so no stub leaks between cases or files.
const isolation = {
  restoreMocks: true,
  unstubEnvs: true,
  unstubGlobals: true,
};

const integrationTableName = `bedrock-usage-test-${process.pid}`;

// Files that cannot run beside others (implementation-phases, test speed, D-TS5); each stays out
// of `integration` (exclude) and runs in `integration-serial`, whose include
// names them literally.
const SERIAL_INTEGRATION_FILES = ["scripts/lib/run-seed.integration.test.ts"];

const integrationTest = {
  environment: "node" as const,
  ...isolation,
  setupFiles: ["./apps/dashboard/test/setup/integration-file-table.ts"],
  globalSetup: ["./apps/dashboard/test/setup/integration-global-setup.ts"],
  // Seed-reset tests write and delete thousands of items against
  // DynamoDB Local; the 5s default times out on CI runners.
  testTimeout: 60_000,
  hookTimeout: 60_000,
  // DynamoDB Local settings; no credentials are set here.
  env: {
    DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
    AWS_REGION: "us-east-1",
    INTEGRATION_TABLE_BASE: integrationTableName,
    DYNAMODB_TABLE_NAME: integrationTableName,
    SKIP_ENV_VALIDATION: "true",
    // The list-cursor HMAC key derives from AUTH_SECRET and there is no
    // fallback (Access Control spec, user decision 2026-11-15); a
    // test-only value, never a real secret.
    AUTH_SECRET: "integration-test-auth-secret",
    // Unit CFG (System Architecture — Configuration file, A9): the
    // file beats saved toggles, so integration tests that save a
    // toggle (deleteKey: true) read an empty configuration by default;
    // a test names another fixture with vi.stubEnv("APP_CONFIG_FILE").
    APP_CONFIG_FILE: fileURLToPath(
      new URL(
        "./apps/dashboard/test/fixtures/config/empty.yaml",
        import.meta.url,
      ),
    ),
  },
};

const integrationExclude = [
  "**/node_modules/**",
  "**/.next/**",
  "**/.next-probe-r5/**",
  "**/.next-probe-litellm/**",
  "tools/**",
];

export default defineConfig({
  test: {
    // Coverage is measured, not enforced: no thresholds until a baseline is
    // recorded (docs/guides/testing.md — Coverage).
    coverage: {
      provider: "v8",
      include: [
        "apps/dashboard/{app,components,hooks,lib}/**",
        "apps/dashboard/{auth,env,proxy,instrumentation}.ts",
        "packages/shared/src/**",
        "infra/{bin,lib}/**",
        "scripts/**",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/__tests__/**",
        "**/*.d.ts",
        "apps/dashboard/test/**",
        "apps/dashboard/e2e/**",
        "**/.next/**",
        "**/cdk.out/**",
        "**/node_modules/**",
      ],
      reporter: ["text", "html", "lcov"],
    },
    projects: [
      {
        plugins: [react()],
        resolve,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./apps/dashboard/test/setup/vitest.setup.ts"],
          ...isolation,
          // Components import the t3-env object; tests don't carry real
          // secrets, so skip its build-time validation (the schema itself is
          // covered elsewhere).
          env: { SKIP_ENV_VALIDATION: "true" },
          // `.spec.` is Playwright's suffix (apps/dashboard/e2e/), never Vitest's.
          include: [
            "apps/**/*.test.{ts,tsx}",
            "packages/**/*.test.{ts,tsx}",
            "scripts/**/*.test.ts",
          ],
          exclude: [
            "**/*.integration.test.{ts,tsx}",
            "**/node_modules/**",
            "**/.next/**",
            "**/.next-probe-r5/**",
            "**/.next-probe-litellm/**",
            "**/cdk.out/**",
            "**/e2e/**",
            "tools/**",
          ],
        },
      },
      {
        // JSX transform so an integration test can import a Server Component
        // page (app/dashboard/page.integration.test.ts, Phase 4R.5).
        plugins: [react()],
        resolve,
        test: {
          name: "integration",
          ...integrationTest,
          include: [
            "apps/**/*.integration.test.{ts,tsx}",
            "packages/**/*.integration.test.{ts,tsx}",
            "scripts/**/*.integration.test.ts",
          ],
          exclude: [...integrationExclude, ...SERIAL_INTEGRATION_FILES],
          fileParallelism: true,
          // Vitest needs a separate group for a per-project worker cap; the
          // integration group runs after unit and infra (both keep 0).
          sequence: { groupOrder: 1 },
          // Cap for this project only (the unit project keeps the default);
          // lower it rather than raise a timeout (implementation-phases, test speed, D-TS6).
          maxWorkers: 4,
        },
      },
      {
        plugins: [react()],
        resolve,
        test: {
          name: "integration-serial",
          ...integrationTest,
          // Include lists stay literal arrays: probe-structure.test.ts reads
          // them as text (LiteLLM spec LD28).
          include: [
            // A heavy writer (thousands of items): 23 s alone, 31-41 s beside parallel files, and it reaches the 60 s timeout when DynamoDB Local is loaded.
            "scripts/lib/run-seed.integration.test.ts",
          ],
          exclude: integrationExclude,
          fileParallelism: false,
          maxWorkers: 1,
          // After the integration group.
          sequence: { groupOrder: 2 },
        },
      },
      {
        test: {
          name: "infra",
          environment: "node",
          ...isolation,
          include: ["infra/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/cdk.out/**"],
        },
      },
    ],
  },
});
