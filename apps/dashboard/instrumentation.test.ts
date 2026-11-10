import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Rule 50.2 / 60.19 — env vars are read through `@/env`
// (@t3-oss/env-nextjs), never raw `process.env` in app code; security review
// 2026-11-11 (L9). `env.OTEL_SERVICE_NAME` defaults to "llm-usage-lens".
const registerOTel = vi.hoisted(() => vi.fn());
vi.mock("@vercel/otel", () => ({ registerOTel }));
vi.mock("@/env", () => ({
  env: { OTEL_SERVICE_NAME: "service-from-env-module" },
}));

import { register } from "./instrumentation";

afterEach(() => {
  registerOTel.mockReset();
  vi.unstubAllEnvs();
});

describe("instrumentation register()", () => {
  it("passes env.OTEL_SERVICE_NAME from @/env to registerOTel", () => {
    register();
    expect(registerOTel).toHaveBeenCalledOnce();
    expect(registerOTel).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "service-from-env-module" }),
    );
  });

  it("does not read the raw process.env value", () => {
    vi.stubEnv("OTEL_SERVICE_NAME", "raw-process-env-value");
    register();
    expect(registerOTel).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "service-from-env-module" }),
    );
  });
});
