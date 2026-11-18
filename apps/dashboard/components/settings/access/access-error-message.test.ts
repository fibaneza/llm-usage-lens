import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/query/fetch-api";

import { accessErrorMessage } from "./access-error-message";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// error-code registry; "Identity, SSO mapping and defaults" (MANAGED_BY_SSO:
// change it in Entra); "Membership" (ALREADY_AFFILIATED: use move);
// "Enforcement" item 6 (stale version -> 409: reload); "Password users"
// (SSO_BOUND, WEAK_PASSWORD); "Recent authentication" (REAUTH_REQUIRED).
//
// Module under test: `components/settings/access/access-error-message.ts`
//   accessErrorMessage(error: unknown): string
// Readable, code-driven copy; the server's message text is never required and
// no raw code ("MANAGED_BY_SSO") leaks into the sentence.
const err = (status: number, code: string, message = "server text") =>
  new ApiRequestError(status, code, message);

describe("accessErrorMessage", () => {
  it.each([
    [403, "FORBIDDEN", /permission|not allowed|can't/i],
    [404, "NOT_FOUND", /not found|no longer exists|doesn't exist/i],
    [409, "CONFLICT", /reload/i],
    [409, "MANAGED_BY_SSO", /entra/i],
    [409, "ALREADY_AFFILIATED", /move/i],
    [409, "SSO_BOUND", /(single sign-on|sso|entra)/i],
    [400, "WEAK_PASSWORD", /password/i],
    [403, "REAUTH_REQUIRED", /confirm|sign in again|re-?authenticat/i],
    // INV1, T-INV3: a target holding a global role cannot be bound to an invite.
    [
      409,
      "PRIVILEGED_TARGET",
      /administrator|global role|privileged|cannot be/i,
    ],
  ])("maps %s %s to a readable sentence", (status, code, pattern) => {
    const message = accessErrorMessage(err(status, code));
    expect(message).toMatch(pattern);
    expect(message).not.toContain(code);
  });

  it("tells the user to reload on a stale version (CONFLICT)", () => {
    expect(accessErrorMessage(err(409, "CONFLICT"))).toMatch(/reload/i);
  });

  it("gives every mapped code a distinct message", () => {
    const codes = [
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "MANAGED_BY_SSO",
      "ALREADY_AFFILIATED",
      "SSO_BOUND",
      "WEAK_PASSWORD",
      "REAUTH_REQUIRED",
      "PRIVILEGED_TARGET",
    ];
    const messages = codes.map((c) => accessErrorMessage(err(409, c)));
    expect(new Set(messages).size).toBe(codes.length);
  });

  it("falls back to the server message for an unmapped code", () => {
    expect(accessErrorMessage(err(400, "BAD_REQUEST", "Invalid email"))).toBe(
      "Invalid email",
    );
  });

  it("uses a generic retry message for a network or unknown error", () => {
    expect(accessErrorMessage(new TypeError("fetch failed"))).toMatch(
      /try again/i,
    );
    expect(accessErrorMessage("boom")).toMatch(/try again/i);
    expect(accessErrorMessage(null)).toMatch(/try again/i);
  });
});
