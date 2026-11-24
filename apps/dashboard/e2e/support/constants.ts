export const E2E_PORT = 3211;

// CI runs the suite against production builds (`next build` + `next start`)
// instead of `next dev` (.github/ACTIONS.md — e2e job); local runs keep
// `next dev`. Production refuses the dev-only login (auth guide — Dev-only
// local login), so specs that need it skip under production servers and run
// in the CI e2e-dev job, which sets E2E_SERVERS=dev.
// Unit-tested in scripts/e2e-assert-count.test.ts (the Vitest unit project
// excludes e2e/).
export function productionServers(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return !!env.CI && env.E2E_SERVERS !== "dev";
}
export const E2E_PRODUCTION_SERVERS = productionServers(process.env);
// Every `next dev` run (local or CI e2e-dev) warms the cold routes before the
// first test: e2e/support/warm-up.ts compiles /sign-in, /dashboard and the
// role-probe pages. Cold on-demand compilation (about 3 s a route with the
// workers compiling at once) made role-landing:232 and settings-tabs:129 fail
// (2026-11-24; docs/guides/testing.md — E2E dev-server warm-up). Production servers (CI e2e job,
// E2E_SERVERS unset) compile nothing on request and never warm up.
export function devServerWarmUp(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return !productionServers(env);
}
export const DEV_LOGIN_ONLY_REASON =
  "the dev-only login is refused by production builds; the CI e2e-dev job and local next dev runs cover it";
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

// Unit BP (Platform spec - Base path; docs/guides/testing.md - Prefixed e2e
// project): the app served under /llm-lens by its own production server (built
// with NEXT_PUBLIC_BASE_PATH), port 3214 (3211 main, 3212 fake LiteLLM, 3213
// role probe), its own distDir. AUTH_URL is origin-only (BP-D9).
export const E2E_BASE_PATH = "/llm-lens";
export const E2E_PREFIX_PORT = 3214;
export const E2E_PREFIX_ORIGIN = `http://127.0.0.1:${E2E_PREFIX_PORT}`;
export const E2E_PREFIX_DIST_DIR = ".next-base-path";
// The prefixed project (and its extra production build) exists only when
// asked for: E2E_BASE_PATH_PROJECT=1, or a CLI argument naming it
// (`--project=base-path`, `e2e/base-path`). Keeps the E2E budget (Rule 70.12)
// for every other run; the green gate runs it once.
export function basePathProjectRequested(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  // argv[0..1] are node and the CLI script, whose path may contain anything.
  return (
    env.E2E_BASE_PATH_PROJECT === "1" ||
    argv.slice(2).some((arg) => arg.includes("base-path"))
  );
}
