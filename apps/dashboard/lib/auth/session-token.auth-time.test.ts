import { describe, expect, it } from "vitest";

import { parseSessionToken } from "@/lib/auth/session-token";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication"
// (Where it lives): the session token schema keeps `authTime` optional, so
// sessions issued before D28 stay valid.
const valid = {
  oid: "00000000-0000-4000-8000-000000000001",
  tid: "00000000-0000-4000-8000-000000000002",
  roles: ["internal-admin"],
  authMethod: "entra",
};

describe("parseSessionToken and authTime", () => {
  it("accepts a token without authTime (a session issued before D28)", () => {
    expect(parseSessionToken(valid)).toEqual(valid);
  });

  it("accepts a token with an integer authTime and returns it", () => {
    expect(parseSessionToken({ ...valid, authTime: 1_793_000_000 })).toEqual({
      ...valid,
      authTime: 1_793_000_000,
    });
  });

  it("still rejects a token with no oid even when authTime is present", () => {
    expect(
      parseSessionToken({ ...valid, oid: undefined, authTime: 1_793_000_000 }),
    ).toBeNull();
  });
});
