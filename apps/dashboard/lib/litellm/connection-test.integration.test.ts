import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLiteLLM, healthyHandler } from "@/test/fakes/fake-litellm";

// Source: docs/specs/2026-11-10-litellm.md — "Gateway guardrails" item 6
// ("The connection test reports 'service key uses temporary wildcards
// (`/team/*`, `/key/*`)' as a warning on the Settings -> LiteLLM panel while
// either wildcard is present"), "Guardrail configuration" (amended 2026-11-15:
// the warning is code-only, never in the config file, always reported), decision LD4, threat LT3; the probes
// still run through the single choke point (item 1).
//
// Contract: ConnectionTestResult gains `warnings: string[]` (empty when none).
const BASE = "http://litellm.test:4000";
let fake: ReturnType<typeof createFakeLiteLLM>;

async function load(opts: {
  allowedRoutes?: string[];
  fileOperations?: Record<string, { enabled: false }>;
}) {
  vi.resetModules();
  vi.doUnmock("@/lib/litellm/allowlist");
  vi.doUnmock("@/lib/litellm/gateway-config");
  if (opts.allowedRoutes) {
    vi.doMock("@/lib/litellm/allowlist", async (importActual) => ({
      ...(await importActual<typeof import("./allowlist")>()),
      LITELLM_SERVICE_KEY_ALLOWED_ROUTES: opts.allowedRoutes,
    }));
  }
  if (opts.fileOperations !== undefined) {
    vi.doMock("@/lib/litellm/gateway-config", () => ({
      loadGatewayConfig: () => ({ operations: opts.fileOperations }),
    }));
  }
  vi.stubEnv("APP_ENV", "dev");
  vi.stubEnv("LITELLM_ALLOWED_HOSTS", "litellm.test:4000");
  vi.stubEnv("LITELLM_SERVICE_KEY", "sk-fake-key-000");
  return import("./connection-test");
}

beforeEach(() => {
  fake = createFakeLiteLLM(healthyHandler);
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(() => {
  vi.doUnmock("@/lib/litellm/allowlist");
  vi.doUnmock("@/lib/litellm/gateway-config");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NO_WILDCARDS = ["/team/new", "/team/info", "/key/generate"];

describe("testLiteLLMConnection — temporary wildcard warning (LD4, LT3)", () => {
  it("reports a warning naming /team/* and /key/* while the key carries them, and the result stays ok", async () => {
    const { testLiteLLMConnection } = await load({});
    const r = await testLiteLLMConnection(BASE);
    expect(r.result).toBe("ok");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/temporary wildcards/i);
    expect(r.warnings[0]).toContain("/team/*");
    expect(r.warnings[0]).toContain("/key/*");
  });

  it("still warns while only one of the two wildcards is present", async () => {
    const { testLiteLLMConnection } = await load({
      allowedRoutes: [...NO_WILDCARDS, "/key/*"],
    });
    const r = await testLiteLLMConnection(BASE);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("/key/*");
  });

  it("reports no warning once neither wildcard is present", async () => {
    const { testLiteLLMConnection } = await load({
      allowedRoutes: NO_WILDCARDS,
    });
    const r = await testLiteLLMConnection(BASE);
    expect(r.result).toBe("ok");
    expect(r.warnings).toEqual([]);
  });

  it("always reports the warning: it is code-only and no config file content switches it off", async () => {
    const { testLiteLLMConnection } = await load({ fileOperations: {} });
    const r = await testLiteLLMConnection(BASE);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("/team/*");
  });

  it("the probes (including listProxyTeams) ignore read toggles: a disabled read never breaks the check", async () => {
    const { testLiteLLMConnection } = await load({
      fileOperations: {
        listProxyTeams: { enabled: false },
        getTeam: { enabled: false },
        getUser: { enabled: false },
        listKeys: { enabled: false },
      },
    });
    const r = await testLiteLLMConnection(BASE);
    expect(r.result).toBe("ok");
    expect(fake.calls[0]?.path).toBe("/team/list");
  });

  it("the warning is also present when the test is not ok (unreachable)", async () => {
    fake.setHandler(() => "network-error");
    const { testLiteLLMConnection } = await load({});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = testLiteLLMConnection(BASE);
    for (let i = 0; i < 50; i += 1) {
      await vi.advanceTimersByTimeAsync(250);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const r = await pending;
    vi.useRealTimers();
    expect(r.result).toBe("unreachable");
    expect(r.warnings.join(" ")).toContain("/team/*");
  });

  it("every probe goes through the choke point: only allowlisted method + template routes are sent", async () => {
    const { testLiteLLMConnection } = await load({});
    await testLiteLLMConnection(BASE);
    const sent = fake.calls.map((c) => `${c.method} ${c.path}`);
    expect(sent[0]).toBe("GET /team/list");
    for (const s of sent.slice(1)) {
      expect(s).toMatch(
        /^POST \/team\/[^/]+\/member\/[^/]+\/(reset_spend|reset_budget)$/,
      );
    }
  });
});
