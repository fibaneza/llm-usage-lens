import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md — Audit log (CloudWatch
// copy); contract R2 decision 12: AUDIT_LOG_GROUP_NAME is optional (unset
// means skip delivery).
function stub(auditLogGroup: string) {
  const vars: Record<string, string> = {
    SKIP_ENV_VALIDATION: "",
    AUTH_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PHASE: "",
    NODE_ENV: "development",
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "",
    AUTH_DEV_LOGIN: "true",
    AUTH_MICROSOFT_ENTRA_ID_ID: "",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: "",
    AUTH_MASTER_USERNAME: "",
    AUTH_MASTER_PASSWORD_HASH: "",
    AUTH_MASTER_TOTP_SECRET: "",
    AUDIT_LOG_GROUP_NAME: auditLogGroup,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.stubGlobal("window", undefined);
}

describe("env.ts AUDIT_LOG_GROUP_NAME", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is optional: unset yields undefined", async () => {
    stub("");
    const { env } = await import("@/env");
    expect(env.AUDIT_LOG_GROUP_NAME).toBeUndefined();
  });

  it("passes a configured log group name through", async () => {
    stub("/llm-usage-lens/dev/audit");
    const { env } = await import("@/env");
    expect(env.AUDIT_LOG_GROUP_NAME).toBe("/llm-usage-lens/dev/audit");
  });
});
