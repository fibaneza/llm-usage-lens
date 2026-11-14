import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" items 5
// and 7 (LITELLM_SERVICE_KEY server-only, optional, never NEXT_PUBLIC_*;
// LITELLM_ALLOWED_HOSTS host or host:port), LD17 (.env.example documents
// localhost:4000, key empty); implementation-phases L1 task 1; Rule 50.2.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

function stub(extra: Record<string, string>) {
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
    LITELLM_SERVICE_KEY: "",
    LITELLM_ALLOWED_HOSTS: "",
    ...extra,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.stubGlobal("window", undefined);
}

describe("env.ts LiteLLM variables", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("treats a missing service key as not configured (undefined), without failing validation", async () => {
    stub({});
    const { env } = await import("@/env");
    expect(env.LITELLM_SERVICE_KEY).toBeUndefined();
    expect(env.LITELLM_ALLOWED_HOSTS).toBeUndefined();
  });

  it("passes a configured key and allowed hosts through", async () => {
    stub({
      LITELLM_SERVICE_KEY: "sk-fake-000",
      LITELLM_ALLOWED_HOSTS: "localhost:4000,litellm.example.internal",
    });
    const { env } = await import("@/env");
    expect(env.LITELLM_SERVICE_KEY).toBe("sk-fake-000");
    expect(env.LITELLM_ALLOWED_HOSTS).toBe(
      "localhost:4000,litellm.example.internal",
    );
  });

  it("does not expose the service key through the client schema", () => {
    const src = readFileSync(join(HERE, "env.ts"), "utf8");
    expect(src).not.toMatch(/NEXT_PUBLIC_LITELLM/);
    const client = /client:\s*\{[\s\S]*?\n {2}\},/.exec(src)?.[0] ?? "";
    expect(client).not.toContain("LITELLM");
    expect(src).toContain("LITELLM_SERVICE_KEY");
    expect(src).toContain("LITELLM_ALLOWED_HOSTS");
  });
});

describe("LiteLLM configuration files", () => {
  it(".env.example documents the local connection with an empty key (LD17)", () => {
    const example = readFileSync(join(HERE, ".env.example"), "utf8");
    expect(example).toMatch(/^LITELLM_ALLOWED_HOSTS=localhost:4000\s*$/m);
    expect(example).toMatch(/^LITELLM_SERVICE_KEY=\s*$/m);
    expect(example).not.toMatch(/NEXT_PUBLIC_LITELLM/);
    expect(example).not.toMatch(/LITELLM_MASTER/);
  });

  it("build:ci passes a LITELLM_ALLOWED_HOSTS placeholder and only the known non-secret sentinel as the key", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const buildCi = pkg.scripts["build:ci"] ?? "";
    expect(buildCi).toMatch(/LITELLM_ALLOWED_HOSTS=\S+/);
    // LT1: the bundle scan (lib/litellm/bundle-output.test.ts) greps for this
    // exact sentinel, so it must be set; any other value could be a real key.
    const keys = [...buildCi.matchAll(/LITELLM_SERVICE_KEY=(\S*)/g)].map(
      (m) => m[1],
    );
    expect(keys).toEqual(["sk-ci-build-sentinel"]);
  });
});
