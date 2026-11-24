import { afterEach, describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-litellm.md - the LW1 paragraph after
// `createUser` ("SSO enabled" means `AUTH_MICROSOFT_ENTRA_ID_ID` is set; one
// function in `lib/auth/` answers it); Access Control - "Create and link only
// without SSO". Module under test: `lib/auth/sso-mode.ts`, `isSsoEnabled()`.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function isSsoEnabled(clientId: string | undefined): Promise<boolean> {
  vi.resetModules();
  if (clientId === undefined) vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ID", "");
  else vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ID", clientId);
  return (await import("./sso-mode")).isSsoEnabled();
}

describe("isSsoEnabled (LiteLLM spec - LW1)", () => {
  it("is true when AUTH_MICROSOFT_ENTRA_ID_ID is set", async () => {
    expect(await isSsoEnabled("00000000-0000-4000-8000-000000000001")).toBe(
      true,
    );
  });

  it("is false when the variable is unset or empty", async () => {
    expect(await isSsoEnabled(undefined)).toBe(false);
    expect(await isSsoEnabled("")).toBe(false);
  });
});
