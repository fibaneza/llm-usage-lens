export const E2E_PORT = 3211;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// Signing key for the throwaway E2E dev server only — a fixed, public test
// constant, not a credential (Rule 50.1 concerns real AWS/Entra secrets).
// playwright.config.ts injects it as AUTH_SECRET; session.ts signs the forged
// session cookie with it so real Auth.js JWT verification still runs.
export const E2E_AUTH_SECRET = "llm-usage-lens-e2e-session-signing-key";

// Standalone fake LiteLLM proxy for the L3c dev-login spec
// (support/fake-litellm-server.mjs). The dashboard calls LiteLLM from the
// server, so page.route cannot intercept it; playwright.config.ts starts this
// server and allow-lists its host for the dev server (LITELLM_ALLOWED_HOSTS).
export const E2E_LITELLM_PORT = 3212;
export const E2E_LITELLM_HOST = `127.0.0.1:${E2E_LITELLM_PORT}`;
export const E2E_LITELLM_BASE_URL = `http://${E2E_LITELLM_HOST}`;
// Fixed, public test constant for the throwaway servers only; not a credential.
export const E2E_LITELLM_SERVICE_KEY = "sk-e2e-fake-litellm-service-key";
export const E2E_LITELLM_USER = {
  userId: "litellm-u-ada",
  email: "ada.lovelace@example.test",
  spend: 42.5,
};

// Role probe project (e2e/role-landing.spec.ts, Phase 4R.5 Verify "seeded probe
// per role"): a second dev server on its own port, table and distDir, so the
// probe's seed never touches the shared bedrock-usage table and two
// `next dev` processes do not share .next. 3212 is the fake LiteLLM above.
export const E2E_TABLE = "bedrock-usage";
export const E2E_PROBE_PORT = 3213;
export const E2E_PROBE_BASE_URL = `http://127.0.0.1:${E2E_PROBE_PORT}`;
export const E2E_PROBE_TABLE = "bedrock-usage-probe-r5";
export const E2E_PROBE_DIST_DIR = ".next-probe-r5";
