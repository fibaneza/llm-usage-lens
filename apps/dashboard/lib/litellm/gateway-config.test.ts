// @vitest-environment node
import { fileURLToPath } from "node:url";

import { LiteLLMGatewayConfigSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-05-15-system-architecture.md — "Configuration file"
// (The checked-in file; A8: `loadGatewayConfig()` keeps its signature and
// reads the `litellm.operations` branch from the new loader; the JSON file and
// its import are deleted), docs/specs/2026-11-10-litellm.md — "Guardrail
// configuration" (LD19). Callers (operations.ts, read-views.ts, the toggles
// route) and other units' tests import `loadGatewayConfig` unchanged.
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../test/fixtures/config/${name}`, import.meta.url));

async function loadWith(file: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_CONFIG_FILE", file);
  return (await import("./gateway-config")).loadGatewayConfig();
}

describe("loadGatewayConfig (stable signature, A8)", () => {
  it("returns the checked-in defaults when APP_CONFIG_FILE is unset", async () => {
    const config = await loadWith(undefined);
    // A16 / B1-B2: the shipped file sets no operation; LD10 stays the default.
    expect(config).toEqual({ operations: {} });
    expect(LiteLLMGatewayConfigSchema.safeParse(config).success).toBe(true);
  });

  it("returns the operations of the file named by APP_CONFIG_FILE", async () => {
    expect(await loadWith(fixture("locks-create-team.yaml"))).toEqual({
      operations: { createTeam: { enabled: false } },
    });
  });

  it("returns an empty operations map when the file sets none (callers read .operations)", async () => {
    expect(await loadWith(fixture("empty.yaml"))).toEqual({ operations: {} });
  });
});
