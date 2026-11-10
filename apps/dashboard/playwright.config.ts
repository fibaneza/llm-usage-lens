import { defineConfig, devices } from "@playwright/test";

import {
  E2E_AUTH_SECRET,
  E2E_BASE_URL,
  E2E_PORT,
} from "./e2e/support/constants";

// Headless Playwright E2E for the dashboard. The devcontainer has no display
// server, so headless is forced — never pass --headed or --ui here. Smoke
// specs accrue with UI work through the agent loop (Rule 70); the full Phase 5
// journeys build on the same harness (implementation-phases spec — Phase 5).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // No auto-opened HTML report — there is no browser to open it in.
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    // Dedicated port so a developer's `pnpm dev` on 3000 (and the observability
    // stack on 3001/3100/9090) is never reused with the wrong env.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Process env beats Next's .env loading, so pin every var the suite
      // depends on: a developer's gitignored .env/.env.local must not leak in.
      AUTH_URL: E2E_BASE_URL,
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
      NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
      // SKIP_ENV_VALIDATION bypasses the schema default, so server and client
      // would render different sidebar text and fail hydration.
      NEXT_PUBLIC_ORG_NAME: "Organization",
      DYNAMODB_TABLE_NAME: "bedrock-usage",
      DYNAMODB_ENDPOINT: "http://localhost:8000",
    },
  },
});
