import { defineConfig, devices } from "@playwright/test";

import { E2E_AUTH_SECRET } from "../e2e/support/constants";

import { assertProbeAllowed, probeRunId } from "./probe-guard";
import {
  FAKE_DASHBOARD_TEAM_ID,
  FAKE_LITELLM_BASE_URL,
  FAKE_LITELLM_HOST,
  FAKE_LITELLM_SERVICE_KEY,
  PROBE_BASE_URL,
  PROBE_DIST_DIR,
  PROBE_PORT,
  PROBE_TABLE,
} from "./probe-constants";

// Source: docs/specs/2026-11-10-litellm.md - "Polish and verification (L5)",
// End-to-end probe (LD28): its own Playwright config behind `pnpm
// probe:litellm` / `pnpm probe:litellm:fake`, never part of `pnpm test:e2e`,
// `pnpm check` or CI. The guard runs first: a refusal throws before any server
// starts. Headless only (Rule 70.11), one worker, its own port and dist dir.
// The probe shares the e2e table (the identity seed writes there), so the
// package script takes the same lock as `pnpm test:e2e` (scripts/e2e-lock.mjs).
const { mode } = assertProbeAllowed(process.env);

// One run id for the runner and its worker (see probeRunId).
process.env.LITELLM_PROBE_RUN_ID ??= probeRunId();

if (mode === "fake") {
  // The walk sends its chat requests to this URL; the fake mode owns it.
  process.env.LITELLM_PROBE_BASE_URL = FAKE_LITELLM_BASE_URL;
  process.env.LITELLM_PROBE_TEAM ??= FAKE_DASHBOARD_TEAM_ID;
}

export default defineConfig({
  testDir: ".",
  testMatch: "litellm-probe.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  globalSetup: mode === "fake" ? "./fake-setup.ts" : undefined,
  outputDir: "../test-results",
  use: {
    baseURL: PROBE_BASE_URL,
    headless: true,
    ...devices["Desktop Chrome"],
  },
  webServer: [
    ...(mode === "fake"
      ? [
          {
            command: "node --import tsx fake-litellm-probe-server.ts",
            url: `${FAKE_LITELLM_BASE_URL}/team/list`,
            reuseExistingServer: false,
            timeout: 30_000,
            env: { PROBE_FAKE_SERVICE_KEY: FAKE_LITELLM_SERVICE_KEY },
          },
        ]
      : []),
    {
      command: `pnpm exec next dev --port ${PROBE_PORT}`,
      url: PROBE_BASE_URL,
      cwd: "..",
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // Process env beats Next's .env loading: pin what the forged session
        // needs, as playwright.config.ts does for the e2e servers.
        AUTH_URL: PROBE_BASE_URL,
        AUTH_MICROSOFT_ENTRA_ID_ID: "",
        AUTH_MICROSOFT_ENTRA_ID_SECRET: "",
        AUTH_MICROSOFT_ENTRA_ID_ISSUER: "",
        AWS_REGION: "us-east-1",
        AWS_PROFILE: "",
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
        SKIP_ENV_VALIDATION: "1",
        AUTH_DEV_LOGIN: "true",
        APP_ENV: "dev",
        AUTH_SECRET: E2E_AUTH_SECRET,
        NEXT_PUBLIC_APP_URL: PROBE_BASE_URL,
        NEXT_PUBLIC_ORG_NAME: "Organization",
        DYNAMODB_TABLE_NAME: PROBE_TABLE,
        DYNAMODB_ENDPOINT: "http://localhost:8000",
        NEXT_DIST_DIR: PROBE_DIST_DIR,
        // Real mode: the service key stays in apps/dashboard/.env.local and is
        // not set here; the stored connection must point at localhost:4000.
        LITELLM_ALLOWED_HOSTS:
          mode === "fake" ? FAKE_LITELLM_HOST : "localhost:4000",
        ...(mode === "fake"
          ? { LITELLM_SERVICE_KEY: FAKE_LITELLM_SERVICE_KEY }
          : {}),
      },
    },
  ],
});
