import { describe, expect, it } from "vitest";

import { API_ERROR_CODES, ApiErrorCodeSchema } from "./api";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)",
// error-code registry: SSO_BOUND (409, the password user is bound to Entra) and
// WEAK_PASSWORD (400). A new code is added to the registry first, so the shared
// enum must carry them for the routes and the test helpers that parse errors.
describe("password error codes", () => {
  it.each(["SSO_BOUND", "WEAK_PASSWORD"])("%s is a registered code", (code) => {
    expect(ApiErrorCodeSchema.parse(code)).toBe(code);
    expect(API_ERROR_CODES).toContain(code);
  });

  it("still rejects an unregistered code", () => {
    expect(ApiErrorCodeSchema.safeParse("INVALID_CREDENTIALS").success).toBe(
      false,
    );
  });
});
