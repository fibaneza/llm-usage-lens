import { describe, expect, it } from "vitest";

import { parseSessionToken } from "@/lib/auth/session-token";

// Source: docs/specs/2026-11-10-access-control.md — Threat model T1/T8
// (fail closed on a malformed token); contract R2 §3 `parseSessionToken` and
// §6 carry-ins: a token missing `oid` or `authMethod` is rejected.
const valid = {
  oid: "00000000-0000-4000-8000-000000000001",
  tid: "00000000-0000-4000-8000-000000000002",
  roles: ["internal-viewer"],
  authMethod: "entra",
};

describe("parseSessionToken", () => {
  it("returns the claims of a valid token", () => {
    expect(parseSessionToken(valid)).toEqual(valid);
  });

  it("accepts each auth method", () => {
    for (const authMethod of ["entra", "master", "local"]) {
      expect(parseSessionToken({ ...valid, authMethod })).not.toBeNull();
    }
  });

  it("ignores unrelated JWT fields", () => {
    expect(parseSessionToken({ ...valid, sub: "x", exp: 1 })).toEqual(valid);
  });

  it.each([
    ["missing oid", { oid: undefined }],
    ["empty oid", { oid: "" }],
    ["non-string oid", { oid: 7 }],
    ["missing authMethod", { authMethod: undefined }],
    ["unknown authMethod", { authMethod: "saml" }],
    ["missing tid", { tid: undefined }],
    ["non-array roles", { roles: "internal-admin" }],
    ["non-string role entries", { roles: [1] }],
  ])("rejects a token with %s", (_name, patch) => {
    expect(parseSessionToken({ ...valid, ...patch })).toBeNull();
  });

  it("rejects an empty token", () => {
    expect(parseSessionToken({})).toBeNull();
  });
});
