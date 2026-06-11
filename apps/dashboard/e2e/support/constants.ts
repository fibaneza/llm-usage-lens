export const E2E_PORT = 3211;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// Signing key for the throwaway E2E dev server only — a fixed, public test
// constant, not a credential (Rule 50.1 concerns real AWS/Entra secrets).
// playwright.config.ts injects it as AUTH_SECRET; session.ts signs the forged
// session cookie with it so real Auth.js JWT verification still runs.
export const E2E_AUTH_SECRET = "bedrock-dashboard-e2e-session-signing-key";
