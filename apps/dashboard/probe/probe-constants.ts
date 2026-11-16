// Fixed ports and fixtures of the LiteLLM probe's own servers (LD28). 3211 is
// the e2e app, 3212 its fake LiteLLM, 3213 the role-probe app, 3000 `pnpm dev`:
// the probe uses 3311 and 3312 so it never reuses a server with the wrong env.
export const PROBE_PORT = 3311;
export const PROBE_BASE_URL = `http://127.0.0.1:${PROBE_PORT}`;
// The role-probe project's dist dir, already ignored by git, ESLint, Prettier
// and Vitest; the shared e2e lock keeps the two from running at once.
export const PROBE_DIST_DIR = ".next-probe-litellm";
// The shared e2e table: the identity seed (test/fixtures/e2e-identity-seed.ts)
// writes there, so the probe's server reads it too.
export const PROBE_TABLE = "bedrock-usage";

export const FAKE_LITELLM_PORT = 3312;
export const FAKE_LITELLM_HOST = `127.0.0.1:${FAKE_LITELLM_PORT}`;
export const FAKE_LITELLM_BASE_URL = `http://${FAKE_LITELLM_HOST}`;
// Fixed public test constant for the throwaway fake only; not a credential.
export const FAKE_LITELLM_SERVICE_KEY = "sk-probe-fake-litellm-service-key";
export const FAKE_LITELLM_TEAM_ID = "11111111-1111-4111-8111-0000000000f5";

// Fake mode only: the dashboard team the setup creates and links to the fake
// LiteLLM team (the walk's default LITELLM_PROBE_TEAM).
export const FAKE_DASHBOARD_TEAM_ID = "team-probe";
// A distinct fixture account, built so no 12-digit literal sits in tracked
// text (Rule 50.9); it is never a real AWS account.
export const FAKE_ACCOUNT_ID = `${"0".repeat(11)}7`;
// Fixed admin oid of the setup/teardown calls; the walk uses 0b0001-0b0004.
export const SETUP_ADMIN_OID = "00000000-0000-4000-8000-0000000b00f0";
