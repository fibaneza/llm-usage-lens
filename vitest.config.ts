import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Root Vitest config scoping the suite to the dashboard workspace (apps +
// packages + scripts + infra) and keeping the standalone simulator out. Three
// projects (docs/guides/testing.md):
//  - `unit`: jsdom + React Testing Library; needs no external services.
//  - `integration`: node, `*.integration.test.{ts,tsx}` against DynamoDB Local
//    (localhost:8000; Rule 60.22). Files run serially because they share one
//    table, named per run so concurrent runs (e.g. several worktrees) against
//    the same DynamoDB Local never clear each other's data; the global setup
//    deletes it afterwards.
//  - `infra`: node, the CDK stack tests in `infra/` (no DOM, no setup file).
// The pre-push hook runs `unit` and `infra`; CI and `pnpm test` run all three.
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
          environment: "node",
          ...isolation,
          include: [
            "apps/**/*.integration.test.{ts,tsx}",
            "packages/**/*.integration.test.{ts,tsx}",
            "scripts/**/*.integration.test.ts",
          ],
          exclude: [
            "**/node_modules/**",
            "**/.next/**",
            "**/.next-probe-r5/**",
            "**/.next-probe-litellm/**",
            "tools/**",
          ],
          fileParallelism: false,
          globalSetup: [
            "./apps/dashboard/test/setup/integration-global-setup.ts",
          ],
          // Seed-reset tests write and delete thousands of items against
          // DynamoDB Local; the 5s default times out on CI runners.
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // DynamoDB Local settings; no credentials are set here.
          env: {
            DYNAMODB_ENDPOINT:
              process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
            AWS_REGION: "us-east-1",
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
