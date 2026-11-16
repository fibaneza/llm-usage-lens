import { defineConfig, devices } from "@playwright/test";

import {
  E2E_AUTH_SECRET,
  E2E_BASE_URL,
  E2E_LITELLM_HOST,
  E2E_LITELLM_PORT,
  E2E_LITELLM_SERVICE_KEY,
  E2E_PORT,
  E2E_PROBE_BASE_URL,
  E2E_PROBE_DIST_DIR,
  E2E_PROBE_PORT,
  E2E_PROBE_TABLE,
  E2E_TABLE,
} from "./e2e/support/constants";

// The 4R.5 role probe (e2e/role-landing.spec.ts; Phase 4R.5 Verify: "e2e per
// role; seeded probe per role") is its own Playwright project in the normal
// run. It needs its own DynamoDB Local table (bedrock-usage-probe-r5, seeded
// idempotently by test/role-probe-seed.ts), and one dev server has one table,
// so it gets a second dev server on its own port with a distinct distDir
// (two `next dev` in one directory otherwise collide on .next). Select it with
// `--project=role-probe`; the default chromium project ignores the spec.
const PROBE_SPEC = /role-landing\.spec\.ts$/;

// Headless Playwright E2E for the dashboard. The devcontainer has no display
// server, so headless is forced — never pass --headed or --ui here. Smoke
// specs accrue with UI work through the agent loop (Rule 70); the full Phase 5
// journeys build on the same harness (implementation-phases spec — Phase 5).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  // No auto-opened HTML report — there is no browser to open it in.
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ...(process.env.CI ? ([["github"]] as const) : []),
  ],
  // First dev-server compile of a route can be slow; keep generous timeouts
  // rather than flaky wall-clock sleeps (Rule 60.24).
  timeout: 60_000,
  outputDir: "test-results",
  use: {
    baseURL: E2E_BASE_URL,
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: PROBE_SPEC,
    },
    {
      name: "role-probe",
      use: { ...devices["Desktop Chrome"], baseURL: E2E_PROBE_BASE_URL },
      testMatch: PROBE_SPEC,
    },
  ],
  webServer: [
    {
      // L3c: the dashboard calls LiteLLM server-side, so the dev-login spec
      // needs a real HTTP fake (page.route cannot see that call).
      command: "node e2e/support/fake-litellm-server.mjs",
      url: `http://${E2E_LITELLM_HOST}/team/list`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        E2E_LITELLM_PORT: String(E2E_LITELLM_PORT),
        E2E_LITELLM_SERVICE_KEY,
      },
    },
    devServer({ port: E2E_PORT, baseUrl: E2E_BASE_URL, table: E2E_TABLE }),
    devServer({
      port: E2E_PROBE_PORT,
      baseUrl: E2E_PROBE_BASE_URL,
      table: E2E_PROBE_TABLE,
      distDir: E2E_PROBE_DIST_DIR,
    }),
  ],
});

function devServer({
  port,
  baseUrl,
  table,
  distDir,
}: {
  port: number;
  baseUrl: string;
  table: string;
  distDir?: string;
}) {
  return {
    command: `pnpm exec next dev --port ${port}`,
    url: baseUrl,
    // Dedicated ports so a developer's `pnpm dev` on 3000 (and the observability
    // stack on 3001/3100/9090) is never reused with the wrong env.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Process env beats Next's .env loading, so pin every var the suite
      // depends on: a developer's gitignored .env/.env.local must not leak in.
      AUTH_URL: baseUrl,
      AUTH_MICROSOFT_ENTRA_ID_ID: "",
      AUTH_MICROSOFT_ENTRA_ID_SECRET: "",
      AUTH_MICROSOFT_ENTRA_ID_ISSUER: "",
      AWS_REGION: "us-east-1",
      AWS_PROFILE: "",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
      // Real Entra ID secrets are absent in E2E; skip t3-env validation the
      // same way the vitest suite does (see vitest.config.ts).
      SKIP_ENV_VALIDATION: "1",
      // Dev-only local login (auth guide); no Entra vars are set in E2E.
      AUTH_DEV_LOGIN: "true",
      APP_ENV: "dev",
      // The session-forging helper signs JWTs with this same value — the
      // Auth.js proxy and authorized() callback run unchanged (no bypass).
      AUTH_SECRET: E2E_AUTH_SECRET,
      NEXT_PUBLIC_APP_URL: baseUrl,
      // SKIP_ENV_VALIDATION bypasses the schema default, so server and client
      // would render different sidebar text and fail hydration.
      NEXT_PUBLIC_ORG_NAME: "Organization",
      DYNAMODB_TABLE_NAME: table,
      DYNAMODB_ENDPOINT: "http://localhost:8000",
      // L3c: the server-side LiteLLM calls reach the fake above.
      LITELLM_SERVICE_KEY: E2E_LITELLM_SERVICE_KEY,
      LITELLM_ALLOWED_HOSTS: E2E_LITELLM_HOST,
      ...(distDir === undefined ? {} : { NEXT_DIST_DIR: distDir }),
    },
  };
}
