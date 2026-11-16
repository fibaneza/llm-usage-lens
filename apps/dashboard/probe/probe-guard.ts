import { randomBytes } from "node:crypto";

// Source: docs/specs/2026-11-10-litellm.md - "Polish and verification (L5)",
// End-to-end probe (LD28, LD17): the probe runs only with LITELLM_PROBE=1,
// never with APP_ENV=prod, and in real mode only against the host exactly
// localhost:4000. Fake mode is named and explicit; nothing falls back to it
// (Rule 60.24). Messages carry variable names only: never an env value or the
// userinfo of a URL (Rule 50.6). Pure: no I/O, no server-only import.
export type ProbeEnv = Readonly<Record<string, string | undefined>>;
export type ProbeMode = "real" | "fake";

const REAL_HOST = "localhost:4000";
const RUN_ID_PATTERN = /^[a-z0-9]{1,64}$/;

function realBaseUrlHost(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.host;
}

export function assertProbeAllowed(env: ProbeEnv): { mode: ProbeMode } {
  if (env.LITELLM_PROBE !== "1") {
    throw new Error("The LiteLLM probe needs LITELLM_PROBE=1 (opt-in)");
  }
  if (env.APP_ENV === "prod") {
    throw new Error("The LiteLLM probe refuses to run with APP_ENV=prod");
  }
  const requested = env.LITELLM_PROBE_MODE;
  if (requested !== undefined && requested !== "fake" && requested !== "real") {
    throw new Error('LITELLM_PROBE_MODE must be "fake", "real" or unset');
  }
  if (requested === "fake") return { mode: "fake" };
  if (realBaseUrlHost(env.LITELLM_PROBE_BASE_URL) !== REAL_HOST) {
    throw new Error(
      `LITELLM_PROBE_BASE_URL must be http://${REAL_HOST} (no credentials)`,
    );
  }
  return { mode: "real" };
}

// A new id per call, except that the probe config pins one id for the whole
// run in LITELLM_PROBE_RUN_ID: Playwright loads the walk spec in both the
// runner and the worker, and the test titles (which carry the id) must match.
export function probeRunId(): string {
  const pinned = process.env.LITELLM_PROBE_RUN_ID;
  if (pinned !== undefined && RUN_ID_PATTERN.test(pinned)) return pinned;
  return randomBytes(6).toString("hex");
}

export function probeKeyName(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("The probe run id must be lowercase alphanumeric");
  }
  return `llmul-probe-${runId}`;
}
