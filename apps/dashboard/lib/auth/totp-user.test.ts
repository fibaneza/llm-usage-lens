import { describe, expect, it } from "vitest";

import { generateTotpSecret } from "@/lib/auth/totp-user";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (TOTP,
// D23). isTotpRequired is covered against DynamoDB Local in
// password-setup.integration.test.ts.
describe("generateTotpSecret", () => {
  it("returns a 160-bit base32 secret (32 characters, RFC 4648 alphabet)", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("is random per call", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});
