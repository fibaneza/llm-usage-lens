import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Root Vitest config scoping the suite to the dashboard workspace (apps +
// packages + scripts) and keeping the standalone simulator out. Two projects:
//  - `unit`: jsdom + React Testing Library; needs no external services, so the
//    pre-push hook runs only this one.
//  - `integration`: node, `*.integration.test.ts` against DynamoDB Local
//    (localhost:8000; Rule 60.22). Files run serially because they share one
//    table, named per run so concurrent runs (e.g. several worktrees) against
//    the same DynamoDB Local never clear each other's data; the global setup
//    deletes it afterwards. CI and `pnpm test` run both projects.
const alias = {
  // Mirror the dashboard tsconfig "@/*" path alias.
  "@": fileURLToPath(new URL("./apps/dashboard", import.meta.url)),
};
const integrationTableName = `bedrock-usage-test-${process.pid}`;

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./apps/dashboard/vitest.setup.ts"],
          // Components import the t3-env object; tests don't carry real
          // secrets, so skip its build-time validation (the schema itself is
          // covered elsewhere).
          env: { SKIP_ENV_VALIDATION: "true" },
          include: [
            "apps/**/*.{test,spec}.{ts,tsx}",
            "packages/**/*.{test,spec}.{ts,tsx}",
            "scripts/**/*.test.ts",
            "infra/**/*.test.ts",
          ],
          // e2e/ holds Playwright specs — same .spec.ts suffix, but they run
          // under `playwright test`, never under Vitest.
          exclude: [
            "**/*.integration.test.ts",
            "**/node_modules/**",
            "**/.next/**",
            "**/cdk.out/**",
            "**/e2e/**",
            "tools/**",
          ],
        },
      },
      {
        resolve: {
          alias: {
            ...alias,
            // `server-only` throws outside a React Server Components build.
            "server-only": fileURLToPath(
              new URL(
                "./apps/dashboard/test/server-only-stub.ts",
                import.meta.url,
              ),
            ),
          },
        },
        test: {
          name: "integration",
          environment: "node",
          include: [
            "apps/**/*.integration.test.ts",
            "packages/**/*.integration.test.ts",
            "scripts/**/*.integration.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/.next/**", "tools/**"],
          fileParallelism: false,
          globalSetup: ["./apps/dashboard/test/integration-global-setup.ts"],
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
          },
        },
      },
    ],
  },
});
